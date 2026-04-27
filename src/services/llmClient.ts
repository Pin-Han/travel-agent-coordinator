import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface LLMOptions {
  maxTokens?: number;
  model?: string;
  system?: string;
}

export interface LLMClient {
  complete(prompt: string, options?: LLMOptions): Promise<string>;
  readonly provider: string;
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

export class AnthropicClient implements LLMClient {
  readonly provider = "anthropic";
  private client: Anthropic;
  private defaultModel: string;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY 環境變數是必須的");
    this.client = new Anthropic({ apiKey });
    this.defaultModel =
      process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
  }

  async complete(prompt: string, options: LLMOptions = {}): Promise<string> {
    const { maxTokens = 2048, model = this.defaultModel, system } = options;

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    };
    if (system) params.system = system;

    const message = await this.client.messages.create(params);
    const content = message.content[0];
    if (content.type !== "text") throw new Error("Expected text response");
    return content.text;
  }
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

export class GeminiClient implements LLMClient {
  readonly provider = "gemini";
  private genAI: GoogleGenerativeAI;
  private defaultModel: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY 環境變數是必須的");
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.defaultModel = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  }

  async complete(prompt: string, options: LLMOptions = {}): Promise<string> {
    const { maxTokens = 2048, model = this.defaultModel, system } = options;

    const geminiModel = this.genAI.getGenerativeModel({
      model,
      systemInstruction: system,
      generationConfig: { maxOutputTokens: maxTokens },
    });

    const result = await geminiModel.generateContent(prompt);
    return result.response.text();
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export type LLMProvider = "anthropic" | "gemini";

/**
 * 根據 provider 名稱建立對應的 LLM client。
 * 優先順序：參數 > LLM_PROVIDER 環境變數 > 預設 anthropic
 */
export function createLLMClient(provider?: LLMProvider): LLMClient {
  const selected =
    provider ||
    (process.env.LLM_PROVIDER as LLMProvider) ||
    "anthropic";

  switch (selected) {
    case "gemini":
      return new GeminiClient();
    case "anthropic":
    default:
      return new AnthropicClient();
  }
}
