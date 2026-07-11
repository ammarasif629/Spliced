import OpenAI from "openai";
import type { LLMProvider } from "./provider";
import type { LlmConfig } from "./config";

/** Any ChatGPT-compatible endpoint: OpenAI, Azure-style gateways, local servers. */
export class OpenAIProvider implements LLMProvider {
  name = "openai";
  readonly model: string;
  private client: OpenAI;

  constructor(cfg: LlmConfig) {
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
    this.model = cfg.model;
  }

  async complete(system: string, user: string): Promise<Record<string, unknown>> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        // prompt-injection 방어(§9): 사용자/증언 텍스트는 데이터로만 취급된다는 래핑
        { role: "user", content: user },
      ],
    });
    const text = res.choices[0]?.message?.content ?? "{}";
    return JSON.parse(text);
  }
}
