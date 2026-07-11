// §9 — provider 공통 인터페이스. 라우팅은 사용자 설정(data/llm.json) → 환경변수 순.
// 모든 provider는 JSON 객체를 반환해야 하며, 실패 시 예외를 던진다.

export interface LLMProvider {
  name: string;
  /** the concrete model id — part of the analysis cache key */
  model: string;
  complete(system: string, user: string): Promise<Record<string, unknown>>;
}

import { OpenAIProvider } from "./openai";
import { MockProvider } from "./mock";
import { resolveLlmConfig } from "./config";

let cached: { key: string; provider: LLMProvider } | null = null;

export function getProvider(): LLMProvider {
  const cfg = resolveLlmConfig();
  // Re-key the cache on the resolved config so saving a new key in Settings takes
  // effect on the very next analysis, without restarting the server.
  const key = cfg ? `${cfg.baseUrl}|${cfg.model}|${cfg.apiKey.slice(-6)}` : "mock";
  if (cached?.key === key) return cached.provider;
  const provider = cfg ? new OpenAIProvider(cfg) : new MockProvider();
  cached = { key, provider };
  return provider;
}

/** True when a real LLM is wired up — the UI warns when it is not. */
export function llmEnabled(): boolean {
  return resolveLlmConfig() !== null;
}
