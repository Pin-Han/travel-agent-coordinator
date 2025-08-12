import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
} from "@a2a-js/sdk/server";
import {
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Task,
  Message,
  TextPart,
} from "@a2a-js/sdk";
import { v4 as uuidv4 } from "uuid";

import { MetrioAIClient } from "../services/metrioClient.js";
import { AgentRegistryService } from "../services/agentRegistry.js";
import { TaskStoreService } from "../services/taskStore.js";
import { CoordinatorConfig } from "../types/index.js";

// Simple store for contexts - following movie agent pattern
const contexts: Map<string, Message[]> = new Map();

export class TravelCoordinatorExecutor implements AgentExecutor {
  private metrioClient: MetrioAIClient;
  private agentRegistry: AgentRegistryService;
  private taskStore: TaskStoreService;
  private activeTasks: Set<string> = new Set();
  private cancelledTasks: Set<string> = new Set();

  constructor(_config: CoordinatorConfig) {
    this.metrioClient = new MetrioAIClient();
    this.agentRegistry = new AgentRegistryService();
    this.taskStore = new TaskStoreService();

    console.log("🚀 Travel Coordinator Executor 初始化完成");
  }

  /**
   * 取消任務
   */
  async cancelTask(
    taskId: string,
    _eventBus: ExecutionEventBus
  ): Promise<void> {
    console.log(`🚫 取消協調任務: ${taskId}`);

    this.cancelledTasks.add(taskId);
    this.activeTasks.delete(taskId);
    this.taskStore.cancelTask(taskId, "用戶取消");
  }

  /**
   * 執行協調任務 - 遵循官方 A2A 模式
   */
  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;

    // Determine IDs for the task and context
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    console.log(
      `[TravelCoordinatorExecutor] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`
    );

    // 1. Publish initial Task event if it's a new task
    if (!existingTask) {
      const initialTask: Task = {
        kind: "task",
        id: taskId,
        contextId: contextId,
        status: {
          state: "submitted",
          timestamp: new Date().toISOString(),
        },
        history: [userMessage], // Start history with the current user message
        metadata: userMessage.metadata, // Carry over metadata from message if any
        artifacts: [], // Initialize artifacts array
      };
      eventBus.publish(initialTask);
    }

    // 2. Publish "working" status update
    const workingStatusUpdate: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId: taskId,
      contextId: contextId,
      status: {
        state: "working",
        message: {
          kind: "message",
          role: "agent",
          messageId: uuidv4(),
          parts: [
            { kind: "text", text: "正在分析您的旅遊需求，聯絡專業團隊..." },
          ],
          taskId: taskId,
          contextId: contextId,
        },
        timestamp: new Date().toISOString(),
      },
      final: false,
    };
    eventBus.publish(workingStatusUpdate);

    // 3. Prepare context history like movie agent
    const historyForCoordination = contexts.get(contextId) || [];
    if (
      !historyForCoordination.find((m) => m.messageId === userMessage.messageId)
    ) {
      historyForCoordination.push(userMessage);
    }
    contexts.set(contextId, historyForCoordination);

    // 4. Extract user text from message
    const userText = this.extractTextFromMessage(userMessage);

    if (!userText) {
      console.warn(
        `[TravelCoordinatorExecutor] No valid text message found in history for task ${taskId}.`
      );
      const failureUpdate: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: taskId,
        contextId: contextId,
        status: {
          state: "failed",
          message: {
            kind: "message",
            role: "agent",
            messageId: uuidv4(),
            parts: [{ kind: "text", text: "找不到有效的旅遊需求描述。" }],
            taskId: taskId,
            contextId: contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      eventBus.publish(failureUpdate);
      eventBus.finished();
      return;
    }

    try {
      // 5. Process travel coordination
      await this.processCoordination(
        taskId,
        contextId,
        userText,
        eventBus,
        historyForCoordination
      );
    } catch (error: any) {
      console.error(
        `[TravelCoordinatorExecutor] Error processing task ${taskId}:`,
        error
      );
      const errorUpdate: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: taskId,
        contextId: contextId,
        status: {
          state: "failed",
          message: {
            kind: "message",
            role: "agent",
            messageId: uuidv4(),
            parts: [{ kind: "text", text: `旅遊協調失敗: ${error.message}` }],
            taskId: taskId,
            contextId: contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      eventBus.publish(errorUpdate);
    } finally {
      eventBus.finished();
    }
  }

  /**
   * 協調處理主流程 (使用 A2A 協議)
   */
  private async processCoordination(
    taskId: string,
    contextId: string,
    userText: string,
    eventBus: ExecutionEventBus,
    historyForCoordination: Message[]
  ): Promise<void> {
    try {
      console.log("🔄 開始 A2A 旅遊規劃協調...");

      // 檢查任務是否被取消
      if (this.cancelledTasks.has(taskId)) {
        console.log(`⏹️ 任務 ${taskId} 已被取消`);
        const cancelledUpdate: TaskStatusUpdateEvent = {
          kind: "status-update",
          taskId,
          contextId,
          status: {
            state: "canceled",
            message: {
              kind: "message",
              role: "agent",
              messageId: uuidv4(),
              parts: [{ kind: "text", text: "旅遊協調任務已取消" }],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: true,
        };
        eventBus.publish(cancelledUpdate);
        return;
      }

      // 步驟 1: 並行呼叫景點推薦和住宿規劃 Agents
      await this.publishProgress(
        taskId,
        contextId,
        "正在聯絡景點推薦和住宿規劃專家...",
        eventBus
      );

      const agentResults = await this.callTwoMainAgents(
        userText,
        taskId,
        contextId,
        eventBus
      );

      // 檢查是否被取消
      if (this.cancelledTasks.has(taskId)) return;

      // 步驟 2: 使用協調 AI 整合結果
      await this.publishProgress(
        taskId,
        contextId,
        "正在整合所有專家建議...",
        eventBus
      );

      await this.handleFinalResult(
        taskId,
        contextId,
        agentResults,
        userText,
        eventBus,
        historyForCoordination
      );
    } catch (error) {
      throw new Error(
        `協調處理失敗: ${error instanceof Error ? error.message : "未知錯誤"}`
      );
    }
  }

  /**
   * 發布進度更新
   */
  private async publishProgress(
    taskId: string,
    contextId: string,
    message: string,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const progressEvent: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "working",
        message: {
          messageId: uuidv4(),
          role: "agent",
          parts: [{ kind: "text", text: message }],
          kind: "message",
          taskId,
          contextId,
        },
        timestamp: new Date().toISOString(),
      },
      final: false,
    };

    eventBus.publish(progressEvent);
  }

  /**
   * 處理最終結果 (使用 Metrio AI 整合)
   */
  private async handleFinalResult(
    taskId: string,
    contextId: string,
    allResults: any,
    userText: string,
    eventBus: ExecutionEventBus,
    historyForCoordination: Message[]
  ): Promise<void> {
    console.log("🎉 協調完成，生成最終結果");

    let summary = "旅遊規劃完成";

    // 檢查是否有有效的 Agent 回應
    const hasValidResults = this.hasValidAgentResults(allResults);

    if (hasValidResults) {
      // 有有效結果，使用協調 AI 進行整合
      try {
        const integrationResult =
          await this.metrioClient.getCoordinationGuidance(userText, allResults);

        if (integrationResult.success && integrationResult.data?.response) {
          summary = integrationResult.data.response;
        } else {
          summary = this.generateEnhancedSummary(allResults, userText);
        }
      } catch (coordinationError) {
        console.warn("協調整合失敗，使用增強型總結:", coordinationError);
        summary = this.generateEnhancedSummary(allResults, userText);
      }
    } else {
      // 所有 Agent 都失敗，Coordinating Agent 直接回應
      console.log("⚠️ 所有專家服務暫時無法使用，由協調專家直接提供建議");
      summary = await this.generateDirectCoordinatorResponse(userText);
    }

    // 創建結果文件
    const artifactId = uuidv4();
    const artifact = {
      artifactId,
      name: "travel_plan.md",
      description: "完整旅遊規劃",
      parts: [
        {
          kind: "text" as const,
          text: summary,
        },
      ],
    };

    // 添加到任務記錄
    this.taskStore.addTaskArtifact(taskId, artifact);

    // 發布結果文件
    const artifactEvent: TaskArtifactUpdateEvent = {
      kind: "artifact-update",
      taskId,
      contextId,
      artifact,
      append: false,
      lastChunk: true,
    };

    eventBus.publish(artifactEvent);

    // 更新任務狀態為完成 (如果任務存在)
    try {
      this.taskStore.updateTaskStatus(taskId, {
        state: "completed",
        message: "旅遊規劃已完成",
      });
    } catch (error) {
      // 任務可能不存在於我們的本地存儲中，這在使用 A2A 標準流程時是正常的
      console.log(`📝 任務 ${taskId} 狀態更新跳過 (使用 A2A 標準流程)`);
    }

    // Create agent response message and add to context - following movie agent pattern
    const agentMessage: Message = {
      kind: "message",
      role: "agent",
      messageId: uuidv4(),
      parts: [
        {
          kind: "text",
          text: "✅ 旅遊規劃已完成！請查看生成的旅遊計劃。",
        },
      ],
      taskId: taskId,
      contextId: contextId,
    };
    historyForCoordination.push(agentMessage);
    contexts.set(contextId, historyForCoordination);

    // 發布最終狀態更新
    const finalEvent: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "completed",
        message: agentMessage,
        timestamp: new Date().toISOString(),
      },
      final: true,
    };

    eventBus.publish(finalEvent);
  }

  /**
   * 生成簡單的結果整合
   */
  /**
   * 檢查是否有有效的 Agent 結果
   */
  private hasValidAgentResults(allResults: any): boolean {
    return (
      allResults.attractions?.success === true ||
      allResults.accommodation?.success === true
    );
  }

  /**
   * 生成增強型總結
   */
  private generateEnhancedSummary(
    allResults: any,
    userRequest: string
  ): string {
    let summary = `# 旅遊規劃結果\n\n**用戶需求：** ${userRequest}\n\n`;

    // 處理景點推薦結果
    if (allResults.attractions?.success) {
      summary += `## 🗺️ 景點推薦\n`;
      try {
        const attractionsData = allResults.attractions.data;
        if (attractionsData) {
          summary += `✅ 已為您精選優質景點和美食推薦\n\n`;
        }
      } catch (error) {
        summary += `✅ 景點推薦專家已提供建議\n\n`;
      }
    } else {
      summary += `## 🗺️ 景點推薦\n⚠️ 景點推薦服務暫時無法使用，建議稍後再試\n\n`;
    }

    // 處理住宿規劃結果
    if (allResults.accommodation?.success) {
      summary += `## 🏨 住宿規劃\n`;
      try {
        const accommodationData = allResults.accommodation.data;
        if (accommodationData) {
          summary += `✅ 已為您安排最佳住宿和交通方案\n\n`;
        }
      } catch (error) {
        summary += `✅ 住宿規劃專家已提供建議\n\n`;
      }
    } else {
      summary += `## 🏨 住宿規劃\n⚠️ 住宿規劃服務暫時無法使用，建議稍後再試\n\n`;
    }

    summary += `## 📝 溫馨提醒\n`;
    summary += `- 以上規劃由專業旅遊專家團隊提供\n`;
    summary += `- 如有任何問題，歡迎隨時聯繫我們\n`;
    summary += `- 建議出發前再次確認各項安排\n\n`;

    return summary;
  }

  /**
   * 當所有 Agent 都失敗時，協調專家直接提供回應
   */
  private async generateDirectCoordinatorResponse(
    userRequest: string
  ): Promise<string> {
    console.log("🤖 協調專家正在直接處理請求...");

    try {
      // 使用協調 Prompt 直接處理
      const directResponse = await this.metrioClient.getCoordinationGuidance(
        userRequest,
        { note: "所有專家服務暫時無法使用，請直接提供旅遊建議" }
      );

      if (directResponse.success && directResponse.data?.response) {
        return directResponse.data.response;
      }
    } catch (error) {
      console.warn("協調專家直接回應失敗:", error);
    }

    // 最終備用方案
    return this.generateFallbackResponse(userRequest);
  }

  /**
   * 最終備用回應
   */
  private generateFallbackResponse(userRequest: string): string {
    const travelInfo = this.extractTravelInfo(userRequest);

    return `# 旅遊規劃建議

**您的需求：** ${userRequest}

## 🌟 基本建議

### 📍 目的地：${travelInfo.destination}
建議您：
- 提前規劃行程，預訂熱門景點門票
- 選擇交通便利的住宿地點
- 準備適合當地天氣的服裝
- 下載相關旅遊APP，如地圖、翻譯等

### 💰 預算規劃
- 建議預留10-20%的額外預算作為應急基金
- 可考慮購買旅遊保險
- 記錄重要開支，便於後續整理

### 🚇 交通建議
- 優先考慮大眾運輸工具
- 下載當地交通APP
- 購買交通一日券或套票

## ⚠️ 服務說明
目前我們的專業旅遊顧問團隊暫時忙碌中，以上為基本建議。
建議您稍後再次嘗試，我們將為您提供更詳細的個人化規劃。

感謝您的理解與耐心！`;
  }

  private generateSimpleSummary(allResults: any, userText: string): string {
    const { attractions, accommodation, budget } = allResults;

    let summary = `# 旅遊規劃結果\n\n**用戶需求：** ${userText}\n\n`;

    if (attractions?.success && attractions.data?.response) {
      summary += `## 🏞️ 景點推薦\n${attractions.data.response}\n\n`;
    }

    if (accommodation?.success && accommodation.data?.response) {
      summary += `## 🏨 住宿與交通\n${accommodation.data.response}\n\n`;
    }

    if (budget?.success && budget.data?.summary) {
      summary += `## 💰 預算分析\n${budget.data.summary}\n\n`;
    }

    summary += `## 📝 規劃完成\n感謝您使用我們的旅遊規劃服務！如有任何問題，請隨時聯繫。`;

    return summary;
  }

  /**
   * 呼叫主要 Agents：景點推薦和住宿規劃（帶健康檢查）
   */
  private async callTwoMainAgents(
    userText: string,
    taskId: string,
    contextId: string,
    eventBus: ExecutionEventBus
  ): Promise<Record<string, any>> {
    const agentResults: Record<string, any> = {};
    const AGENT_TIMEOUT = 15000; // 15秒超時

    // 提取基本旅遊資訊
    const travelInfo = this.extractTravelInfo(userText);

    // 檢查 Agent 健康狀態
    const agentsToCall: Array<{
      id: string;
      name: string;
      promise: Promise<any>;
    }> = [];

    // 檢查景點推薦 Agent
    const attractionsHealthy = await this.agentRegistry.checkAgentHealth(
      "attractions"
    );
    if (attractionsHealthy) {
      agentsToCall.push({
        id: "attractions",
        name: "景點推薦",
        promise: this.callSingleAgent(
          "attractions",
          "景點推薦",
          userText,
          travelInfo,
          AGENT_TIMEOUT
        ),
      });
      console.log("✅ 景點推薦 Agent 健康檢查通過");
    } else {
      console.warn("⚠️ 景點推薦 Agent 健康檢查失敗，跳過呼叫");
    }

    // 檢查住宿規劃 Agent
    const accommodationHealthy = await this.agentRegistry.checkAgentHealth(
      "accommodation"
    );
    if (accommodationHealthy) {
      agentsToCall.push({
        id: "accommodation",
        name: "住宿規劃",
        promise: this.callSingleAgent(
          "accommodation",
          "住宿規劃",
          userText,
          travelInfo,
          AGENT_TIMEOUT
        ),
      });
      console.log("✅ 住宿規劃 Agent 健康檢查通過");
    } else {
      console.warn("⚠️ 住宿規劃 Agent 健康檢查失敗，跳過呼叫");
    }

    // 如果沒有健康的 Agent，直接返回
    if (agentsToCall.length === 0) {
      console.warn("⚠️ 所有 Agent 都不健康，將使用備用方案");
      return {};
    }

    // 並行呼叫健康的 Agents
    const agentPromises = agentsToCall.map((agent) => agent.promise);

    // 發布進度更新
    await this.publishProgress(
      taskId,
      contextId,
      "正在同時諮詢景點推薦和住宿規劃專家...",
      eventBus
    );

    // 等待結果或超時
    const results = await Promise.allSettled(agentPromises);

    // 處理 Agent 結果（動態匹配）
    results.forEach((result, index) => {
      const agent = agentsToCall[index];

      if (result.status === "fulfilled") {
        agentResults[agent.id] = result.value;
        console.log(`✅ ${agent.name}專家回應完成`);
      } else {
        console.error(`❌ ${agent.name}專家失敗:`, result.reason);
        agentResults[agent.id] = {
          success: false,
          error: `${agent.name}服務暫時無法使用`,
          fallback: true,
        };
      }
    });

    // 為未呼叫的 Agents 添加失敗標記
    if (!agentResults.attractions) {
      agentResults.attractions = {
        success: false,
        error: "景點推薦服務健康檢查失敗",
        skipped: true,
      };
    }

    if (!agentResults.accommodation) {
      agentResults.accommodation = {
        success: false,
        error: "住宿規劃服務健康檢查失敗",
        skipped: true,
      };
    }

    return agentResults;
  }

  /**
   * 呼叫單一 Agent 的輔助方法 (使用 A2A 協議)
   */
  private async callSingleAgent(
    agentId: string,
    agentName: string,
    userText: string,
    travelInfo: any,
    timeout: number
  ): Promise<any> {
    try {
      console.log(`🔗 開始呼叫 ${agentName} 專家...`);

      // 檢查 Agent 是否使用 A2A 協議
      const agent = this.agentRegistry.getAgent(agentId);
      if (!agent) {
        throw new Error(`找不到代理: ${agentId}`);
      }

      if (agent.endpoint === "api") {
        // Metrio AI API 直接調用 (非 A2A)
        return await this.agentRegistry.callAgentAPI(
          agentId,
          "process_request",
          {
            request: userText,
            ...travelInfo,
          }
        );
      } else {
        // 標準 A2A 協議流程
        return await this.callA2AAgent(
          agentId,
          agentName,
          userText,
          travelInfo,
          timeout
        );
      }
    } catch (error) {
      console.error(`❌ ${agentName} 專家呼叫失敗:`, error);
      throw new Error(
        `${agentName}服務無法連接: ${
          error instanceof Error ? error.message : "未知錯誤"
        }`
      );
    }
  }

  /**
   * 使用標準 A2A 協議呼叫 Agent
   */
  private async callA2AAgent(
    agentId: string,
    agentName: string,
    userText: string,
    travelInfo: any,
    timeout: number
  ): Promise<any> {
    const agent = this.agentRegistry.getAgent(agentId);
    if (!agent) {
      throw new Error(`找不到代理: ${agentId}`);
    }

    console.log(`📨 使用 A2A 協議呼叫 ${agentName}...`);

    // 暫時使用 API 模式，未來可以實現完整的 A2A 協議
    console.log(`⚠️ A2A 協議實現待完成，回退到 API 模式`);
    return await this.agentRegistry.callAgentAPI(agentId, "process_request", {
      request: userText,
      ...travelInfo,
    });
  }

  /**
   * 創建備用結果
   */
  private createFallbackResults(agentConfigs: Array<{id: string, name: string}>): Record<string, any> {
    const fallbackResults: Record<string, any> = {};
    
    agentConfigs.forEach(config => {
      fallbackResults[config.id] = {
        success: false,
        error: `${config.name}服務目前無法使用`,
        fallback: true
      };
    });
    
    return fallbackResults;
  }

  /**
   * 格式化 Agent 請求
   */
  private formatAgentRequest(userText: string, travelInfo: any): string {
    return `請根據以下旅遊需求提供建議：
用戶需求：${userText}

詳細參數：
- 目的地：${travelInfo.destination}
- 天數：${travelInfo.duration}天
- 預算：${travelInfo.budget || '不限'}元
- 人數：${travelInfo.traveler_count}人
- 偏好：${travelInfo.preferences.join(', ') || '無特殊偏好'}`;
  }

  /**
   * 發送 A2A 消息
   */
  private async sendA2AMessage(agent: any, request: any, timeout: number): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${agent.endpoint}/a2a`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Travel-Coordinator-Agent/1.0",
          ...(agent.apiKey && { "Authorization": `Bearer ${agent.apiKey}` })
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Polling A2A 任務完成狀態
   */
  private async pollA2ATaskCompletion(
    agent: any,
    taskId: string,
    agentName: string,
    timeout: number
  ): Promise<any> {
    const startTime = Date.now();
    const pollInterval = 2000; // 2秒輪詢一次
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3;

    console.log(`🔄 開始輪詢 ${agentName} 任務狀態 (${taskId})...`);

    while (Date.now() - startTime < timeout) {
      try {
        // 發送任務查詢請求
        const getTaskRequest = {
          jsonrpc: "2.0",
          method: "task/get",
          id: `get-task-${Date.now()}`,
          params: { id: taskId }
        };

        const taskResponse = await this.sendA2AMessage(agent, getTaskRequest, 10000);

        if (taskResponse.error) {
          throw new Error(`任務查詢失敗: ${taskResponse.error.message}`);
        }

        const task = taskResponse.result;
        const state = task.status?.state;

        console.log(`📊 ${agentName} 任務狀態: ${state}`);
        consecutiveErrors = 0; // 重置錯誤計數

        switch (state) {
          case "completed":
            console.log(`✅ ${agentName} 任務完成`);
            return this.extractA2ATaskResult(task, agentName);

          case "failed":
          case "canceled":
            throw new Error(
              `任務${state}: ${
                task.status?.message?.parts?.[0]?.text || "未知原因"
              }`
            );

          case "input-required":
            console.log(`⚠️ ${agentName} 任務需要輸入，視為部分完成`);
            return {
              success: true,
              data: {
                response: task.status?.message?.parts?.[0]?.text || "需要更多輸入",
                requiresInput: true,
              },
              api: agentName.toLowerCase(),
              timestamp: new Date().toISOString(),
            };

          case "working":
          case "submitted":
            const remainingTime = Math.round((timeout - (Date.now() - startTime)) / 1000);
            if (remainingTime > 0) {
              console.log(`⏳ ${agentName} 任務進行中，${remainingTime}秒後超時`);
            }
            break;

          default:
            console.warn(`🤔 ${agentName} 未知任務狀態: ${state}`);
        }

        // 等待下次輪詢
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (error) {
        consecutiveErrors++;
        console.error(`❌ ${agentName} 任務查詢錯誤 (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, error);
        
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          throw new Error(`${agentName} 連續查詢失敗 ${MAX_CONSECUTIVE_ERRORS} 次`);
        }
        
        // 等待後重試
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    throw new Error(`${agentName} 任務超時 (${timeout}ms)`);
  }

  /**
   * 提取 A2A 任務結果
   */
  private extractA2ATaskResult(task: any, agentName: string): any {
    let responseText = task.status?.message?.parts?.[0]?.text || "任務完成";

    // 如果有 artifacts，也包含進來
    if (task.artifacts && task.artifacts.length > 0) {
      const artifactContent = task.artifacts[0].parts?.[0]?.text;
      if (artifactContent) {
        responseText += `\n\n${artifactContent}`;
      }
    }

    return {
      success: true,
      data: { 
        response: responseText,
        task: task,
        artifacts: task.artifacts || []
      },
      api: agentName.toLowerCase(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 提取旅遊資訊的輔助方法
   */
  private extractTravelInfo(text: string): any {
    // 簡化的資訊提取邏輯
    const info = {
      destination: "台北", // 預設值
      duration: 3,
      budget: 20000,
      preferences: ["美食", "文化"],
      traveler_count: 2,
    };

    // 這裡可以加入更複雜的 NLP 提取邏輯
    if (text.includes("高雄")) info.destination = "高雄";
    if (text.includes("台中")) info.destination = "台中";

    const budgetMatch = text.match(/(\d+)(?:元|萬)/);
    if (budgetMatch) {
      info.budget =
        parseInt(budgetMatch[1]) * (text.includes("萬") ? 10000 : 1);
    }

    const dayMatch = text.match(/(\d+)天/);
    if (dayMatch) {
      info.duration = parseInt(dayMatch[1]);
    }

    return info;
  }

  /**
   * 從景點推薦回應中提取景點名稱
   */
  private extractAttractionNames(responseText: string): string[] {
    const attractionNames: string[] = [];

    try {
      // 嘗試解析 JSON 格式的回應
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const jsonData = JSON.parse(jsonMatch[1]);
        if (jsonData.recommendations?.attractions) {
          jsonData.recommendations.attractions.forEach((attraction: any) => {
            if (attraction.name) {
              attractionNames.push(attraction.name);
            }
          });
        }
      }

      // 如果 JSON 解析失敗，使用簡單的文字提取
      if (attractionNames.length === 0) {
        const lines = responseText.split("\n");
        lines.forEach((line) => {
          // 簡單匹配包含常見景點關鍵字的行
          if (
            line.includes("景點") ||
            line.includes("博物館") ||
            line.includes("公園") ||
            line.includes("寺廟") ||
            line.includes("夜市") ||
            line.includes("101")
          ) {
            const cleanLine = line.replace(/[^\u4e00-\u9fa5\w\s]/g, "").trim();
            if (cleanLine && cleanLine.length > 2 && cleanLine.length < 20) {
              attractionNames.push(cleanLine);
            }
          }
        });
      }
    } catch (error) {
      console.warn("景點名稱提取失敗:", error);
    }

    return attractionNames.slice(0, 10); // 限制最多 10 個景點
  }

  /**
   * 從訊息中提取文字內容
   */
  private extractTextFromMessage(message: any): string {
    if (typeof message === "string") {
      return message;
    }

    if (message && message.parts && Array.isArray(message.parts)) {
      return message.parts
        .filter((part: any) => part.kind === "text")
        .map((part: any) => part.text)
        .join(" ");
    }

    return JSON.stringify(message);
  }

  /**
   * 獲取活躍任務統計
   */
  getActiveTasksCount(): number {
    return this.activeTasks.size;
  }

  /**
   * 獲取任務存儲統計
   */
  getTaskStoreStats(): any {
    return this.taskStore.getStats();
  }

  /**
   * 獲取代理健康狀態
   */
  async getAgentsHealth(): Promise<Record<string, boolean>> {
    return await this.agentRegistry.getAllAgentsHealth();
  }
}
