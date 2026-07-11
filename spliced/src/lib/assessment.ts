// §8 Scoring/Assessment — analysis/assessment.py의 TS 이식.
// 어떤 값도 DB에 쓰지 않는 순수 함수. coverage는 조회 시점에 링크에서 파생된다.

export interface ClaimStatusInput {
  supporting: number; // 독립 출처/증거 지지 수
  contradicting: number;
  hasDirectEvidence: boolean;
}

export type ClaimClass =
  | "refuted"
  | "corroborated"
  | "contested"
  | "uncorroborated";

export function classifyClaim(cs: ClaimStatusInput): ClaimClass {
  if (cs.contradicting >= 2 && cs.supporting === 0) return "refuted";
  if (cs.hasDirectEvidence || cs.supporting >= 2) return "corroborated";
  if (cs.contradicting >= 1) return "contested";
  return "uncorroborated";
}

export function testimonyAssessment(
  claims: ClaimStatusInput[],
  coherenceFlags: string[]
): {
  corroboration_coverage: number;
  claim_statuses: ClaimClass[];
  coherence_badges: string[];
  disclaimer: string;
} {
  const statuses = claims.map(classifyClaim);
  const n = statuses.length || 1;
  const corroborated = statuses.filter((s) => s === "corroborated").length;

  // ★ 유일한 숫자: 교차검증 비율 (정의 가능·방어 가능)
  const coverage = corroborated / n;

  // 계량 불가 축은 숫자에 합산하지 않음 → 배지로 노출
  const badges: string[] = [];
  if (coherenceFlags.includes("chronological_impossible"))
    badges.push("⚠ chronological_impossibility");
  if (coherenceFlags.includes("self_contradiction"))
    badges.push("⚠ self_contradiction");
  if (coherenceFlags.includes("geographic_impossible"))
    badges.push("⚠ geographic_impossibility");
  if (coherenceFlags.length === 0) badges.push("✔ internally_coherent");

  return {
    corroboration_coverage: Math.round(coverage * 100) / 100,
    claim_statuses: statuses,
    coherence_badges: badges,
    disclaimer:
      "coverage = ratio of independently corroborated claims. Not a truth/trust score (editorial estimate).",
  };
}
