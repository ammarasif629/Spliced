// LLM configuration: a user-provided, ChatGPT-compatible endpoint.
//
// Resolution order — the key a journalist typed into Settings wins over the one the
// machine happens to have in its environment, because the former is an explicit act:
//
//   data/llm.json   (written via Settings; `data/` is gitignored)
//   process.env     (OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL)
//
// The key never leaves the server: the API returns only whether one is configured.

import fs from "node:fs";
import path from "node:path";

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface LlmStatus {
  configured: boolean;
  model: string;
  baseUrl: string;
  source: "settings" | "env" | "none";
  /** last 4 characters, so the UI can show *which* key without exposing it */
  keyHint: string | null;
}

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-4o-mini";

const configFile = () => path.join(process.cwd(), "data", "llm.json");

interface StoredConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

function readFileConfig(): StoredConfig {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf-8")) as StoredConfig;
  } catch {
    return {}; // absent or unreadable — fall through to the environment
  }
}

export function resolveLlmConfig(): LlmConfig | null {
  const file = readFileConfig();
  const apiKey = file.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl:
      file.baseUrl?.trim() || process.env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL,
    model: file.model?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
  };
}

export function llmStatus(): LlmStatus {
  const file = readFileConfig();
  const cfg = resolveLlmConfig();
  if (!cfg)
    return {
      configured: false,
      model: DEFAULT_MODEL,
      baseUrl: DEFAULT_BASE_URL,
      source: "none",
      keyHint: null,
    };
  return {
    configured: true,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    source: file.apiKey?.trim() ? "settings" : "env",
    keyHint: cfg.apiKey.slice(-4),
  };
}

/** Persist Settings changes. An empty apiKey clears the stored key (env can take over). */
export function saveLlmConfig(patch: StoredConfig): LlmStatus {
  const current = readFileConfig();
  const next: StoredConfig = {
    ...current,
    ...(patch.apiKey !== undefined ? { apiKey: patch.apiKey.trim() } : {}),
    ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl.trim() } : {}),
    ...(patch.model !== undefined ? { model: patch.model.trim() } : {}),
  };
  if (!next.apiKey) delete next.apiKey;
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
  return llmStatus();
}
