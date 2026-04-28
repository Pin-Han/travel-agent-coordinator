import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
} from "@a2a-js/sdk/server";
import {
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Task,
} from "@a2a-js/sdk";
import { v4 as uuidv4 } from "uuid";
import { createLLMClient, LLMProvider } from "../services/llmClient.js";
import { getPrompts } from "../services/promptStore.js";
import { TavilyMCPClient } from "../services/tavilyMCPClient.js";

export class AttractionsAgentExecutor implements AgentExecutor {
  constructor() {
    console.log("[AttractionsAgent] Executor 初始化完成");
  }

  async cancelTask(
    taskId: string,
    _eventBus: ExecutionEventBus
  ): Promise<void> {
    console.log(`[AttractionsAgent] 取消任務: ${taskId}`);
  }

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const { taskId, contextId, userMessage } = requestContext;

    if (!requestContext.task) {
      const initialTask: Task = {
        kind: "task",
        id: taskId,
        contextId,
        status: { state: "submitted", timestamp: new Date().toISOString() },
        history: [userMessage],
        artifacts: [],
      };
      eventBus.publish(initialTask);
    }

    const workingUpdate: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "working",
        message: {
          kind: "message",
          role: "agent",
          messageId: uuidv4(),
          parts: [{ kind: "text", text: TavilyMCPClient.isAvailable() ? "正在透過 Tavily 搜尋真實景點資料..." : "正在規劃景點推薦..." }],
          taskId,
          contextId,
        },
        timestamp: new Date().toISOString(),
      },
      final: false,
    };
    eventBus.publish(workingUpdate);

    try {
      const requestText = this.extractText(userMessage);
      const promptOverride = (userMessage.metadata as any)?.promptOverride;
      const provider = (userMessage.metadata as any)?.provider as LLMProvider | undefined;
      console.log(`[AttractionsAgent] 收到請求: ${requestText.slice(0, 80)}...`);

      const recommendations = await this.generateRecommendations(requestText, promptOverride, provider);

      const artifact = {
        artifactId: uuidv4(),
        name: "attractions.md",
        description: "景點推薦",
        parts: [{ kind: "text" as const, text: recommendations }],
      };

      const artifactUpdate: TaskArtifactUpdateEvent = {
        kind: "artifact-update",
        taskId,
        contextId,
        artifact,
        append: false,
        lastChunk: true,
      };
      eventBus.publish(artifactUpdate);

      const completedUpdate: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId,
        contextId,
        status: {
          state: "completed",
          message: {
            kind: "message",
            role: "agent",
            messageId: uuidv4(),
            parts: [{ kind: "text", text: "景點推薦完成！" }],
            taskId,
            contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      eventBus.publish(completedUpdate);
    } catch (error: any) {
      console.error("[AttractionsAgent] 執行失敗:", error);
      const failedUpdate: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId,
        contextId,
        status: {
          state: "failed",
          message: {
            kind: "message",
            role: "agent",
            messageId: uuidv4(),
            parts: [{ kind: "text", text: `景點搜尋失敗: ${error.message}` }],
            taskId,
            contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      eventBus.publish(failedUpdate);
    } finally {
      eventBus.finished();
    }
  }

  private extractText(message: any): string {
    const parts = message?.parts || [];
    const textPart = parts.find((p: any) => p.kind === "text");
    return textPart?.text || "";
  }

  private async generateRecommendations(requestText: string, override?: any, provider?: LLMProvider): Promise<string> {  // returns text only; token usage not surfaced in a2a mode
    const { attractions } = getPrompts();
    const merged = { ...attractions, ...override };

    // Try to fetch real attraction data via Tavily MCP
    const tavilyClient = TavilyMCPClient.getInstance();
    const destination = this.extractDestination(requestText);
    const searchData = await tavilyClient.search(
      `${destination} top attractions must-see travel guide`,
      8
    );

    // Inject real search results into the prompt when available
    const enrichedRequest = searchData
      ? `${requestText}\n\n---\n以下是透過 Tavily 搜尋到的真實資料，請參考這些資料進行規劃：\n${searchData}`
      : requestText;

    const prompt = merged.user.replace("{request}", enrichedRequest);

    const llmClient = createLLMClient(provider);
    const result = await llmClient.complete(prompt, {
      system: merged.system,
      maxTokens: 2000,
    });
    return result.text;
  }

  private extractDestination(requestText: string): string {
    // Extract destination from request for targeted search
    const keywords = ["去", "到", "前往", "規劃", "旅遊", "旅行", "天"];
    let dest = requestText.slice(0, 50); // fallback: first 50 chars
    const match = requestText.match(/(?:去|到|前往)\s*([^\s,，。]+)/);
    if (match) dest = match[1];
    return dest;
  }
}
