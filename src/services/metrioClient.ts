import { AgentAPIResponse } from "../types/index.js";

export interface MetrioAIMessage {
  role: "user" | "assistant" | "system";
  content: {
    type: "text";
    text: string;
  };
}

export interface MetrioAIVariable {
  name: string;
  value: string;
}

export interface MetrioAIRequest {
  projectId: string;
  promptId: string;
  messages: MetrioAIMessage[];
  variables?: MetrioAIVariable[];
}

export interface MetrioAIResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class MetrioAIClient {
  private apiUrl: string;
  private apiKey: string;
  private projectId: string;

  constructor() {
    this.apiUrl =
      process.env.METRIO_AI_API_URL ||
      "https://api.metrio.ai/v1/chat/completion";
    this.apiKey = process.env.METRIO_AI_API_KEY || "";
    this.projectId = process.env.METRIO_AI_PROJECT_ID || "";

    if (!this.apiKey) {
      throw new Error("METRIO_AI_API_KEY 環境變數是必須的");
    }

    if (!this.projectId) {
      throw new Error("METRIO_AI_PROJECT_ID 環境變數是必須的");
    }
  }

  /**
   * 呼叫 Metrio AI API
   */
  async callPrompt(
    promptId: string,
    userMessage: string,
    variables: MetrioAIVariable[] = [],
    timeout: number = 30000
  ): Promise<MetrioAIResponse> {
    const request: MetrioAIRequest = {
      projectId: this.projectId,
      promptId,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: userMessage,
          },
        },
      ],
      variables,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      console.log(`🔄 呼叫 Metrio AI Prompt ${promptId}...`);

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          METRIOAI_API_KEY: this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${response.statusText} - ${errorText}`
        );
      }

      const result = (await response.json()) as MetrioAIResponse;
      console.log(`✅ Metrio AI Prompt ${promptId} 回應成功`);

      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      console.error(`❌ Metrio AI Prompt ${promptId} 呼叫失敗:`, error);
      throw error;
    }
  }

  /**
   * 呼叫景點推薦服務
   */
  async getAttractionRecommendations(
    destination: string,
    preferences: string[] = [],
    budget?: number,
    duration?: number,
    travelerCount: number = 1
  ): Promise<AgentAPIResponse> {
    const promptId = process.env.ATTRACTION_PROMPT_ID || "138152";

    // 使用結構化的訊息格式，符合 Prompt 期待
    const userMessage = `請根據以下參數推薦景點和美食：
- destination: ${destination}
- duration: ${duration || 3}天
- budget: ${budget || "不限"} 元
- preferences: ${preferences.length > 0 ? preferences.join(", ") : "無特殊偏好"}
- traveler_count: ${travelerCount}人`;

    const variables: MetrioAIVariable[] = [
      { name: "destination", value: destination },
      { name: "duration", value: (duration || 3).toString() },
      { name: "budget", value: budget?.toString() || "" },
      { name: "preferences", value: preferences.join(", ") },
      { name: "traveler_count", value: travelerCount.toString() },
    ];

    try {
      const response = await this.callPrompt(promptId, userMessage, variables);

      return {
        success: true,
        data: {
          response: response.choices?.[0]?.message?.content || "",
          usage: response.usage,
          metrio_response: response,
        },
        api: "attractions",
        action: "recommend_attractions",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "未知錯誤",
        api: "attractions",
        action: "recommend_attractions",
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 呼叫住宿與交通服務
   */
  async getAccommodationAndTransport(
    destination: string,
    duration?: number,
    budget?: number,
    travelers?: number,
    attractionList: string[] = []
  ): Promise<AgentAPIResponse> {
    const promptId = process.env.ACCOMMODATION_PROMPT_ID || "144932";

    // 使用結構化的訊息格式，符合 Prompt 期待
    const userMessage = `請根據以下參數安排住宿和交通：
- destination: ${destination}
- duration: ${duration || 3}天
- budget: ${budget || "不限"} 元
- traveler_count: ${travelers || 1}人
- attraction_list: ${
      attractionList.length > 0 ? JSON.stringify(attractionList) : "待規劃"
    }
- accommodation_preferences: 經濟實惠，交通便利`;

    const variables: MetrioAIVariable[] = [
      { name: "destination", value: destination },
      { name: "duration", value: (duration || 3).toString() },
      { name: "budget", value: budget?.toString() || "" },
      { name: "traveler_count", value: (travelers || 1).toString() },
      { name: "attraction_list", value: JSON.stringify(attractionList) },
      { name: "accommodation_preferences", value: "經濟實惠，交通便利" },
    ];

    try {
      const response = await this.callPrompt(promptId, userMessage, variables);

      return {
        success: true,
        data: {
          response: response.choices?.[0]?.message?.content || "",
          usage: response.usage,
          metrio_response: response,
        },
        api: "accommodation",
        action: "recommend_accommodation",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "未知錯誤",
        api: "accommodation",
        action: "recommend_accommodation",
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 呼叫協調服務 (使用 Gemini 作為備選方案)
   */
  async getCoordinationGuidance(
    userRequest: string,
    currentContext: any
  ): Promise<AgentAPIResponse> {
    const promptId = process.env.COORDINATING_PROMPT_ID || "944817";

    const contextMessage = currentContext
      ? `\n\n目前的處理進度：${JSON.stringify(currentContext, null, 2)}`
      : "";

    const userMessage = `作為旅遊協調專家，請分析以下請求並決定需要呼叫哪些服務：${userRequest}${contextMessage}`;

    const variables: MetrioAIVariable[] = [
      { name: "userRequest", value: userRequest },
      { name: "context", value: JSON.stringify(currentContext || {}) },
    ];

    try {
      const response = await this.callPrompt(promptId, userMessage, variables);

      return {
        success: true,
        data: {
          response: response.choices?.[0]?.message?.content || "",
          usage: response.usage,
          metrio_response: response,
        },
        api: "coordination",
        action: "coordinate_request",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "未知錯誤",
        api: "coordination",
        action: "coordinate_request",
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 健康檢查
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.callPrompt(
        process.env.ATTRACTION_PROMPT_ID || "138152",
        "健康檢查",
        [],
        5000
      );
      return !!response.choices?.[0]?.message?.content;
    } catch (error) {
      console.warn("Metrio AI 健康檢查失敗:", error);
      return false;
    }
  }

  /**
   * 針對特定代理的健康檢查
   */
  async healthCheckForAgent(agentId: string): Promise<boolean> {
    try {
      let promptId: string;

      switch (agentId) {
        case "attractions":
          promptId = process.env.ATTRACTION_PROMPT_ID || "138152";
          break;
        case "accommodation":
          promptId = process.env.ACCOMMODATION_PROMPT_ID || "144932";
          break;
        default:
          // 預設使用景點推薦的 ID
          promptId = process.env.ATTRACTION_PROMPT_ID || "138152";
      }

      console.log(`🔍 檢查 ${agentId} 代理健康狀態 (Prompt: ${promptId})`);

      const response = await this.callPrompt(promptId, "健康檢查", [], 5000);

      const isHealthy = !!response.choices?.[0]?.message?.content;
      console.log(
        `${isHealthy ? "✅" : "❌"} ${agentId} 代理健康檢查結果: ${
          isHealthy ? "正常" : "失敗"
        }`
      );

      return isHealthy;
    } catch (error) {
      console.warn(`${agentId} 代理健康檢查失敗:`, error);
      return false;
    }
  }

  /**
   * 呼叫協調服務 - 決策階段：決定需要哪些 Agents
   */
  async getCoordinationDecision(
    userRequest: string,
    availableAgents: string[]
  ): Promise<AgentAPIResponse> {
    const promptId = process.env.COORDINATING_PROMPT_ID || "944817";

    const userMessage = `用戶旅遊需求：${userRequest}

可用的專家 Agents：
${availableAgents.map((agent) => `- ${agent}`).join("\n")}

請分析需求並決定需要呼叫哪些專家。請使用以下格式回應：

CALL_AGENT: [Agent ID]
REASON: [呼叫原因]
PARAMS: {
  "destination": "目的地",
  "duration": 天數,
  "budget": 預算,
  "preferences": ["偏好"],
  "traveler_count": 人數
}`;

    const variables: MetrioAIVariable[] = [
      { name: "user_request", value: userRequest },
      { name: "available_agents", value: availableAgents.join(", ") },
    ];

    try {
      const response = await this.callPrompt(promptId, userMessage, variables);

      return {
        success: true,
        data: {
          response: response.choices?.[0]?.message?.content || "",
          metrio_response: response,
          type: "coordination_decision",
        },
        api: "metrio_ai_coordination",
        action: "decide_agents",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("❌ 協調決策呼叫失敗:", error);
      throw error;
    }
  }

  /**
   * 獲取設定資訊
   */
  getConfig() {
    return {
      apiUrl: this.apiUrl,
      projectId: this.projectId,
      hasApiKey: !!this.apiKey,
      promptIds: {
        coordination: process.env.COORDINATING_PROMPT_ID || "944817",
        accommodation: process.env.ACCOMMODATION_PROMPT_ID || "144932",
        attraction: process.env.ATTRACTION_PROMPT_ID || "138152",
      },
    };
  }
}
