// Data Access Layer — 모든 함수가 newsroomId를 첫 인자로 강제한다(§0.3 뉴스룸 격리).
// SQLite에는 RLS가 없으므로 이 계층이 tenant 경계다. 여기를 우회하는 쿼리는 금지.

import { getDb, uid, audit } from "./index";
import { buildAnalysisDoc } from "./analysis";
import { pruneEmptyEvents, reorganizeTestimony } from "./organize";
import { testimonyAssessment, classifyClaim } from "../assessment";
import type {
  Assessment,
  ClaimRecord,
  GraphPayload,
  LinkKind,
  SourceContext,
  TestimonyRecord,
} from "../types";

// ---------- Newsrooms / Users ----------
export function listNewsrooms() {
  // 시드 순서(= 데모 기본 뉴스룸 Veritas 우선) 유지를 위해 rowid 정렬
  return getDb().prepare("SELECT id, name FROM newsroom ORDER BY rowid").all();
}

export function defaultUser(newsroomId: string): { id: string; display_name: string } {
  const u = getDb()
    .prepare(
      "SELECT id, display_name FROM app_user WHERE newsroom_id = ? ORDER BY CASE role WHEN 'journalist' THEN 0 ELSE 1 END LIMIT 1"
    )
    .get(newsroomId) as { id: string; display_name: string } | undefined;
  if (!u) throw new Error("no users in newsroom");
  return u;
}

// ---------- Sources ----------
function sourceLabelExpr() {
  return `COALESCE(p.display_name, o.display_name, 'Unknown source')`;
}

export function listSources(newsroomId: string) {
  return getDb()
    .prepare(
      `SELECT s.id, s.role, ${sourceLabelExpr()} AS label
       FROM source s
       LEFT JOIN entity_person p ON p.id = s.person_id
       LEFT JOIN entity_org o ON o.id = s.org_id
       WHERE s.newsroom_id = ?
       ORDER BY label`
    )
    .all(newsroomId);
}

export function createSourceWithPerson(
  newsroomId: string,
  personName: string,
  role: string
): string {
  const db = getDb();
  const user = defaultUser(newsroomId);
  // 뉴스룸 범위 내 정규화: 동일 display_name이면 기존 엔티티 재사용
  let person = db
    .prepare(
      "SELECT id FROM entity_person WHERE newsroom_id = ? AND display_name = ?"
    )
    .get(newsroomId, personName) as { id: string } | undefined;
  if (!person) {
    const pid = uid();
    db.prepare(
      "INSERT INTO entity_person (id, newsroom_id, display_name, created_by) VALUES (?, ?, ?, ?)"
    ).run(pid, newsroomId, personName, user.id);
    person = { id: pid };
  }
  const existing = db
    .prepare("SELECT id FROM source WHERE newsroom_id = ? AND person_id = ?")
    .get(newsroomId, person.id) as { id: string } | undefined;
  if (existing) return existing.id;
  const sid = uid();
  db.prepare(
    "INSERT INTO source (id, newsroom_id, person_id, role) VALUES (?, ?, ?, ?)"
  ).run(sid, newsroomId, person.id, role);
  audit(newsroomId, user.id, "create", "source", sid);
  return sid;
}

export function getSourceContext(
  newsroomId: string,
  sourceId: string
): SourceContext | null {
  const db = getDb();
  const src = db
    .prepare(
      `SELECT s.id, s.role, ${sourceLabelExpr()} AS label
       FROM source s
       LEFT JOIN entity_person p ON p.id = s.person_id
       LEFT JOIN entity_org o ON o.id = s.org_id
       WHERE s.newsroom_id = ? AND s.id = ?`
    )
    .get(newsroomId, sourceId) as
    | { id: string; role: string | null; label: string }
    | undefined;
  if (!src) return null;

  const attrs = db
    .prepare(
      `SELECT a.id, a.category, a.statement, a.citation_url, a.citation_note,
              a.is_allegation, a.restricted, u.display_name AS verified_by_name
       FROM source_attribute a
       LEFT JOIN app_user u ON u.id = a.verified_by
       WHERE a.source_id = ? AND a.restricted = 0
       ORDER BY a.created_at`
    )
    .all(sourceId) as Array<{
      id: string; category: string; statement: string;
      citation_url: string | null; citation_note: string | null;
      is_allegation: number; restricted: number; verified_by_name: string | null;
    }>;

  return {
    source_id: src.id,
    label: src.label,
    role: src.role,
    attributes: attrs.map((a) => ({
      id: a.id,
      category: a.category,
      statement: a.statement,
      citation_url: a.citation_url,
      citation_note: a.citation_note,
      is_allegation: !!a.is_allegation,
      verified_by_name: a.verified_by_name,
      restricted: !!a.restricted,
    })),
    disclaimer:
      "This panel is editorial context, not a trust score. Every entry carries a citation.",
  };
}

export function addSourceAttribute(
  newsroomId: string,
  sourceId: string,
  input: {
    category: string;
    statement: string;
    citation_url?: string;
    citation_note?: string;
    is_allegation: boolean;
    restricted?: boolean;
    legal_basis?: string;
  }
) {
  const db = getDb();
  // 소스가 이 뉴스룸 소속인지 검증 (격리)
  const owned = db
    .prepare("SELECT id FROM source WHERE id = ? AND newsroom_id = ?")
    .get(sourceId, newsroomId);
  if (!owned) throw new Error("source not found in newsroom");
  if (input.restricted && !input.legal_basis)
    throw new Error("restricted attributes require a legal_basis (GDPR Art.9/10)");
  const user = defaultUser(newsroomId);
  const aid = uid();
  db.prepare(
    `INSERT INTO source_attribute
     (id, source_id, category, statement, citation_url, citation_note, is_allegation, restricted, legal_basis, entered_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    aid, sourceId, input.category, input.statement,
    input.citation_url ?? null, input.citation_note ?? null,
    input.is_allegation ? 1 : 0, input.restricted ? 1 : 0,
    input.legal_basis ?? null, user.id
  );
  audit(newsroomId, user.id, "create", "source_attribute", aid, input);
  return aid;
}

// ---------- Testimonies ----------
const TESTIMONY_SELECT = `
  SELECT t.id, t.source_id, t.raw_text, t.given_at, t.ai_title, t.ai_summary, t.ai_detail,
         t.analysis_status, t.status, t.created_at,
         COALESCE(p.display_name, o.display_name, 'Unknown source') AS source_label,
         s.role AS source_role
  FROM testimony t
  JOIN source s ON s.id = t.source_id
  LEFT JOIN entity_person p ON p.id = s.person_id
  LEFT JOIN entity_org o ON o.id = s.org_id`;

export function listTestimonies(newsroomId: string): TestimonyRecord[] {
  return getDb()
    .prepare(`${TESTIMONY_SELECT} WHERE t.newsroom_id = ? ORDER BY t.created_at DESC`)
    .all(newsroomId) as TestimonyRecord[];
}

export function getTestimony(
  newsroomId: string,
  id: string
): TestimonyRecord | null {
  return (getDb()
    .prepare(`${TESTIMONY_SELECT} WHERE t.newsroom_id = ? AND t.id = ?`)
    .get(newsroomId, id) as TestimonyRecord | undefined) ?? null;
}

export function createTestimony(
  newsroomId: string,
  input: { sourceId?: string; newSourceName?: string; newSourceRole?: string; rawText: string; givenAt?: string }
): string {
  const db = getDb();
  const user = defaultUser(newsroomId);
  let sourceId = input.sourceId;
  if (!sourceId) {
    if (!input.newSourceName) throw new Error("sourceId or newSourceName required");
    sourceId = createSourceWithPerson(
      newsroomId,
      input.newSourceName,
      input.newSourceRole ?? "witness"
    );
  } else {
    const owned = db
      .prepare("SELECT id FROM source WHERE id = ? AND newsroom_id = ?")
      .get(sourceId, newsroomId);
    if (!owned) throw new Error("source not found in newsroom");
  }
  const tid = uid();
  db.prepare(
    `INSERT INTO testimony (id, newsroom_id, source_id, raw_text, given_at, entered_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(tid, newsroomId, sourceId, input.rawText, input.givenAt ?? null, user.id);
  audit(newsroomId, user.id, "create", "testimony", tid);
  return tid;
}

/**
 * Edit a testimony. Returns whether the raw text changed — the caller must then
 * re-run the extraction pipeline, because the stored claims no longer describe the
 * text. Editing only the date keeps the claims and just re-dates them.
 *
 * When the text changes we drop this testimony's claims and every link touching
 * them: a claim that no longer exists cannot keep a conflict alive (requirement:
 * warnings that are no longer valid must disappear).
 */
export function updateTestimony(
  newsroomId: string,
  id: string,
  input: { rawText?: string; givenAt?: string | null }
): { textChanged: boolean; dateChanged: boolean } {
  const db = getDb();
  const user = defaultUser(newsroomId);
  const current = db
    .prepare("SELECT raw_text, given_at FROM testimony WHERE id = ? AND newsroom_id = ?")
    .get(id, newsroomId) as { raw_text: string; given_at: string | null } | undefined;
  if (!current) throw new Error("testimony not found in newsroom");

  const rawText = input.rawText?.trim();
  const textChanged = !!rawText && rawText !== current.raw_text;
  const dateChanged =
    input.givenAt !== undefined && (input.givenAt ?? null) !== current.given_at;

  db.transaction(() => {
    if (textChanged)
      db.prepare("UPDATE testimony SET raw_text = ? WHERE id = ?").run(rawText, id);
    if (input.givenAt !== undefined)
      db.prepare("UPDATE testimony SET given_at = ? WHERE id = ?").run(input.givenAt, id);

    if (textChanged) {
      const claimIds = (
        db
          .prepare("SELECT id FROM claim WHERE newsroom_id = ? AND testimony_id = ?")
          .all(newsroomId, id) as { id: string }[]
      ).map((r) => r.id);
      const delLinks = db.prepare(
        "DELETE FROM rel_claim_link WHERE newsroom_id = ? AND (from_claim = ? OR to_claim = ?)"
      );
      const delClaim = db.prepare("DELETE FROM claim WHERE id = ?");
      for (const cid of claimIds) {
        delLinks.run(newsroomId, cid, cid);
        delClaim.run(cid);
      }
      db.prepare(
        "UPDATE testimony SET analysis_status = 'pending', ai_title = NULL, ai_summary = NULL, ai_detail = NULL WHERE id = ?"
      ).run(id);
    }
    audit(newsroomId, user.id, "update", "testimony", id, {
      textChanged,
      givenAt: input.givenAt,
    });
  })();

  // Moving the date moves the bulletins: they belong to the page for the new day,
  // which is created if it does not exist yet. The page they left is dropped if it
  // is now empty. (After a text edit the claims are gone; the pipeline re-homes the
  // fresh ones.)
  if (dateChanged && !textChanged) reorganizeTestimony(db, newsroomId, id);

  return { textChanged, dateChanged };
}

export function setTestimonyStatus(
  newsroomId: string,
  id: string,
  status: "active" | "rejected"
) {
  const db = getDb();
  const user = defaultUser(newsroomId);
  const r = db
    .prepare("UPDATE testimony SET status = ? WHERE id = ? AND newsroom_id = ?")
    .run(status, id, newsroomId);
  if (r.changes === 0) throw new Error("testimony not found in newsroom");
  // 소속 claim도 동일 status — 링크는 남지만 read-time 파생에서 자연히 배제된다(§0.1)
  db.prepare("UPDATE claim SET status = ? WHERE testimony_id = ? AND newsroom_id = ?")
    .run(status, id, newsroomId);
  audit(newsroomId, user.id, status === "rejected" ? "reject" : "restore", "testimony", id);
}

// ---------- Claims & read-time 파생 통계 ----------
interface ClaimRow {
  id: string; testimony_id: string; text: string; event_id: string | null;
  asserted_time: string | null; coherence_flags: string; status: "active" | "rejected";
  testimony_status: "active" | "rejected"; source_label: string;
  source_id: string; given_at: string | null;
}

function claimsOf(newsroomId: string, testimonyId?: string): ClaimRow[] {
  const db = getDb();
  const base = `
    SELECT c.id, c.testimony_id, c.text, c.event_id, c.asserted_time, c.coherence_flags, c.status,
           t.status AS testimony_status, t.source_id, t.given_at,
           COALESCE(p.display_name, o.display_name, '?') AS source_label
    FROM claim c
    JOIN testimony t ON t.id = c.testimony_id
    JOIN source s ON s.id = t.source_id
    LEFT JOIN entity_person p ON p.id = s.person_id
    LEFT JOIN entity_org o ON o.id = s.org_id
    WHERE c.newsroom_id = ?`;
  return (
    testimonyId
      ? db.prepare(`${base} AND c.testimony_id = ?`).all(newsroomId, testimonyId)
      : db.prepare(base).all(newsroomId)
  ) as ClaimRow[];
}

/**
 * 주장 1건의 지지/반박/직접증거를 read-time COUNT로 파생(§0.1).
 * 기각된(rejected) 증언의 주장이 건 링크는 집계에서 배제된다 —
 * 저장된 숫자를 갱신하는 게 아니라 다음 조회에서 값이 자연히 달라진다.
 */
export function claimStats(newsroomId: string, claimId: string) {
  const db = getDb();
  const activeOther = `
    EXISTS (SELECT 1 FROM claim oc JOIN testimony ot ON ot.id = oc.testimony_id
            WHERE oc.id = %COL% AND oc.status = 'active' AND ot.status = 'active')`;

  const supporting = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM rel_claim_link l
       WHERE l.newsroom_id = ? AND l.kind = 'supports' AND l.to_claim = ?
         AND ${activeOther.replace("%COL%", "l.from_claim")}`
    )
    .get(newsroomId, claimId) as { n: number }).n;

  // contradicts는 방향 무관 — 들어오는/나가는 링크를 각각 집계
  const contraIn = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM rel_claim_link l
       WHERE l.newsroom_id = ? AND l.kind = 'contradicts' AND l.to_claim = ?
         AND ${activeOther.replace("%COL%", "l.from_claim")}`
    )
    .get(newsroomId, claimId) as { n: number }).n;
  const contraOut = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM rel_claim_link l
       WHERE l.newsroom_id = ? AND l.kind = 'contradicts' AND l.from_claim = ?
         AND l.to_claim IS NOT NULL
         AND ${activeOther.replace("%COL%", "l.to_claim")}`
    )
    .get(newsroomId, claimId) as { n: number }).n;
  const contradicting = contraIn + contraOut;

  const direct = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM rel_claim_link l
       WHERE l.newsroom_id = ? AND l.kind = 'direct_evidence'
         AND l.from_claim = ? AND l.evidence_id IS NOT NULL`
    )
    .get(newsroomId, claimId) as { n: number }).n;

  return { supporting, contradicting, hasDirectEvidence: direct > 0, directCount: direct };
}

// ---------- Assessment (read-time 파생 — DB 저장 없음) ----------
export function getAssessment(
  newsroomId: string,
  testimonyId: string
): Assessment | null {
  const t = getTestimony(newsroomId, testimonyId);
  if (!t) return null;
  const rows = claimsOf(newsroomId, testimonyId);

  const perClaim = rows.map((c) => {
    const s = claimStats(newsroomId, c.id);
    return {
      claim_id: c.id,
      claim: c.text,
      status: classifyClaim(s),
      supporting_evidence: s.supporting + s.directCount,
      contradicting: s.contradicting,
      has_direct_evidence: s.hasDirectEvidence,
      _stats: s,
      _flags: JSON.parse(c.coherence_flags || "[]") as string[],
    };
  });

  const allFlags = [...new Set(perClaim.flatMap((c) => c._flags))];
  const core = testimonyAssessment(
    perClaim.map((c) => c._stats),
    allFlags
  );

  // 충돌 목록: 이 증언의 주장과 contradicts로 연결된 상대 증언
  const db = getDb();
  const conflicts = db
    .prepare(
      `SELECT DISTINCT ot.id AS with_testimony, oc.text AS claim, l.kind AS type
       FROM rel_claim_link l
       JOIN claim mc ON (mc.id = l.from_claim OR mc.id = l.to_claim) AND mc.testimony_id = ?
       JOIN claim oc ON (oc.id = CASE WHEN l.from_claim = mc.id THEN l.to_claim ELSE l.from_claim END)
       JOIN testimony ot ON ot.id = oc.testimony_id AND ot.id != ?
       WHERE l.newsroom_id = ? AND l.kind = 'contradicts' AND ot.status = 'active'`
    )
    .all(testimonyId, testimonyId, newsroomId) as Assessment["conflicts"];

  return {
    testimony_id: testimonyId,
    corroboration_coverage: core.corroboration_coverage,
    claim_breakdown: perClaim.map(({ _stats, _flags, ...rest }) => rest),
    coherence_badges: core.coherence_badges,
    source_context: getSourceContext(newsroomId, t.source_id),
    conflicts,
    disclaimer: core.disclaimer,
  };
}

// ---------- Links ----------
export function createLink(
  newsroomId: string,
  input: { fromClaim: string; toClaim?: string; evidenceId?: string; kind: LinkKind }
) {
  const db = getDb();
  const user = defaultUser(newsroomId);
  const from = db
    .prepare("SELECT id FROM claim WHERE id = ? AND newsroom_id = ?")
    .get(input.fromClaim, newsroomId);
  if (!from) throw new Error("from_claim not found in newsroom");
  if (!input.toClaim && !input.evidenceId)
    throw new Error("toClaim or evidenceId required");
  if (input.toClaim) {
    const to = db
      .prepare("SELECT id FROM claim WHERE id = ? AND newsroom_id = ?")
      .get(input.toClaim, newsroomId);
    if (!to) throw new Error("to_claim not found in newsroom");
  }
  const lid = uid();
  db.prepare(
    `INSERT INTO rel_claim_link (id, newsroom_id, from_claim, to_claim, evidence_id, kind, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(lid, newsroomId, input.fromClaim, input.toClaim ?? null, input.evidenceId ?? null, input.kind, user.id);
  audit(newsroomId, user.id, "create", "rel_claim_link", lid, input);
  return lid;
}

// ---------- Graph ----------
export function graphFull(newsroomId: string): GraphPayload {
  const db = getDb();
  const planes = db
    .prepare(
      `SELECT id, title, ai_subtitle, occurred_at, occurred_precision FROM event
       WHERE newsroom_id = ? ORDER BY occurred_at`
    )
    .all(newsroomId) as GraphPayload["planes"];

  const claims = claimsOf(newsroomId).map((c) => ({
    id: c.id,
    testimony_id: c.testimony_id,
    text: c.text,
    event_id: c.event_id,
    asserted_time: c.asserted_time,
    coherence_flags: JSON.parse(c.coherence_flags || "[]"),
    status: c.status,
    testimony_status: c.testimony_status,
    source_label: c.source_label,
    source_id: c.source_id,
    given_at: c.given_at,
  })) as ClaimRecord[];

  const links = db
    .prepare(
      `SELECT id, from_claim, to_claim, evidence_id, kind,
              COALESCE(origin, 'manual') AS origin, note, dimension, confidence, analyzed_at
       FROM rel_claim_link WHERE newsroom_id = ?`
    )
    .all(newsroomId) as GraphPayload["links"];

  const evidence = db
    .prepare(
      `SELECT id, kind, title, provenance FROM evidence WHERE newsroom_id = ?`
    )
    .all(newsroomId) as GraphPayload["evidence"];

  // The structured LLM analysis travels with the graph, so the red cards and red
  // lines are rendered from the stored analysis rather than re-derived in the client.
  const analysis = buildAnalysisDoc(newsroomId);

  return { planes, claims, links, evidence, analysis };
}

/** status=active인 증언/주장만으로 재구성한 서사 (§4 accepted-chain) */
export function acceptedChain(newsroomId: string) {
  const g = graphFull(newsroomId);
  const activeClaims = g.claims.filter(
    (c) => c.status === "active" && c.testimony_status === "active"
  );
  const activeIds = new Set(activeClaims.map((c) => c.id));
  const links = g.links.filter(
    (l) =>
      activeIds.has(l.from_claim) &&
      (l.to_claim === null || activeIds.has(l.to_claim))
  );
  const byEvent = g.planes.map((p) => ({
    event: p,
    claims: activeClaims
      .filter((c) => c.event_id === p.id)
      .map((c) => ({ ...c, ...claimStats(newsroomId, c.id) })),
  }));
  return { chain: byEvent, links, evidence: g.evidence };
}

// ---------- Entities ----------
export function searchEntities(newsroomId: string, q: string) {
  const db = getDb();
  const like = `%${q}%`;
  const persons = db
    .prepare(
      "SELECT id, display_name, 'person' AS type FROM entity_person WHERE newsroom_id = ? AND display_name LIKE ? AND is_confidential = 0"
    )
    .all(newsroomId, like);
  const orgs = db
    .prepare(
      "SELECT id, display_name, 'org' AS type FROM entity_org WHERE newsroom_id = ? AND display_name LIKE ?"
    )
    .all(newsroomId, like);
  return [...persons, ...orgs];
}

// ---------- Events (= date pages) ----------
// Pages are created and merged exclusively by db/organize.ts, keyed on the day of the
// testimony. There is deliberately no "create a page called X" entry point: a page is
// a date, and letting anything invent one by name is how duplicate days appear.

// ---------- Destructive deletes (confirmed by the user in the UI) ----------
// Deleting a page (event) permanently removes the event, every testimony that
// contributed a claim to it — including ALL of those testimonies' claims and
// links, so no orphaned testimonies remain — plus the event's whiteboard.
export function deleteEvent(newsroomId: string, eventId: string) {
  const db = getDb();
  const ev = db
    .prepare("SELECT id FROM event WHERE id = ? AND newsroom_id = ?")
    .get(eventId, newsroomId);
  if (!ev) throw new Error("event not found");
  const user = defaultUser(newsroomId);
  db.transaction(() => {
    const testimonyIds = (
      db
        .prepare(
          "SELECT DISTINCT testimony_id AS id FROM claim WHERE newsroom_id = ? AND event_id = ?"
        )
        .all(newsroomId, eventId) as { id: string }[]
    ).map((r) => r.id);
    const claimIds = new Set<string>(
      (
        db
          .prepare("SELECT id FROM claim WHERE newsroom_id = ? AND event_id = ?")
          .all(newsroomId, eventId) as { id: string }[]
      ).map((r) => r.id)
    );
    const claimsOfTestimony = db.prepare(
      "SELECT id FROM claim WHERE newsroom_id = ? AND testimony_id = ?"
    );
    for (const tid of testimonyIds)
      for (const r of claimsOfTestimony.all(newsroomId, tid) as { id: string }[])
        claimIds.add(r.id);
    const delLinks = db.prepare(
      "DELETE FROM rel_claim_link WHERE newsroom_id = ? AND (from_claim = ? OR to_claim = ?)"
    );
    const delClaim = db.prepare("DELETE FROM claim WHERE id = ?");
    for (const cid of claimIds) {
      delLinks.run(newsroomId, cid, cid);
      delClaim.run(cid);
    }
    const delTestimony = db.prepare(
      "DELETE FROM testimony WHERE id = ? AND newsroom_id = ?"
    );
    for (const tid of testimonyIds) {
      delTestimony.run(tid, newsroomId);
      audit(newsroomId, user.id, "delete", "testimony", tid);
    }
    db.prepare("DELETE FROM board_op WHERE newsroom_id = ? AND event_id = ?").run(
      newsroomId,
      eventId
    );
    db.prepare(
      "DELETE FROM board_object WHERE newsroom_id = ? AND event_id = ?"
    ).run(newsroomId, eventId);
    db.prepare("DELETE FROM event WHERE id = ? AND newsroom_id = ?").run(
      eventId,
      newsroomId
    );
    audit(newsroomId, user.id, "delete", "event", eventId);
  })();
}

// Deleting a bulletin removes the claim and its links; if the parent testimony
// has no remaining claims it is removed as well (no orphaned testimonies).
export function deleteClaim(
  newsroomId: string,
  claimId: string
): { testimonyId: string; testimonyDeleted: boolean } {
  const db = getDb();
  const claim = db
    .prepare("SELECT id, testimony_id FROM claim WHERE id = ? AND newsroom_id = ?")
    .get(claimId, newsroomId) as { id: string; testimony_id: string } | undefined;
  if (!claim) throw new Error("claim not found");
  const user = defaultUser(newsroomId);
  let testimonyDeleted = false;
  db.transaction(() => {
    db.prepare(
      "DELETE FROM rel_claim_link WHERE newsroom_id = ? AND (from_claim = ? OR to_claim = ?)"
    ).run(newsroomId, claimId, claimId);
    db.prepare("DELETE FROM claim WHERE id = ?").run(claimId);
    audit(newsroomId, user.id, "delete", "claim", claimId);
    const left = db
      .prepare("SELECT COUNT(*) AS n FROM claim WHERE testimony_id = ?")
      .get(claim.testimony_id) as { n: number };
    if (left.n === 0) {
      db.prepare("DELETE FROM testimony WHERE id = ? AND newsroom_id = ?").run(
        claim.testimony_id,
        newsroomId
      );
      audit(newsroomId, user.id, "delete", "testimony", claim.testimony_id);
      testimonyDeleted = true;
    }
  })();
  pruneEmptyEvents(db, newsroomId); // the page may have just lost its last bulletin
  return { testimonyId: claim.testimony_id, testimonyDeleted };
}
