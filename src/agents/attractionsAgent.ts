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
          parts: [{ kind: "text", text: "正在搜尋景點推薦..." }],
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

  private async generateRecommendations(requestText: string, override?: any, provider?: LLMProvider): Promise<string> {
    const { attractions } = getPrompts();
    const merged = { ...attractions, ...override };
    const prompt = merged.user.replace("{request}", requestText);

    const llmClient = createLLMClient(provider);
    return await llmClient.complete(prompt, {
      system: merged.system,
      maxTokens: 2000,
    });
  }
}
