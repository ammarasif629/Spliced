// The viewport renders conflicts straight from `graph.analysis` — the structured
// document the LLM analysis wrote and the server stored. Nothing is re-derived here,
// so the red cards, the NON-COHERENT TESTIMONY badges and the red connection lines
// can never disagree with the stored verdict.
//
// When the analysis rewrites its links, the next payload simply carries fewer (or
// different) conflicts, and the highlights follow. There is no stale state to clear.

import type { AnalysisDoc, ConflictRecord, GraphPayload } from "@/lib/types";

export type { ConflictRecord };

const EMPTY: AnalysisDoc = {
  newsroom_id: "",
  analyzed_at: null,
  provider: null,
  model: null,
  claim_count: 0,
  conflicts: [],
};

export function analysisOf(graph: GraphPayload): AnalysisDoc {
  return graph.analysis ?? EMPTY;
}

/** Every pair of claims the analysis says cannot both be true. */
export function conflictPairs(graph: GraphPayload): ConflictRecord[] {
  return analysisOf(graph).conflicts;
}

/**
 * claim id → whether it is in conflict, and whether that conflict is self-inflicted.
 * A claim caught in both kinds reads as self-contradicting: that is the stronger
 * statement about the witness's own account.
 */
export function conflictByClaim(
  conflicts: ConflictRecord[]
): Record<string, { self: boolean }> {
  const out: Record<string, { self: boolean }> = {};
  for (const c of conflicts)
    for (const id of [c.claim_a, c.claim_b])
      out[id] = { self: (out[id]?.self ?? false) || c.self };
  return out;
}

/** Link ids the analysis considers conflicts — used to draw them heavier and on top. */
export function conflictLinkIds(graph: GraphPayload): Set<string> {
  return new Set(analysisOf(graph).conflicts.map((c) => c.id));
}
