// Whiteboard DAL — 뉴스룸 스코프 강제. 모든 mutation은 board_op에 actor+action 기록.
import { getDb, uid } from "./index";

export interface BoardObject {
  id: string;
  event_id: string;
  kind: "note" | "stroke" | "attachment" | "note_link";
  data: Record<string, unknown>;
  x: number; y: number; w: number; h: number;
  color: string | null;
  deleted: number;
  created_by: string | null;
  updated_at: string;
}

function assertEventInNewsroom(newsroomId: string, eventId: string) {
  const ok = getDb()
    .prepare("SELECT id FROM event WHERE id = ? AND newsroom_id = ?")
    .get(eventId, newsroomId);
  if (!ok) throw new Error("event not found in newsroom");
}

function logOp(
  newsroomId: string,
  eventId: string,
  objectId: string | null,
  action: string,
  actor: string
) {
  getDb()
    .prepare(
      "INSERT INTO board_op (newsroom_id, event_id, object_id, action, actor) VALUES (?, ?, ?, ?, ?)"
    )
    .run(newsroomId, eventId, objectId, action, actor);
}

export function listBoardObjects(newsroomId: string, eventId: string): BoardObject[] {
  assertEventInNewsroom(newsroomId, eventId);
  const rows = getDb()
    .prepare(
      "SELECT id, event_id, kind, data, x, y, w, h, color, deleted, created_by, updated_at FROM board_object WHERE newsroom_id = ? AND event_id = ? AND deleted = 0"
    )
    .all(newsroomId, eventId) as (Omit<BoardObject, "data"> & { data: string })[];
  return rows.map((r) => ({ ...r, data: JSON.parse(r.data || "{}") }));
}

export function createBoardObject(
  newsroomId: string,
  eventId: string,
  actor: string,
  input: {
    id?: string;
    kind: BoardObject["kind"];
    data?: Record<string, unknown>;
    x?: number; y?: number; w?: number; h?: number;
    color?: string;
  }
): string {
  assertEventInNewsroom(newsroomId, eventId);
  const id = input.id ?? uid();
  getDb()
    .prepare(
      `INSERT INTO board_object (id, newsroom_id, event_id, kind, data, x, y, w, h, color, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id, newsroomId, eventId, input.kind,
      JSON.stringify(input.data ?? {}),
      input.x ?? 0, input.y ?? 0, input.w ?? 180, input.h ?? 120,
      input.color ?? null, actor
    );
  logOp(newsroomId, eventId, id, `Added ${labelOf(input.kind)}`, actor);
  return id;
}

export function updateBoardObject(
  newsroomId: string,
  objectId: string,
  actor: string,
  patch: Partial<Pick<BoardObject, "x" | "y" | "w" | "h" | "color" | "deleted">> & {
    data?: Record<string, unknown>;
    action?: string;
  }
) {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT event_id, kind FROM board_object WHERE id = ? AND newsroom_id = ?"
    )
    .get(objectId, newsroomId) as { event_id: string; kind: string } | undefined;
  if (!row) throw new Error("board object not found in newsroom");

  const sets: string[] = ["updated_at = datetime('now')"];
  const vals: unknown[] = [];
  for (const k of ["x", "y", "w", "h", "color", "deleted"] as const) {
    if (patch[k] !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(patch[k]);
    }
  }
  if (patch.data !== undefined) {
    sets.push("data = ?");
    vals.push(JSON.stringify(patch.data));
  }
  db.prepare(`UPDATE board_object SET ${sets.join(", ")} WHERE id = ?`).run(...vals, objectId);
  logOp(
    newsroomId, row.event_id, objectId,
    patch.action ??
      (patch.deleted === 1
        ? `Deleted ${labelOf(row.kind)}`
        : patch.deleted === 0
        ? `Restored ${labelOf(row.kind)}`
        : `Updated ${labelOf(row.kind)}`),
    actor
  );
}

export function listBoardOps(newsroomId: string, eventId: string, limit = 80) {
  assertEventInNewsroom(newsroomId, eventId);
  return getDb()
    .prepare(
      "SELECT seq, object_id, action, actor, at FROM board_op WHERE newsroom_id = ? AND event_id = ? ORDER BY seq DESC LIMIT ?"
    )
    .all(newsroomId, eventId, limit);
}

/** 최신 op seq — 폴링 동기화에서 변경 감지용 */
export function latestOpSeq(newsroomId: string, eventId: string): number {
  const r = getDb()
    .prepare(
      "SELECT COALESCE(MAX(seq),0) AS s FROM board_op WHERE newsroom_id = ? AND event_id = ?"
    )
    .get(newsroomId, eventId) as { s: number };
  return r.s;
}

function labelOf(kind: string): string {
  return { note: "Note", stroke: "Drawing", attachment: "Evidence", note_link: "Link" }[kind] ?? "Object";
}
