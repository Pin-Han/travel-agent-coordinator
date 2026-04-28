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

export class TransportationAgentExecutor implements AgentExecutor {
  constructor() {
    console.log("[TransportationAgent] Executor initialised");
  }

  async cancelTask(
    taskId: string,
    _eventBus: ExecutionEventBus
  ): Promise<void> {
    console.log(`[TransportationAgent] Cancelling task: ${taskId}`);
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
          parts: [
            {
              kind: "text",
              text: TavilyMCPClient.isAvailable()
                ? "Searching transit options via Tavily..."
                : "Planning transportation routes...",
            },
          ],
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
      const attractionArea = (userMessage.metadata as any)?.attractionArea as string | undefined;
      const accommodationArea = (userMessage.metadata as any)?.accommodationArea as string | undefined;
      console.log(`[TransportationAgent] Request: ${requestText.slice(0, 80)}...`);

      const recommendations = await this.generateRecommendations(
        requestText,
        promptOverride,
        provider,
        attractionArea,
        accommodationArea
      );

      const artifact = {
        artifactId: uuidv4(),
        name: "transportation.md",
        description: "Transportation plan",
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
            parts: [{ kind: "text", text: "Transportation plan complete!" }],
            taskId,
            contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      eventBus.publish(completedUpdate);
    } catch (error: any) {
      console.error("[TransportationAgent] Execution failed:", error);
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
            parts: [{ kind: "text", text: `Transportation planning failed: ${error.message}` }],
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

  private async generateRecommendations(
    requestText: string,
    override?: any,
    provider?: LLMProvider,
    attractionArea?: string,
    accommodationArea?: string
  ): Promise<string> {  // returns text only; token usage not surfaced in a2a mode
    const { transportation } = getPrompts() as any;
    const merged = { ...transportation, ...override };

    // Search for real transit data near the attraction areas
    const tavilyClient = TavilyMCPClient.getInstance();
    const searchLocation = attractionArea || this.extractDestination(requestText);
    const searchData = await tavilyClient.search(
      `public transit guide ${searchLocation} subway bus routes transportation tips`,
      6
    );

    // Build enriched request with location context from previous agents
    let enrichedRequest = requestText;
    if (attractionArea) {
      enrichedRequest += `\n\nAttraction areas (from Attractions Agent): ${attractionArea}`;
    }
    if (accommodationArea) {
      enrichedRequest += `\nAccommodation location (from Accommodation Agent): ${accommodationArea}`;
    }
    if (searchData) {
      enrichedRequest += `\n\n---\nReal transit data from Tavily search:\n${searchData}`;
    }

    const prompt = merged.user.replace("{request}", enrichedRequest);

    const llmClient = createLLMClient(provider);
    const result = await llmClient.complete(prompt, {
      system: merged.system,
      maxTokens: 1500,
    });
    return result.text;
  }

  private extractDestination(requestText: string): string {
    // English: "trip to Tokyo", "visit Paris"
    const enMatch = requestText.match(/(?:trip to|visit|travel to|going to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
    if (enMatch) return enMatch[1];
    // Chinese
    const zhMatch = requestText.match(/(?:去|到|前往)\s*([^\s,，。]+)/);
    if (zhMatch) return zhMatch[1];
    return requestText.slice(0, 30);
  }
}
