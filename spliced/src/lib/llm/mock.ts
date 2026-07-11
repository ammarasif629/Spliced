import type { LLMProvider } from "./provider";

// 오프라인/키 없음 데모용 결정적 mock.
// 어떤 프롬프트 단계인지 system 문자열로 판별해 그럴듯한 구조를 돌려준다.
export class MockProvider implements LLMProvider {
  name = "mock";
  model = "mock";

  async complete(system: string, user: string): Promise<Record<string, unknown>> {
    if (system.includes("STAGE:EXTRACT")) {
      const raw = extractRawText(user);
      const sentences = raw
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 5)
        .slice(0, 4);
      return {
        claims: sentences.map((s) => ({
          text: s.replace(/[.]$/, ""),
          asserted_time: null,
          event_title: "Tip received",
          subject_name: null,
        })),
        entities: [],
        temporal_refs: [],
      };
    }
    if (system.includes("STAGE:EVENT_TITLE")) {
      try {
        const { claims } = JSON.parse(user) as { claims: string[] };
        const first = (claims?.[0] ?? "").split(/\s+/).slice(0, 9).join(" ");
        return { subtitle: first ? `${first}…` : "Events recorded" };
      } catch {
        return { subtitle: "Events recorded" };
      }
    }
    if (system.includes("STAGE:CONSISTENCY")) {
      // mock은 근거를 인용할 수 없으므로 원칙(§0.2)대로 insufficient evidence
      return { flags: [], note: "insufficient_evidence (mock provider)" };
    }
    if (system.includes("STAGE:CONFLICTS")) {
      // Deciding whether two statements can logically coexist requires semantics.
      // A keyword heuristic here would emit false contradictions between claims that
      // merely share vocabulary — worse than silence in an investigative tool. So the
      // offline provider reports nothing and journalist-authored `contradicts` links
      // remain the only source of conflict. Set OPENAI_API_KEY for real analysis.
      return { conflicts: [], note: "insufficient_evidence (mock provider)" };
    }
    if (system.includes("STAGE:SUMMARIZE")) {
      const raw = extractRawText(user);
      const first = raw.split(/\s+/).slice(0, 8).join(" ");
      return {
        title: first + (raw.length > first.length ? "…" : ""),
        summary_3line: raw.slice(0, 180),
        detail: "Mock provider summary — set OPENAI_API_KEY for real analysis.",
        needs_verification: ["All claims (mock analysis)"],
      };
    }
    return {};
  }
}

function extractRawText(user: string): string {
  const m = user.match(/<testimony>([\s\S]*?)<\/testimony>/);
  return (m ? m[1] : user).trim();
}
