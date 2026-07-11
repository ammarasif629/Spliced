// The structured conflict analysis, read back out of the database.
//
// This is the single shape the API serves and the viewport renders, so what is on
// screen can never drift from what the LLM last wrote. It lives in the db layer (not
// in llm/) so both the DAL and the analyzer can reach it without importing each other.

import { getDb } from "./index";
import type { AnalysisDoc, ConflictRecord } from "../types";

/** Active claims count — the denominator the analysis was computed over. */
export function activeClaimCount(newsroomId: string): number {
  return (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM claim c JOIN testimony t ON t.id = c.testimony_id
         WHERE c.newsroom_id = ? AND c.status = 'active' AND t.status = 'active'`
      )
      .get(newsroomId) as { n: number }
  ).n;
}

export function buildAnalysisDoc(newsroomId: string): AnalysisDoc {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT l.id, l.from_claim, l.to_claim, COALESCE(l.origin,'manual') AS origin,
              l.note, l.dimension, l.confidence, l.analyzed_at,
              ca.text AS text_a, cb.text AS text_b,
              ca.testimony_id AS testimony_a, cb.testimony_id AS testimony_b,
              ta.source_id AS source_a, tb.source_id AS source_b,
              COALESCE(pa.display_name, oa.display_name, '?') AS witness_a,
              COALESCE(pb.display_name, ob.display_name, '?') AS witness_b
       FROM rel_claim_link l
       JOIN claim ca ON ca.id = l.from_claim
       JOIN claim cb ON cb.id = l.to_claim
       JOIN testimony ta ON ta.id = ca.testimony_id
       JOIN testimony tb ON tb.id = cb.testimony_id
       JOIN source sa ON sa.id = ta.source_id
       JOIN source sb ON sb.id = tb.source_id
       LEFT JOIN entity_person pa ON pa.id = sa.person_id
       LEFT JOIN entity_org oa ON oa.id = sa.org_id
       LEFT JOIN entity_person pb ON pb.id = sb.person_id
       LEFT JOIN entity_org ob ON ob.id = sb.org_id
       WHERE l.newsroom_id = ? AND l.kind = 'contradicts'
         AND ca.status = 'active' AND cb.status = 'active'
         AND ta.status = 'active' AND tb.status = 'active'`
    )
    .all(newsroomId) as Record<string, unknown>[];

  const meta = db
    .prepare("SELECT model, provider, at FROM analysis_run WHERE newsroom_id = ?")
    .get(newsroomId) as { model: string; provider: string; at: string } | undefined;

  const conflicts: ConflictRecord[] = rows.map((r) => ({
    id: r.id as string,
    claim_a: r.from_claim as string,
    claim_b: r.to_claim as string,
    testimony_a: r.testimony_a as string,
    testimony_b: r.testimony_b as string,
    witness_a: r.witness_a as string,
    witness_b: r.witness_b as string,
    text_a: r.text_a as string,
    text_b: r.text_b as string,
    // self vs cross is a database fact, never a model opinion
    self: r.source_a === r.source_b,
    dimension: (r.dimension as string) ?? null,
    reason: (r.note as string) ?? null,
    confidence: (r.confidence as number) ?? null,
    origin: r.origin as "manual" | "ai_conflict",
    analyzed_at: (r.analyzed_at as string) ?? null,
  }));

  return {
    newsroom_id: newsroomId,
    analyzed_at: meta?.at ?? null,
    provider: meta?.provider ?? null,
    model: meta?.model ?? null,
    claim_count: activeClaimCount(newsroomId),
    conflicts,
  };
}
