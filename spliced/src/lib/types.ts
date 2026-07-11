// 공유 타입 — DB 레코드와 API 응답 형태
// 주의: 어떤 타입에도 "신뢰 점수" 필드가 없다. coverage는 read-time 파생값(§0.1).

export type LinkKind =
  | "supports"
  | "contradicts"
  | "direct_evidence"
  | "weak_assoc"
  | "inference";

// 흰 배경에서 선명하도록 한 단계 깊은 톤 (지지=포인트 컬러와 통일)
export const LINK_COLORS: Record<LinkKind, string> = {
  supports: "#1971C2", // 파랑 (포인트 컬러)
  contradicts: "#E03131", // 빨강
  direct_evidence: "#2F9E44", // 초록
  weak_assoc: "#E8590C", // 주황
  inference: "#9C36B5", // 보라
};

export interface Newsroom {
  id: string;
  name: string;
}

export interface EventPlane {
  id: string;
  title: string;
  ai_subtitle?: string | null; // AI-generated day summary (date is the primary label)
  occurred_at: string | null;
  occurred_precision: string | null;
}

export interface ClaimRecord {
  id: string;
  testimony_id: string;
  text: string;
  event_id: string | null;
  asserted_time: string | null;
  coherence_flags: string[];
  status: "active" | "rejected";
  testimony_status?: "active" | "rejected";
  source_label?: string;
  /** 증언한 인물/조직의 source id — 같은 증인의 자기모순 판정에 쓰인다 */
  source_id?: string;
  /** 증언이 이루어진 날짜 (testimony.given_at) — 카드에 표시되고 AI 분석에 들어간다 */
  given_at?: string | null;
}

export interface LinkRecord {
  id: string;
  from_claim: string;
  to_claim: string | null;
  evidence_id: string | null;
  kind: LinkKind;
  /** 'ai_conflict'는 LLM 충돌 분석이 만든 링크 — 재분석 때 해당 범위가 교체된다 */
  origin?: "manual" | "ai_conflict";
  /** 충돌 근거 (LLM이 인용한 이유) */
  note?: string | null;
  dimension?: string | null;
  confidence?: number | null;
  analyzed_at?: string | null;
}

/** LLM이 판정한 모순 1건. 카드 강조와 빨간 선은 전부 이 레코드로 그린다. */
export interface ConflictRecord {
  id: string; // rel_claim_link.id
  claim_a: string;
  claim_b: string;
  testimony_a: string;
  testimony_b: string;
  witness_a: string;
  witness_b: string;
  text_a: string;
  text_b: string;
  /** 같은 증인의 자기모순인가 — 모델 의견이 아니라 DB의 source_id로 재계산한다 */
  self: boolean;
  dimension: string | null;
  reason: string | null;
  /** 0..1, 두 "진술"이 양립 불가능하다는 확신도. 인물 신뢰도가 아니다. */
  confidence: number | null;
  origin: "manual" | "ai_conflict";
  analyzed_at: string | null;
}

/** 마지막 LLM 분석의 구조화된 산출물 — 그래프 페이로드에 실려 UI가 직접 렌더한다 */
export interface AnalysisDoc {
  newsroom_id: string;
  analyzed_at: string | null;
  provider: string | null;
  model: string | null;
  claim_count: number;
  conflicts: ConflictRecord[];
}

export interface EvidenceRecord {
  id: string;
  kind: string | null;
  title: string | null;
  provenance: string | null;
}

export interface TestimonyRecord {
  id: string;
  source_id: string;
  raw_text: string;
  given_at: string | null;
  ai_title: string | null;
  ai_summary: string | null;
  ai_detail: string | null;
  analysis_status: "pending" | "running" | "done" | "failed";
  status: "active" | "rejected";
  created_at: string;
  source_label?: string;
  source_role?: string | null;
}

export interface SourceAttribute {
  id: string;
  category: string;
  statement: string;
  citation_url: string | null;
  citation_note: string | null;
  is_allegation: boolean;
  verified_by_name: string | null;
  restricted: boolean;
}

export interface SourceContext {
  source_id: string;
  label: string;
  role: string | null;
  attributes: SourceAttribute[];
  disclaimer: string;
}

/** GET /testimonies/{id}/assessment 응답 — DB 저장값 아님, 조회 시 파생 */
export interface Assessment {
  testimony_id: string;
  corroboration_coverage: number;
  claim_breakdown: {
    claim_id: string;
    claim: string;
    status: "corroborated" | "contested" | "refuted" | "uncorroborated";
    supporting_evidence: number;
    contradicting: number;
    has_direct_evidence: boolean;
  }[];
  coherence_badges: string[];
  source_context: SourceContext | null;
  conflicts: { with_testimony: string; claim: string; type: string }[];
  disclaimer: string;
}

export interface GraphPayload {
  planes: EventPlane[];
  claims: ClaimRecord[];
  links: LinkRecord[];
  evidence: EvidenceRecord[];
  /** 저장된 LLM 분석 결과. UI는 이걸 그대로 그린다(재파생하지 않는다). */
  analysis?: AnalysisDoc;
}
