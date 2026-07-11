// Date-driven page organization.
//
// A "page" (event row) IS a date. The date entered when a testimony is created
// decides which page its bulletins live on — nobody picks a page by hand. Two
// invariants follow, and this module is the only thing that maintains them:
//
//   1. exactly one page per (newsroom, day)
//   2. every claim sits on the page for its testimony's date
//
// Everything here takes the `Database` handle as an argument rather than calling
// getDb(), so db/index.ts can run it at open time without importing the DAL back.

import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";

/** ISO8601 (or null) → YYYY-MM-DD, the page key. */
export function dayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** The day a testimony belongs to: the date the user entered, else when it was filed. */
export function testimonyDay(t: { given_at: string | null; created_at: string | null }): string {
  return dayOf(t.given_at) ?? dayOf(t.created_at) ?? new Date().toISOString().slice(0, 10);
}

/**
 * The page for `day`, created on the spot if this is the first testimony for it.
 * Chronological position is not stored: the viewport lays pages out by occurred_at,
 * so a new page slots into the right place in the timeline the moment it exists.
 */
export function findOrCreateDayEvent(db: Database, newsroomId: string, day: string): string {
  const existing = db
    .prepare(
      "SELECT id FROM event WHERE newsroom_id = ? AND substr(occurred_at, 1, 10) = ? ORDER BY rowid LIMIT 1"
    )
    .get(newsroomId, day) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = randomUUID();
  db.prepare(
    `INSERT INTO event (id, newsroom_id, title, occurred_at, occurred_precision)
     VALUES (?, ?, ?, ?, 'day')`
  ).run(id, newsroomId, day, `${day}T00:00:00Z`);
  return id;
}

/**
 * Collapse pages that share a day into the oldest one. Needed once when an existing
 * investigation — organized by event name — is migrated onto date pages, and as a
 * backstop for imported data.
 */
export function mergeDuplicateDayEvents(db: Database, newsroomId: string) {
  const dupes = db
    .prepare(
      `SELECT substr(occurred_at, 1, 10) AS day, COUNT(*) AS n
       FROM event WHERE newsroom_id = ? AND occurred_at IS NOT NULL
       GROUP BY day HAVING n > 1`
    )
    .all(newsroomId) as { day: string; n: number }[];

  for (const { day } of dupes) {
    const ids = (
      db
        .prepare(
          "SELECT id FROM event WHERE newsroom_id = ? AND substr(occurred_at, 1, 10) = ? ORDER BY rowid"
        )
        .all(newsroomId, day) as { id: string }[]
    ).map((r) => r.id);
    const [keep, ...drop] = ids;
    for (const id of drop) {
      db.prepare("UPDATE claim SET event_id = ? WHERE event_id = ?").run(keep, id);
      db.prepare("UPDATE board_object SET event_id = ? WHERE event_id = ?").run(keep, id);
      db.prepare("UPDATE board_op SET event_id = ? WHERE event_id = ?").run(keep, id);
      db.prepare("DELETE FROM event WHERE id = ?").run(id);
    }
  }
}

/**
 * Move a testimony's claims onto the page for its date, creating that page if needed.
 * Pass no id to re-home every testimony in the newsroom (import / one-time migration).
 * Returns the number of claims that actually changed page.
 */
export function reassignClaimsToTestimonyDate(
  db: Database,
  newsroomId: string,
  testimonyId?: string
): number {
  const rows = (
    testimonyId
      ? db
          .prepare(
            "SELECT id, given_at, created_at FROM testimony WHERE newsroom_id = ? AND id = ?"
          )
          .all(newsroomId, testimonyId)
      : db
          .prepare("SELECT id, given_at, created_at FROM testimony WHERE newsroom_id = ?")
          .all(newsroomId)
  ) as { id: string; given_at: string | null; created_at: string | null }[];

  let moved = 0;
  for (const t of rows) {
    const eventId = findOrCreateDayEvent(db, newsroomId, testimonyDay(t));
    const r = db
      .prepare(
        "UPDATE claim SET event_id = ? WHERE newsroom_id = ? AND testimony_id = ? AND (event_id IS NULL OR event_id != ?)"
      )
      .run(eventId, newsroomId, t.id, eventId);
    moved += r.changes;
  }
  return moved;
}

/**
 * Drop pages nothing points at any more — but never one that still carries a
 * whiteboard: that is a journalist's work, not derived data.
 */
export function pruneEmptyEvents(db: Database, newsroomId: string): number {
  return db
    .prepare(
      `DELETE FROM event
       WHERE newsroom_id = ?
         AND id NOT IN (SELECT event_id FROM claim WHERE event_id IS NOT NULL)
         AND id NOT IN (SELECT event_id FROM board_object)`
    )
    .run(newsroomId).changes;
}

/** Re-home a single testimony after its date changed, then tidy up. */
export function reorganizeTestimony(db: Database, newsroomId: string, testimonyId: string) {
  db.transaction(() => {
    reassignClaimsToTestimonyDate(db, newsroomId, testimonyId);
    pruneEmptyEvents(db, newsroomId);
  })();
}

/**
 * Bring the whole database onto date pages. Idempotent, so it is safe to run on
 * every open — which is what makes imported or hand-loaded data organize itself.
 */
export function organizeAllByDate(db: Database) {
  const newsrooms = db.prepare("SELECT id FROM newsroom").all() as { id: string }[];
  db.transaction(() => {
    for (const { id } of newsrooms) {
      mergeDuplicateDayEvents(db, id);
      reassignClaimsToTestimonyDate(db, id);
      pruneEmptyEvents(db, id);
    }
  })();
}
