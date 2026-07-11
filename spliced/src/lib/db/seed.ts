import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";

// Demo seed: the "Warehouse Fire" case.
// Two newsrooms demonstrate tenant isolation (§0.3) — the same real-world person
// is a separate record in each newsroom.
export function seed(db: Database) {
  const id = () => randomUUID();

  const nrA = id();
  const nrB = id();
  db.prepare("INSERT INTO newsroom (id, name) VALUES (?, ?)").run(
    nrA,
    "Veritas Investigations"
  );
  db.prepare("INSERT INTO newsroom (id, name) VALUES (?, ?)").run(
    nrB,
    "Tribune Desk B"
  );

  const editor = id();
  const journalist = id();
  const insertUser = db.prepare(
    "INSERT INTO app_user (id, newsroom_id, email, display_name, role) VALUES (?, ?, ?, ?, ?)"
  );
  insertUser.run(editor, nrA, "editor@veritas.demo", "E. Lane", "editor");
  insertUser.run(journalist, nrA, "kim@veritas.demo", "R. Kim", "journalist");
  const userB = id();
  insertUser.run(userB, nrB, "park@tribune.demo", "J. Park", "journalist");

  // ===== entities =====
  const insertPerson = db.prepare(
    "INSERT INTO entity_person (id, newsroom_id, display_name, aliases, created_by) VALUES (?, ?, ?, ?, ?)"
  );
  const suspect = id();
  const witness1 = id();
  const guard = id();
  const insider = id();
  insertPerson.run(suspect, nrA, "D. Harmon (suspect)", "[]", journalist);
  insertPerson.run(witness1, nrA, "M. Reyes (witness)", "[]", journalist);
  insertPerson.run(guard, nrA, "S. Cole (former guard)", "[]", journalist);
  insertPerson.run(insider, nrA, "Y. Ostrova (insurance insider)", "[]", journalist);

  const insertOrg = db.prepare(
    "INSERT INTO entity_org (id, newsroom_id, display_name, created_by) VALUES (?, ?, ?, ?)"
  );
  const logisticsCo = id();
  const fireDept = id();
  insertOrg.run(logisticsCo, nrA, "Hanse Logistics Ltd.", journalist);
  insertOrg.run(fireDept, nrA, "Metro Fire Department", journalist);

  const locWarehouse = id();
  db.prepare(
    "INSERT INTO entity_location (id, newsroom_id, name, lat, lon) VALUES (?, ?, ?, ?, ?)"
  ).run(locWarehouse, nrA, "West District Warehouse", 37.5157, 126.6768);

  // ===== pages (= time layers) =====
  // A page IS a date: the day each testimony was given. Claims land on the page for
  // their testimony's date, so these mirror the given_at values used below.
  const insertEvent = db.prepare(
    "INSERT INTO event (id, newsroom_id, title, ai_subtitle, occurred_at, occurred_precision, location_id) VALUES (?, ?, ?, ?, ?, 'day', ?)"
  );
  const dayPage = (day: string, subtitle: string, loc: string | null = null) => {
    const eid = id();
    insertEvent.run(eid, nrA, day, subtitle, `${day}T00:00:00Z`, loc);
    return eid;
  };
  const pJan18 = dayPage("2026-01-18", "Witness places the suspect at the gasoline purchase, acting alone", null);
  const pJan20 = dayPage("2026-01-20", "Former guard alleges flammables were moved with an accomplice", locWarehouse);
  const pJan22 = dayPage("2026-01-22", "Insurance insider reports the policy limit was tripled", null);
  const pJan25 = dayPage("2026-01-25", "Fire department confirms an accelerant and the point of origin", locWarehouse);
  const pJan26 = dayPage("2026-01-26", "Former guard describes a removal dated after the fire", null);
  const pJan28 = dayPage("2026-01-28", "The first witness revises her account: a second man was present", null);

  // ===== sources (no scores — role only) =====
  const insertSource = db.prepare(
    "INSERT INTO source (id, newsroom_id, person_id, org_id, role) VALUES (?, ?, ?, ?, ?)"
  );
  const srcWitness = id();
  const srcGuard = id();
  const srcInsider = id();
  const srcOfficial = id();
  insertSource.run(srcWitness, nrA, witness1, null, "witness");
  insertSource.run(srcGuard, nrA, guard, null, "witness");
  insertSource.run(srcInsider, nrA, insider, null, "insider");
  insertSource.run(srcOfficial, nrA, null, fireDept, "official");

  // ===== source context attributes (citation required, fact/allegation labeled) =====
  const insertAttr = db.prepare(
    `INSERT INTO source_attribute (id, source_id, category, statement, citation_url, citation_note, is_allegation, entered_by, verified_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertAttr.run(
    id(), srcWitness, "proximity",
    "Runs the shop across from the gas station — claims to have witnessed the purchase",
    "https://example.org/interview-reyes", "First interview recording", 1, journalist, null
  );
  insertAttr.run(
    id(), srcGuard, "conflict_of_interest",
    "Dismissed by Hanse Logistics three months ago; in an unfair-dismissal dispute — verified by our desk",
    "https://example.org/labor-ruling", "Labor board ruling", 0, journalist, editor
  );
  insertAttr.run(
    id(), srcGuard, "proximity",
    "Was the night guard for this warehouse until dismissal",
    "https://example.org/employment-record", "Employment record", 0, journalist, editor
  );
  insertAttr.run(
    id(), srcInsider, "expertise",
    "Seven years in underwriting at Meridian Fire Insurance",
    "https://example.org/profile", null, 0, journalist, null
  );
  insertAttr.run(
    id(), srcOfficial, "expertise",
    "Official agency in charge of fire-cause investigation",
    "https://example.org/fire-dept", null, 0, journalist, editor
  );

  // ===== evidence =====
  const insertEvidence = db.prepare(
    "INSERT INTO evidence (id, newsroom_id, kind, title, storage_url, provenance, entered_by) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const evdCctv = id();
  const evdCard = id();
  const evdPolicy = id();
  insertEvidence.run(evdCctv, nrA, "recording", "Gas station CCTV (Jan 10, 14:28)", null, "Provided by station owner; original hash preserved", journalist);
  insertEvidence.run(evdCard, nrA, "record", "Card payment record (20L gasoline)", null, "Obtained via records request", journalist);
  insertEvidence.run(evdPolicy, nrA, "document", "Policy amendment confirmation", null, "Copy provided by insider", journalist);

  // ===== testimonies + claims =====
  const insertTestimony = db.prepare(
    `INSERT INTO testimony (id, newsroom_id, source_id, raw_text, given_at, ai_title, ai_summary, ai_detail, analysis_status, status, entered_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?)`
  );
  const insertClaim = db.prepare(
    `INSERT INTO claim (id, newsroom_id, testimony_id, text, subject_id, event_id, asserted_time, coherence_flags, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  );

  const t1 = id();
  insertTestimony.run(
    t1, nrA, srcWitness,
    "On the afternoon of January 10th, Harmon filled a red canister with gasoline at the station across from my shop. One 20-liter canister. He was alone.",
    "2026-01-18T10:00:00Z",
    "Gasoline purchase witnessed 5 days before fire",
    "Witness claims the suspect bought 20L of gasoline on Jan 10 and acted alone.",
    "Witness M. Reyes states they directly observed the purchase. Cross-check against CCTV and payment records.",
    "active", journalist
  );
  const c1 = id(); // gasoline purchase
  const c2 = id(); // acted alone
  insertClaim.run(c1, nrA, t1, "Harmon bought 20L of gasoline on Jan 10", suspect, pJan18, "2026-01-10T14:30:00Z", "[]");
  insertClaim.run(c2, nrA, t1, "Harmon was alone during the purchase", suspect, pJan18, "2026-01-10T14:30:00Z", "[]");

  const t2 = id();
  insertTestimony.run(
    t2, nrA, srcGuard,
    "On the night of December 27th during my patrol I saw Harmon moving boxes that looked like flammable material behind the warehouse. There was a man I'd never seen before with him.",
    "2026-01-20T15:00:00Z",
    "Alleged flammables handling 3 weeks before fire",
    "Former guard alleges the suspect moved flammable material on Dec 27, accompanied by one other man — conflicts with another testimony.",
    "The source is a former employee in a dismissal dispute; the conflict-of-interest context is editor-verified (see panel).",
    "active", journalist
  );
  const c3 = id(); // flammables handling
  const c4 = id(); // accomplice present
  insertClaim.run(c3, nrA, t2, "Harmon moved boxes of flammable material behind the warehouse on the night of Dec 27", suspect, pJan20, "2025-12-27T22:00:00Z", "[]");
  insertClaim.run(c4, nrA, t2, "An unidentified man accompanied him", suspect, pJan20, "2025-12-27T22:00:00Z", "[]");

  const t3 = id();
  insertTestimony.run(
    t3, nrA, srcInsider,
    "About six weeks before the fire, Hanse Logistics tripled the fire-insurance limit on that warehouse. It wasn't a normal renewal cycle either.",
    "2026-01-22T09:00:00Z",
    "Insurance limit tripled shortly before fire",
    "Insurance insider states the warehouse policy limit was tripled in early December. Amendment confirmation obtained.",
    "The proximity of the amendment to the fire is circumstantial; causation is marked as inference only.",
    "active", journalist
  );
  const c5 = id(); // insurance increase
  insertClaim.run(c5, nrA, t3, "Hanse Logistics tripled the warehouse insurance limit in early December", logisticsCo, pJan22, "2025-12-01T00:00:00Z", "[]");

  const t4 = id();
  insertTestimony.run(
    t4, nrA, srcOfficial,
    "Forensics identified the point of origin in the south storage section, with confirmed traces of an accelerant (gasoline family).",
    "2026-01-25T11:00:00Z",
    "Official forensics: accelerant confirmed",
    "Fire department officially confirmed the origin point (south section) and gasoline-family accelerant traces.",
    "Official forensic finding — key physical-evidence statement supporting arson.",
    "active", journalist
  );
  const c6 = id(); // accelerant used
  const c7 = id(); // origin south
  insertClaim.run(c6, nrA, t4, "A gasoline-family accelerant was used in the fire", null, pJan25, "2026-01-15T03:12:00Z", "[]");
  insertClaim.run(c7, nrA, t4, "The point of origin is the south storage section", null, pJan25, "2026-01-15T03:12:00Z", "[]");

  const t5 = id();
  insertTestimony.run(
    t5, nrA, srcGuard,
    "On the evening of January 16th I also saw Harmon taking several boxes out of the warehouse.",
    "2026-01-26T18:00:00Z",
    "Alleged removal a day after fire (time mismatch)",
    "Former guard alleges items were removed from the warehouse on Jan 16 — but it burned down on Jan 15. Chronological impossibility flagged.",
    "AI consistency check flagged chronological_impossible. Review credibility of the full statement.",
    "active", journalist
  );
  const c8 = id();
  insertClaim.run(
    c8, nrA, t5,
    "Harmon removed boxes from the burned warehouse on the evening of Jan 16",
    suspect, pJan26, "2026-01-16T18:00:00Z",
    JSON.stringify(["chronological_impossible"])
  );

  // Same witness as t1, contradicting her own earlier "he was alone".
  // Demonstrates self-contradiction detection: both bulletins turn red.
  const t6 = id();
  insertTestimony.run(
    t6, nrA, srcWitness,
    "I've been going over it again. There was a second man at the pump with Harmon that afternoon — he helped carry the canister to the car.",
    "2026-01-28T09:30:00Z",
    "Witness revises account: a second man was present",
    "The same witness now states a second man helped Harmon during the Jan 10 purchase, contradicting her own earlier statement that he was alone.",
    "Both statements come from M. Reyes. The account is internally inconsistent — resolve before use.",
    "active", journalist
  );
  const c9 = id();
  insertClaim.run(c9, nrA, t6, "A second man helped Harmon carry the canister", suspect, pJan28, "2026-01-10T14:30:00Z", "[]");

  // ===== relationship links — all 5 kinds, no weights =====
  const insertLink = db.prepare(
    `INSERT INTO rel_claim_link (id, newsroom_id, from_claim, to_claim, evidence_id, kind, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertLink.run(id(), nrA, c1, null, evdCctv, "direct_evidence", journalist); // green
  insertLink.run(id(), nrA, c1, null, evdCard, "direct_evidence", journalist); // green
  insertLink.run(id(), nrA, c5, null, evdPolicy, "direct_evidence", journalist); // green
  insertLink.run(id(), nrA, c1, c6, null, "supports", journalist); // blue (cross-layer)
  insertLink.run(id(), nrA, c3, c6, null, "supports", journalist); // blue
  insertLink.run(id(), nrA, c4, c2, null, "contradicts", journalist); // red — different witnesses
  insertLink.run(id(), nrA, c9, c2, null, "contradicts", journalist); // red — the SAME witness (Reyes) contradicts herself
  insertLink.run(id(), nrA, c5, c1, null, "weak_assoc", journalist); // orange
  insertLink.run(id(), nrA, c5, c6, null, "inference", journalist); // purple (motive inference)

  // ===== newsroom B: minimal isolation demo =====
  const suspectB = id();
  insertPerson.run(suspectB, nrB, "D. Harmon (suspect)", "[]", userB); // same name, separate record
  const srcB = id();
  insertSource.run(srcB, nrB, suspectB, null, "witness");
  const evB = id();
  db.prepare(
    "INSERT INTO event (id, newsroom_id, title, occurred_at, occurred_precision) VALUES (?, ?, ?, ?, 'day')"
  ).run(evB, nrB, "2026-02-01", "2026-02-01T00:00:00Z");
  const tB = id();
  insertTestimony.run(
    tB, nrB, srcB,
    "Data from other newsrooms is not visible here. This testimony exists only in Tribune Desk B — full isolation demo.",
    "2026-02-01T00:00:00Z",
    "Newsroom isolation demo",
    "This testimony exists only in Tribune Desk B.",
    null, "active", userB
  );
  const cB = id();
  insertClaim.run(cB, nrB, tB, "Data is never shared across newsrooms", null, evB, null, "[]");
}
