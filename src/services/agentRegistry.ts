import { AgentRegistry, AgentAPIResponse } from "../types/index.js";
import { MetrioAIClient } from "./metrioClient.js";

export class AgentRegistryService {
  private agents: Map<string, AgentRegistry> = new Map();
  private metrioClient: MetrioAIClient;

  constructor() {
    this.metrioClient = new MetrioAIClient();
    this.registerDefaultAgents();
  }

  /**
   * 註冊默認的旅遊代理 (使用 Metrio AI API)
   */
  private registerDefaultAgents(): void {
    // 註冊可用的代理服務
    // 支援 API 和 A2A 兩種模式

    // 景點推薦代理
    // 環境變數控制使用模式：ATTRACTIONS_MODE=a2a 啟用 A2A 協議
    this.registerAgent({
      id: "attractions",
      name: "Attractions Recommendation Agent",
      endpoint:
        process.env.ATTRACTIONS_MODE === "a2a"
          ? process.env.ATTRACTIONS_AGENT_URL || "http://localhost:3001"
          : "api", // 預設使用 API 模式
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
        this.getAgent("attractions")?.endpoint === "api"
          ? "Metrio AI API"
          : "A2A 協議"
      }`
    );

    // 住宿規劃代理
    this.registerAgent({
      id: "accommodation",
      name: "Accommodation Planning Agent",
      endpoint:
        process.env.ACCOMMODATION_MODE === "a2a"
          ? process.env.ACCOMMODATION_AGENT_URL || "http://localhost:3002"
          : "api", // 預設使用 API 模式
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
          ? "Metrio AI API"
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
   * 呼叫代理 API (整合 Metrio AI)
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
      // 根據端點類型決定調用方式
      if (agent.endpoint === "api") {
        // 使用 Metrio AI API 調用
        return await this.callMetrioAgent(agentId, action, data);
      } else {
        // 使用 A2A 標準協議進行通信
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
   * 呼叫 Metrio AI 代理
   */
  private async callMetrioAgent(
    agentId: string,
    action: string,
    data: any
  ): Promise<AgentAPIResponse> {
    console.log(`🔗 呼叫 Metrio AI 代理: ${agentId} (${action})`);

    try {
      if (agentId === "attractions") {
        return await this.callAttractionsAPI(action, data);
      } else if (agentId === "accommodation") {
        return await this.callAccommodationAPI(action, data);
      } else {
        throw new Error(`不支援的 Metrio AI 代理: ${agentId}`);
      }
    } catch (error) {
      console.error(`❌ Metrio AI 代理 ${agentId} 呼叫失敗:`, error);
      throw error;
    }
  }

  /**
   * 呼叫景點推薦 API (Metrio AI)
   */
  private async callAttractionsAPI(
    action: string,
    data: any
  ): Promise<AgentAPIResponse> {
    // 從用戶請求中提取結構化資訊
    const travelInfo = this.extractTravelInfo(data.request || "");

    return await this.metrioClient.getAttractionRecommendations(
      travelInfo.destination,
      travelInfo.preferences,
      travelInfo.budget,
      travelInfo.duration,
      travelInfo.travelers
    );
  }

  /**
   * 呼叫住宿與交通 API (Metrio AI)
   */
  private async callAccommodationAPI(
    action: string,
    data: any
  ): Promise<AgentAPIResponse> {
    // 從用戶請求中提取結構化資訊
    const travelInfo = this.extractTravelInfo(data.request || "");

    // 如果有景點資訊，從 data 中提取
    const attractionList = data.attractionList || [];

    return await this.metrioClient.getAccommodationAndTransport(
      travelInfo.destination,
      travelInfo.duration,
      travelInfo.budget,
      travelInfo.travelers,
      attractionList
    );
  }

  /**
   * 呼叫預算分析 API (內建計算)
   */
  private async callBudgetAPI(
    action: string,
    data: any
  ): Promise<AgentAPIResponse> {
    const { request = "" } = data;

    try {
      // 從用戶請求中提取資訊
      const travelInfo = this.extractTravelInfo(request);

      // 根據目的地調整基礎費用
      const baseCosts = this.getBaseCostsByDestination(travelInfo.destination);

      // 計算各項費用
      const totalFood = baseCosts.daily_food * travelInfo.duration;
      const totalAttractions =
        baseCosts.attractions_per_day * travelInfo.duration;
      const totalTransportation =
        baseCosts.transportation_daily * travelInfo.duration;
      const totalAccommodation =
        baseCosts.accommodation_per_night *
        Math.max(0, travelInfo.duration - 1);

      const subtotal =
        totalFood + totalAttractions + totalTransportation + totalAccommodation;

      // 根據旅客人數和偏好調整
      const adjustmentFactor = this.calculateAdjustmentFactor(travelInfo);
      const totalBudget = Math.round(subtotal * adjustmentFactor);

      const budgetBreakdown = {
        destination: travelInfo.destination,
        duration: `${travelInfo.duration} 天`,
        travelers: travelInfo.travelers,
        breakdown: {
          food: {
            amount: Math.round(totalFood * adjustmentFactor),
            description: `餐費 (${baseCosts.daily_food}/天/人)`,
          },
          attractions: {
            amount: Math.round(totalAttractions * adjustmentFactor),
            description: `景點門票 (${baseCosts.attractions_per_day}/天)`,
          },
          transportation: {
            amount: Math.round(totalTransportation * adjustmentFactor),
            description: `交通費 (${baseCosts.transportation_daily}/天)`,
          },
          accommodation: {
            amount: Math.round(totalAccommodation * adjustmentFactor),
            description: `住宿費 (${baseCosts.accommodation_per_night}/晚)`,
          },
        },
        total: totalBudget,
        currency: "TWD",
        recommendations: this.generateBudgetRecommendations(
          travelInfo,
          totalBudget
        ),
      };

      return {
        success: true,
        data: {
          budget_analysis: budgetBreakdown,
          summary: `${travelInfo.destination} ${
            travelInfo.duration
          }天旅遊預估總預算：${totalBudget.toLocaleString()} 元 (${
            travelInfo.travelers
          }人)`,
        },
        api: "budget",
        action,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "預算計算失敗",
        api: "budget",
        action,
        timestamp: new Date().toISOString(),
      };
    }
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
    return match ? parseInt(match[1]) + 1 : 1; // +1 for the person asking
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
   * 根據目的地獲取基礎費用
   */
  private getBaseCostsByDestination(destination: string): any {
    const baseCosts: Record<string, any> = {
      台北: {
        daily_food: 1000,
        attractions_per_day: 600,
        transportation_daily: 300,
        accommodation_per_night: 2500,
      },
      高雄: {
        daily_food: 800,
        attractions_per_day: 500,
        transportation_daily: 200,
        accommodation_per_night: 2000,
      },
      台中: {
        daily_food: 850,
        attractions_per_day: 450,
        transportation_daily: 250,
        accommodation_per_night: 2200,
      },
      default: {
        daily_food: 800,
        attractions_per_day: 500,
        transportation_daily: 200,
        accommodation_per_night: 2000,
      },
    };

    return baseCosts[destination] || baseCosts["default"];
  }

  /**
   * 計算調整因子
   */
  private calculateAdjustmentFactor(travelInfo: any): number {
    let factor = 1.0;

    // 根據旅客人數調整
    if (travelInfo.travelers > 1) {
      factor *= 1 + (travelInfo.travelers - 1) * 0.7; // 人數越多，人均成本降低
    }

    // 根據偏好調整
    if (travelInfo.preferences.includes("美食")) factor *= 1.2;
    if (travelInfo.preferences.includes("購物")) factor *= 1.15;
    if (travelInfo.preferences.includes("親子")) factor *= 1.1;

    return factor;
  }

  /**
   * 生成預算建議
   */
  private generateBudgetRecommendations(
    travelInfo: any,
    totalBudget: number
  ): string[] {
    const recommendations = ["建議預留 10-20% 的額外預算作為緊急使用"];

    if (travelInfo.budget && totalBudget > travelInfo.budget) {
      recommendations.push(
        `預估費用 ${totalBudget.toLocaleString()} 元超過您的預算 ${travelInfo.budget.toLocaleString()} 元，建議調整行程`
      );
    }

    if (travelInfo.travelers > 2) {
      recommendations.push("多人旅遊建議選擇家庭房或民宿，可節省住宿費用");
    }

    if (travelInfo.destination === "台北") {
      recommendations.push("台北捷運一日券 150 元，可節省交通費");
    }

    if (travelInfo.preferences.includes("美食")) {
      recommendations.push("夜市美食性價比高，建議安排 1-2 天夜市行程");
    }

    return recommendations;
  }

  /**
   * 呼叫 A2A Agent (使用 JSON-RPC 2.0 協議)
   */
  private async callA2AAgent(
    agent: AgentRegistry,
    action: string,
    data: any,
    timeout: number
  ): Promise<AgentAPIResponse> {
    // 建立 A2A 標準的 JSON-RPC 請求
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
              text: JSON.stringify({
                action: action,
                data: data,
                coordinator_id: "travel_coordinator_agent",
              }),
            },
          ],
          kind: "message",
        },
      },
    };

    // 準備請求標頭
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "A2A-Travel-Coordinator/1.0",
    };

    if (agent.apiKey) {
      headers["Authorization"] = `Bearer ${agent.apiKey}`;
    }

    // 建立 AbortController 用於超時控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      console.log(`📡 發送 A2A 請求到 ${agent.endpoint}`);

      // 呼叫 A2A Agent
      const response = await fetch(agent.endpoint, {
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

      // 檢查 JSON-RPC 回應
      if (result.error) {
        throw new Error(`A2A Error: ${result.error.message}`);
      }

      console.log(`✅ A2A 代理 ${agent.name} 回應成功`);

      return {
        success: true,
        data: result.result,
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
   */
  async checkAgentHealth(agentId: string): Promise<boolean> {
    try {
      // 對於 Metrio AI 代理，使用專門的健康檢查
      if (agentId === "attractions" || agentId === "accommodation") {
        return await this.metrioClient.healthCheckForAgent(agentId);
      }

      // 對於其他代理，使用一般的 API 呼叫
      const result = await this.callAgentAPI(agentId, "health_check", {}, 5000);
      return result.success;
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
