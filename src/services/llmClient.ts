import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface LLMOptions {
  maxTokens?: number;
  model?: string;
  system?: string;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  text: string;
  usage?: LLMUsage;
}

// ─── Tool Use Types ───────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

/** LLM requested a tool call */
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, any>;
}

/** Plain text in an LLM turn */
export interface TextBlock {
  type: "text";
  text: string;
}

export type LLMContentBlock = TextBlock | ToolUseBlock;

/** Tool result placed in a user-role message */
export interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  tool_name?: string; // required for Gemini conversion
  content: string;
}

export interface LLMMessage {
  role: "user" | "assistant";
  content: string | LLMContentBlock[] | ToolResultContent[];
}

export interface LLMToolTurnResponse {
  content: LLMContentBlock[];
  usage?: LLMUsage;
}

export interface LLMClient {
  complete(prompt: string, options?: LLMOptions): Promise<LLMResponse>;
  completeWithTools?(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    options?: LLMOptions
  ): Promise<LLMToolTurnResponse>;
  readonly provider: string;
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

/**
 * Retries `fn` up to `maxAttempts` times with exponential backoff.
 * Only retries on transient errors (network / rate limit); re-throws immediately on 4xx auth errors.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 800
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      // Don't retry on auth / bad-request errors
      const status = err?.status ?? err?.statusCode;
      if (status && status >= 400 && status < 500 && status !== 429) throw err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[LLM] Attempt ${attempt} failed, retrying in ${delay}ms...`, err?.message ?? err);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
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

  async complete(prompt: string, options: LLMOptions = {}): Promise<LLMResponse> {
    const { maxTokens = 2048, model = this.defaultModel, system } = options;

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    };
    if (system) params.system = system;

    const message = await withRetry(() => this.client.messages.create(params));
    const content = message.content[0];
    if (content.type !== "text") throw new Error("Expected text response");

    return {
      text: content.text,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    };
  }

  async completeWithTools(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    options: LLMOptions = {}
  ): Promise<LLMToolTurnResponse> {
    const { maxTokens = 4096, model = this.defaultModel, system } = options;

    const params: any = {
      model,
      max_tokens: maxTokens,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string"
          ? m.content
          : (m.content as any[]).map((block) => {
              if (block.type === "text") return { type: "text", text: block.text };
              if (block.type === "tool_use") return { type: "tool_use", id: block.id, name: block.name, input: block.input };
              if (block.type === "tool_result") return { type: "tool_result", tool_use_id: block.tool_use_id, content: block.content };
              return block;
            }),
      })),
    };
    if (system) params.system = system;

    const message = await withRetry(() => this.client.messages.create(params));

    const content: LLMContentBlock[] = message.content
      .map((block): LLMContentBlock | null => {
        if (block.type === "text") return { type: "text", text: block.text };
        if (block.type === "tool_use") return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input as Record<string, any>,
        };
        return null;
      })
      .filter((b): b is LLMContentBlock => b !== null);

    return {
      content,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    };
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

  async complete(prompt: string, options: LLMOptions = {}): Promise<LLMResponse> {
    const { maxTokens = 2048, model = this.defaultModel, system } = options;

    const geminiModel = this.genAI.getGenerativeModel({
      model,
      systemInstruction: system,
      generationConfig: { maxOutputTokens: maxTokens },
    });

    const result = await withRetry(() => geminiModel.generateContent(prompt));
    const meta = result.response.usageMetadata;

    return {
      text: result.response.text(),
      usage: meta
        ? {
            inputTokens: meta.promptTokenCount ?? 0,
            outputTokens: meta.candidatesTokenCount ?? 0,
          }
        : undefined,
    };
  }

  /** Convert our canonical ToolDefinition[] to Gemini FunctionDeclaration[] */
  private toGeminiFunctions(tools: ToolDefinition[]): any[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: t.input_schema.properties,
        required: t.input_schema.required ?? [],
      },
    }));
  }

  /** Convert LLMMessage[] to Gemini Content[] format */
  private toGeminiContents(messages: LLMMessage[]): any[] {
    return messages.map((m) => {
      const role = m.role === "assistant" ? "model" : "user";

      if (typeof m.content === "string") {
        return { role, parts: [{ text: m.content }] };
      }

      const parts: any[] = [];
      for (const block of m.content as any[]) {
        if (block.type === "text") {
          parts.push({ text: block.text });
        } else if (block.type === "tool_use") {
          parts.push({ functionCall: { name: block.name, args: block.input } });
        } else if (block.type === "tool_result") {
          // Gemini requires the function name in functionResponse
          let responseObj: any;
          try {
            responseObj = JSON.parse(block.content);
          } catch {
            responseObj = { text: block.content };
          }
          parts.push({
            functionResponse: {
              name: block.tool_name ?? "call_agent",
              response: { result: responseObj },
            },
          });
        }
      }
      return { role, parts };
    });
  }

  async completeWithTools(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    options: LLMOptions = {}
  ): Promise<LLMToolTurnResponse> {
    const { maxTokens = 4096, model = this.defaultModel, system } = options;

    const geminiModel = this.genAI.getGenerativeModel({
      model,
      systemInstruction: system,
      generationConfig: { maxOutputTokens: maxTokens },
      tools: [{ functionDeclarations: this.toGeminiFunctions(tools) }],
    });

    const contents = this.toGeminiContents(messages);
    const result = await withRetry(() => geminiModel.generateContent({ contents } as any));

    const parts: any[] = result.response.candidates?.[0]?.content?.parts ?? [];
    const content: LLMContentBlock[] = [];

    for (const part of parts) {
      if (part.text) {
        content.push({ type: "text", text: part.text });
      } else if (part.functionCall) {
        content.push({
          type: "tool_use",
          id: `gemini-${part.functionCall.name ?? "tool"}-${Date.now()}`,
          name: part.functionCall.name ?? "",
          input: (part.functionCall.args ?? {}) as Record<string, any>,
        });
      }
    }

    const meta = result.response.usageMetadata;
    return {
      content,
      usage: meta
        ? {
            inputTokens: meta.promptTokenCount ?? 0,
            outputTokens: meta.candidatesTokenCount ?? 0,
          }
        : undefined,
    };
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
