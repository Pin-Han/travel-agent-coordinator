import { AgentRegistry, AgentAPIResponse } from "../types/index.js";
import { createLLMClient, LLMClient, LLMProvider } from "./llmClient.js";
import { TavilyMCPClient } from "./tavilyMCPClient.js";
import { getPrompts } from "./promptStore.js";
import {
  validateAttractions,
  validateAccommodation,
  validateTransportation,
  buildRetryFeedback,
} from "./schemaValidator.js";

/**
 * Wraps fetch with up to 2 retries on network errors or 5xx responses.
 * AbortError (timeout) is NOT retried — the caller already set its own timeout.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts = 3,
  baseDelayMs = 800
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || (res.status >= 400 && res.status < 500)) return res; // don't retry client errors
      lastErr = new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err: any) {
      if (err?.name === "AbortError") throw err; // respect timeout, don't retry
      lastErr = err;
    }
    if (attempt < maxAttempts) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[A2A] Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export class AgentRegistryService {
  private agents: Map<string, AgentRegistry> = new Map();

  constructor() {
    this.registerDefaultAgents();
  }

  /**
   * 註冊默認的旅遊代理
   * 支援 API 和 A2A 兩種模式（透過環境變數切換）
   */
  private registerDefaultAgents(): void {
    // 景點推薦代理
    // ATTRACTIONS_MODE=a2a 啟用真實 A2A 協議；預設使用 API 模式（直接 LLM）
    this.registerAgent({
      id: "attractions",
      name: "Attractions Recommendation Agent",
      endpoint:
        process.env.ATTRACTIONS_MODE === "a2a"
          ? process.env.ATTRACTIONS_AGENT_URL || "http://localhost:3001"
          : "api",
      description: "提供景點和美食推薦服務",
      capabilities: ["attractions", "restaurants", "activities"],
    });

    console.log(
      `🤖 已註冊代理: ${this.getAgent("attractions")?.name} (${
        this.getAgent("attractions")?.id
      })`
    );
    console.log(
      `   模式: ${
        this.getAgent("attractions")?.endpoint === "api" ? "LLM API" : "A2A 協議"
      }`
    );

    // 住宿規劃代理
    this.registerAgent({
      id: "accommodation",
      name: "Accommodation Planning Agent",
      endpoint:
        process.env.ACCOMMODATION_MODE === "a2a"
          ? process.env.ACCOMMODATION_AGENT_URL || "http://localhost:3002"
          : "api",
      description: "提供住宿和交通安排服務",
      capabilities: ["hotels", "transportation", "bookings"],
    });

    console.log(
      `🤖 已註冊代理: ${this.getAgent("accommodation")?.name} (${
        this.getAgent("accommodation")?.id
      })`
    );
    console.log(
      `   模式: ${
        this.getAgent("accommodation")?.endpoint === "api"
          ? "LLM API"
          : "A2A 協議"
      }`
    );

    // 交通規劃代理
    this.registerAgent({
      id: "transportation",
      name: "Transportation Planning Agent",
      endpoint:
        process.env.TRANSPORTATION_MODE === "a2a"
          ? process.env.TRANSPORTATION_AGENT_URL || "http://localhost:3003"
          : "api",
      description: "Provides daily transit routes, transport mode recommendations, and cost estimates",
      capabilities: ["transit", "routing", "transportation"],
    });

    console.log(
      `🤖 已註冊代理: ${this.getAgent("transportation")?.name} (${
        this.getAgent("transportation")?.id
      })`
    );
    console.log(
      `   模式: ${
        this.getAgent("transportation")?.endpoint === "api"
          ? "LLM API"
          : "A2A 協議"
      }`
    );

    console.log(`🤖 已註冊 ${this.agents.size} 個代理服務`);
  }

  /**
   * 註冊新代理
   */
  registerAgent(agent: AgentRegistry): void {
    this.agents.set(agent.id, agent);
    console.log(`🤖 已註冊代理: ${agent.name} (${agent.id})`);
  }

  /**
   * 獲取代理資訊
   */
  getAgent(agentId: string): AgentRegistry | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 獲取所有可用的 Agent IDs
   */
  getAvailableAgents(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * 獲取所有代理
   */
  getAllAgents(): AgentRegistry[] {
    return Array.from(this.agents.values());
  }

  /**
   * 檢查代理是否存在
   */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * 呼叫代理 API
   */
  async callAgentAPI(
    agentId: string,
    action: string,
    data: any,
    timeout: number = 30000
  ): Promise<AgentAPIResponse> {
    const agent = this.getAgent(agentId);

    if (!agent) {
      return {
        success: false,
        error: `找不到代理: ${agentId}`,
        api: agentId,
        action,
        timestamp: new Date().toISOString(),
      };
    }

    console.log(`🔗 呼叫代理: ${agent.name} (${action})`);

    try {
      if (agent.endpoint === "api") {
        return await this.callLLMAgent(agentId, action, data);
      } else {
        return await this.callA2AAgent(agent, action, data, timeout);
      }
    } catch (error) {
      console.error(`❌ 代理 ${agent.name} 呼叫失敗:`, error);

      return {
        success: false,
        error: error instanceof Error ? error.message : "未知錯誤",
        api: agentId,
        action,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * A2A SDK v0.3.1 routes all JSON-RPC at POST /
   * The method name (e.g. "message/send") is in the request body, not the URL.
   */
  private buildA2AUrl(endpoint: string): string {
    return endpoint.replace(/\/$/, "") + "/";
  }

  /**
   * 以 Anthropic Claude 直接處理請求（API 模式，無獨立 sub-agent process）
   */
  private async callLLMAgent(
    agentId: string,
    action: string,
    data: any
  ): Promise<AgentAPIResponse> {
    console.log(`🔗 以 LLM 直接回應: ${agentId} (${action})`);

    try {
      if (agentId === "attractions") {
        return await this.callAttractionsLLM(data);
      } else if (agentId === "accommodation") {
        return await this.callAccommodationLLM(data);
      } else if (agentId === "transportation") {
        return await this.callTransportationLLM(data);
      } else {
        throw new Error(`不支援的 LLM 代理: ${agentId}`);
      }
    } catch (error) {
      console.error(`❌ LLM 代理 ${agentId} 呼叫失敗:`, error);
      throw error;
    }
  }

  /**
   * Schema validation + one-shot retry helper.
   * Returns { text, structuredData } — structuredData is null on graceful degradation.
   */
  private async validateAndRetry<T>(
    agentId: string,
    firstText: string,
    validator: (raw: string) => { valid: boolean; data?: T; errors: string[] },
    retry: () => Promise<string>
  ): Promise<{ text: string; structuredData: T | null }> {
    const first = validator(firstText);
    if (first.valid && first.data) {
      console.log(`[SchemaValidator] ${agentId} — validation passed on first try`);
      return { text: JSON.stringify(first.data), structuredData: first.data };
    }

    console.warn(`[SchemaValidator] ${agentId} — validation failed: ${first.errors.join("; ")}. Retrying...`);
    const retryText = await retry();
    const second = validator(retryText);
    if (second.valid && second.data) {
      console.log(`[SchemaValidator] ${agentId} — validation passed after retry`);
      return { text: JSON.stringify(second.data), structuredData: second.data };
    }

    console.warn(`[SchemaValidator] ${agentId} — retry also failed (${second.errors.join("; ")}). Falling back to plain text.`);
    return { text: firstText, structuredData: null };
  }

  /**
   * 景點推薦（LLM 直接回應）— uses promptStore as single source of truth
   */
  private async callAttractionsLLM(data: any): Promise<AgentAPIResponse> {
    const { attractions } = getPrompts();
    const systemPrompt: string = data.promptOverride?.system ?? attractions.system;
    const userTemplate: string = data.promptOverride?.user ?? attractions.user;

    // Enrich request with real web data from Tavily
    const tavilyClient = TavilyMCPClient.getInstance();
    const searchData = await tavilyClient.search(
      `${data.request} top attractions must-see travel guide`,
      8
    );
    const enrichedRequest = searchData
      ? `${data.request}\n\nReal travel data from web search:\n${searchData}`
      : data.request;

    const prompt = userTemplate.replace("{request}", enrichedRequest || "") + "\n\nBegin JSON:";
    const llmClient = createLLMClient(data.provider as LLMProvider | undefined);
    const llmResult = await llmClient.complete(prompt, { system: systemPrompt, maxTokens: 1500 });

    const { text, structuredData } = await this.validateAndRetry(
      "attractions",
      llmResult.text,
      validateAttractions,
      async () => {
        const feedback = buildRetryFeedback("attractions", validateAttractions(llmResult.text).errors);
        const retryResult = await llmClient.complete(
          `${prompt}\n\n${feedback}`,
          { system: systemPrompt, maxTokens: 1500 }
        );
        return retryResult.text;
      }
    );

    return {
      success: true,
      data: { response: text, structuredData, tokenUsage: llmResult.usage },
      api: "attractions",
      action: "recommend_attractions",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 住宿規劃（LLM 直接回應）— uses promptStore as single source of truth
   */
  private async callAccommodationLLM(data: any): Promise<AgentAPIResponse> {
    const { accommodation } = getPrompts();
    const systemPrompt: string = data.promptOverride?.system ?? accommodation.system;
    const userTemplate: string = data.promptOverride?.user ?? accommodation.user;

    const attractionArea: string = data.attractionArea || "";

    // Search hotels near attraction area
    const tavilyClient = TavilyMCPClient.getInstance();
    const searchQuery = attractionArea
      ? `hotels accommodation near ${attractionArea} budget`
      : `hotels accommodation ${data.request} budget`;
    const searchData = await tavilyClient.search(searchQuery, 6);

    const contextLines = [
      attractionArea ? `Attraction areas (for proximity): ${attractionArea}` : "",
      searchData ? `\nReal hotel data from web search:\n${searchData}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const enrichedRequest = contextLines
      ? `${data.request}\n\n${contextLines}`
      : data.request;

    const prompt = userTemplate.replace("{request}", enrichedRequest || "") + "\n\nBegin JSON:";
    const llmClient = createLLMClient(data.provider as LLMProvider | undefined);
    const llmResult = await llmClient.complete(prompt, { system: systemPrompt, maxTokens: 1500 });

    const { text, structuredData } = await this.validateAndRetry(
      "accommodation",
      llmResult.text,
      validateAccommodation,
      async () => {
        const feedback = buildRetryFeedback("accommodation", validateAccommodation(llmResult.text).errors);
        const retryResult = await llmClient.complete(
          `${prompt}\n\n${feedback}`,
          { system: systemPrompt, maxTokens: 1500 }
        );
        return retryResult.text;
      }
    );

    return {
      success: true,
      data: { response: text, structuredData, tokenUsage: llmResult.usage },
      api: "accommodation",
      action: "recommend_accommodation",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 交通規劃（LLM 直接回應）— uses promptStore as single source of truth
   */
  private async callTransportationLLM(data: any): Promise<AgentAPIResponse> {
    const { transportation } = getPrompts();
    const systemPrompt: string = data.promptOverride?.system ?? transportation.system;
    const userTemplate: string = data.promptOverride?.user ?? transportation.user;

    const attractionArea: string = data.attractionArea || "";
    const accommodationArea: string = data.accommodationArea || "";

    // Search real transit information
    const tavilyClient = TavilyMCPClient.getInstance();
    const searchQuery = attractionArea
      ? `public transit guide ${attractionArea} subway bus routes`
      : `public transit guide ${data.request} transportation`;
    const searchData = await tavilyClient.search(searchQuery, 6);

    const contextLines = [
      attractionArea ? `Attraction areas: ${attractionArea}` : "",
      accommodationArea ? `Accommodation location: ${accommodationArea}` : "",
      searchData ? `\nReal transit data from web search:\n${searchData}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const enrichedRequest = contextLines
      ? `${data.request}\n\n${contextLines}`
      : data.request;

    const prompt = userTemplate.replace("{request}", enrichedRequest || "") + "\n\nBegin JSON:";
    const llmClient = createLLMClient(data.provider as LLMProvider | undefined);
    const llmResult = await llmClient.complete(prompt, { system: systemPrompt, maxTokens: 1500 });

    const { text, structuredData } = await this.validateAndRetry(
      "transportation",
      llmResult.text,
      validateTransportation,
      async () => {
        const feedback = buildRetryFeedback("transportation", validateTransportation(llmResult.text).errors);
        const retryResult = await llmClient.complete(
          `${prompt}\n\n${feedback}`,
          { system: systemPrompt, maxTokens: 1500 }
        );
        return retryResult.text;
      }
    );

    return {
      success: true,
      data: { response: text, structuredData, tokenUsage: llmResult.usage },
      api: "transportation",
      action: "recommend_transportation",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 呼叫 A2A Agent（JSON-RPC 2.0 協議）
   */
  private async callA2AAgent(
    agent: AgentRegistry,
    action: string,
    data: any,
    timeout: number
  ): Promise<AgentAPIResponse> {
    const jsonRpcRequest = {
      jsonrpc: "2.0",
      method: "message/send",
      id: `coordinator-${Date.now()}`,
      params: {
        message: {
          messageId: `msg-${Date.now()}`,
          role: "user",
          parts: [
            {
              kind: "text",
              text: data.request || JSON.stringify(data),
            },
          ],
          // prompt override, provider, attractionArea, accommodationArea 透過 metadata 傳遞給 sub-agent
          ...((data.promptOverride || data.provider || data.attractionArea || data.accommodationArea) && {
            metadata: {
              ...(data.promptOverride && { promptOverride: data.promptOverride }),
              ...(data.provider && { provider: data.provider }),
              ...(data.attractionArea && { attractionArea: data.attractionArea }),
              ...(data.accommodationArea && { accommodationArea: data.accommodationArea }),
            },
          }),
          kind: "message",
        },
      },
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "A2A-Travel-Coordinator/1.0",
    };

    if (agent.apiKey) {
      headers["Authorization"] = `Bearer ${agent.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const url = this.buildA2AUrl(agent.endpoint);
      console.log(`📡 發送 A2A 請求到 ${url}`);

      const response = await fetchWithRetry(url, {
        method: "POST",
        headers,
        body: JSON.stringify(jsonRpcRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as any;

      if (result.error) {
        throw new Error(`A2A Error: ${result.error.message}`);
      }

      console.log(`✅ A2A 代理 ${agent.name} 回應成功`);

      // 從 Task artifacts 提取文字回應
      const task = result.result;
      let responseText = "";
      if (task?.artifacts?.[0]?.parts?.[0]?.text) {
        responseText = task.artifacts[0].parts[0].text;
      } else if (task?.status?.message?.parts?.[0]?.text) {
        responseText = task.status.message.parts[0].text;
      }

      return {
        success: true,
        data: { response: responseText, task },
        api: agent.id,
        action,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      clearTimeout(timeoutId);

      let errorMessage = "未知錯誤";
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          errorMessage = `A2A 請求超時 (${timeout}ms)`;
        } else {
          errorMessage = error.message;
        }
      }

      console.error(`❌ A2A 代理 ${agent.name} 呼叫失敗: ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  /**
   * 批量呼叫多個代理
   */
  async callMultipleAgents(
    requests: Array<{ agentId: string; action: string; data: any }>
  ): Promise<AgentAPIResponse[]> {
    console.log(`🚀 批量呼叫 ${requests.length} 個代理...`);

    const promises = requests.map((request) =>
      this.callAgentAPI(request.agentId, request.action, request.data)
    );

    try {
      const results = await Promise.all(promises);

      const successCount = results.filter((r) => r.success).length;
      console.log(`📊 批量呼叫完成: ${successCount}/${results.length} 成功`);

      return results;
    } catch (error) {
      console.error("❌ 批量呼叫失敗:", error);
      throw error;
    }
  }

  /**
   * 檢查代理健康狀態
   * - API 模式：嘗試一次輕量 LLM 呼叫確認 Anthropic 連線正常
   * - A2A 模式：呼叫 sub-agent 的 GET /health
   */
  async checkAgentHealth(agentId: string): Promise<boolean> {
    const agent = this.getAgent(agentId);
    if (!agent) return false;

    try {
      if (agent.endpoint === "api") {
        // API 模式：驗證對應的 API key 存在即可（不打真實 API 節省費用）
        const provider = process.env.LLM_PROVIDER || "anthropic";
        const hasKey = provider === "gemini"
          ? !!process.env.GEMINI_API_KEY
          : !!process.env.ANTHROPIC_API_KEY;
        return hasKey;
      } else {
        // A2A 模式：呼叫 sub-agent /health endpoint
        const healthUrl = `${agent.endpoint}/health`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
          const response = await fetch(healthUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          return response.ok;
        } catch {
          clearTimeout(timeoutId);
          return false;
        }
      }
    } catch (error) {
      console.warn(`代理 ${agentId} 健康檢查失敗:`, error);
      return false;
    }
  }

  /**
   * 獲取所有代理的健康狀態
   */
  async getAllAgentsHealth(): Promise<Record<string, boolean>> {
    const agents = this.getAllAgents();
    const healthChecks = await Promise.all(
      agents.map(async (agent) => ({
        id: agent.id,
        healthy: await this.checkAgentHealth(agent.id),
      }))
    );

    const healthStatus: Record<string, boolean> = {};
    healthChecks.forEach((check) => {
      healthStatus[check.id] = check.healthy;
    });

    return healthStatus;
  }
}
