import { AgentRegistry, AgentAPIResponse } from "../types/index.js";
import { createLLMClient, LLMClient, LLMProvider } from "./llmClient.js";

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
   * 組合 A2A message/send endpoint URL（移除尾部斜線後附加路徑）
   */
  private buildA2AUrl(endpoint: string): string {
    return endpoint.replace(/\/$/, "") + "/message/send";
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
      } else {
        throw new Error(`不支援的 LLM 代理: ${agentId}`);
      }
    } catch (error) {
      console.error(`❌ LLM 代理 ${agentId} 呼叫失敗:`, error);
      throw error;
    }
  }

  /**
   * 景點推薦（LLM 直接回應）
   */
  private async callAttractionsLLM(data: any): Promise<AgentAPIResponse> {
    const travelInfo = this.extractTravelInfo(data.request || "");

    const prompt = `你是一位專業的旅遊景點顧問。請根據以下資訊推薦景點和美食：
- 目的地：${travelInfo.destination}
- 天數：${travelInfo.duration}天
- 預算：${travelInfo.budget ? `${travelInfo.budget}元` : "不限"}
- 偏好：${travelInfo.preferences.length > 0 ? travelInfo.preferences.join(", ") : "無特殊偏好"}
- 人數：${travelInfo.travelers}人

請提供：
1. 每天推薦的景點和美食（依天數規劃）
2. 各景點的特色說明和建議停留時間
3. 實用旅遊建議

請用繁體中文回答，格式清晰易讀。`;

    const llmClient = createLLMClient(data.provider as LLMProvider | undefined);
    const response = await llmClient.complete(prompt, {
      system: "你是一位專業的旅遊規劃師，擅長為旅客規劃客製化的旅遊行程。",
      maxTokens: 1500,
    });

    return {
      success: true,
      data: { response },
      api: "attractions",
      action: "recommend_attractions",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 住宿規劃（LLM 直接回應）
   */
  private async callAccommodationLLM(data: any): Promise<AgentAPIResponse> {
    const travelInfo = this.extractTravelInfo(data.request || "");
    const attractionList: string[] = data.attractionList || [];

    const prompt = `你是一位專業的住宿和交通規劃顧問。請根據以下資訊推薦住宿和交通方案：
- 目的地：${travelInfo.destination}
- 天數：${travelInfo.duration}天
- 預算：${travelInfo.budget ? `${travelInfo.budget}元` : "不限"}
- 人數：${travelInfo.travelers}人
- 已規劃景點：${attractionList.length > 0 ? attractionList.join(", ") : "待確認"}

請提供：
1. 推薦住宿選項（含價格區間、位置優勢）
2. 各天的交通建議（大眾運輸 / 租車 / 計程車）
3. 住宿訂房注意事項

請用繁體中文回答，格式清晰易讀。`;

    const llmClient = createLLMClient(data.provider as LLMProvider | undefined);
    const response = await llmClient.complete(prompt, {
      system: "你是一位專業的旅遊規劃師，擅長為旅客安排住宿和交通。",
      maxTokens: 1500,
    });

    return {
      success: true,
      data: { response },
      api: "accommodation",
      action: "recommend_accommodation",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 從用戶請求中提取旅遊資訊
   */
  private extractTravelInfo(request: string): any {
    const destination = this.extractDestination(request) || "台灣";
    const duration = this.extractDuration(request) || 3;
    const travelers = this.extractTravelers(request) || 1;
    const budget = this.extractBudget(request);
    const preferences = this.extractPreferences(request);

    return { destination, duration, travelers, budget, preferences };
  }

  private extractDestination(request: string): string | null {
    const cities = [
      "台北",
      "高雄",
      "台中",
      "台南",
      "新竹",
      "桃園",
      "基隆",
      "花蓮",
      "台東",
      "宜蘭",
    ];
    for (const city of cities) {
      if (request.includes(city)) return city;
    }
    return null;
  }

  private extractDuration(request: string): number {
    const match = request.match(/(\d+)\s*天/);
    return match ? parseInt(match[1]) : 3;
  }

  private extractTravelers(request: string): number {
    const match =
      request.match(/(\d+)\s*人/) || request.match(/帶\s*(\d+)\s*個/);
    return match ? parseInt(match[1]) + 1 : 1;
  }

  private extractBudget(request: string): number | null {
    const match = request.match(/預算\s*(\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  private extractPreferences(request: string): string[] {
    const preferences = [];
    if (request.includes("美食") || request.includes("餐廳"))
      preferences.push("美食");
    if (request.includes("文化") || request.includes("古蹟"))
      preferences.push("文化");
    if (request.includes("親子") || request.includes("小孩"))
      preferences.push("親子");
    if (request.includes("購物")) preferences.push("購物");
    if (request.includes("自然") || request.includes("風景"))
      preferences.push("自然");
    return preferences;
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
          // prompt override 和 provider 透過 metadata 傳遞給 sub-agent
          ...((data.promptOverride || data.provider) && {
            metadata: {
              ...(data.promptOverride && { promptOverride: data.promptOverride }),
              ...(data.provider && { provider: data.provider }),
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

      const response = await fetch(url, {
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
