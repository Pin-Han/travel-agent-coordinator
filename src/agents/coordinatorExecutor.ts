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
} from "@a2a-js/sdk";
import { v4 as uuidv4 } from "uuid";

import {
  createLLMClient,
  LLMProvider,
  LLMMessage,
  LLMContentBlock,
  ToolUseBlock,
  TextBlock,
  ToolResultContent,
  ToolDefinition,
} from "../services/llmClient.js";
import { getPrompts } from "../services/promptStore.js";
import { AgentRegistryService } from "../services/agentRegistry.js";
import { TaskStoreService } from "../services/taskStore.js";
import { CoordinatorConfig } from "../types/index.js";

// Per-context A2A conversation history
const contexts: Map<string, Message[]> = new Map();

const MAX_LOOP_TURNS = 10;
const AGENT_TIMEOUT_MS = 90_000;

export class TravelCoordinatorExecutor implements AgentExecutor {
  private agentRegistry: AgentRegistryService;
  private taskStore: TaskStoreService;
  private cancelledTasks: Set<string> = new Set();

  constructor(_config: CoordinatorConfig) {
    this.agentRegistry = new AgentRegistryService();
    this.taskStore = new TaskStoreService();
    console.log("🚀 Travel Coordinator Executor 初始化完成");
  }

  async cancelTask(taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    console.log(`🚫 取消協調任務: ${taskId}`);
    this.cancelledTasks.add(taskId);
    this.taskStore.cancelTask(taskId, "用戶取消");
  }

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage;
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    console.log(`[Coordinator] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`);

    // Publish initial Task if new
    if (!requestContext.task) {
      const initialTask: Task = {
        kind: "task",
        id: taskId,
        contextId,
        status: { state: "submitted", timestamp: new Date().toISOString() },
        history: [userMessage],
        metadata: userMessage.metadata,
        artifacts: [],
      };
      eventBus.publish(initialTask);
    }

    // Working status
    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "working",
        message: {
          kind: "message",
          role: "agent",
          messageId: uuidv4(),
          parts: [{ kind: "text", text: "Analysing your travel request..." }],
          taskId,
          contextId,
        },
        timestamp: new Date().toISOString(),
      },
      final: false,
    } as TaskStatusUpdateEvent);

    // Build per-context A2A history
    const history = contexts.get(contextId) ?? [];
    if (!history.find((m) => m.messageId === userMessage.messageId)) {
      history.push(userMessage);
    }
    contexts.set(contextId, history);

    const userText = this.extractTextFromMessage(userMessage);
    const promptOverrides = (userMessage.metadata as any)?.prompts;
    const provider = (userMessage.metadata as any)?.provider as LLMProvider | undefined;

    if (!userText) {
      eventBus.publish({
        kind: "status-update",
        taskId,
        contextId,
        status: {
          state: "failed",
          message: {
            kind: "message",
            role: "agent",
            messageId: uuidv4(),
            parts: [{ kind: "text", text: "No travel request text found." }],
            taskId,
            contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      } as TaskStatusUpdateEvent);
      eventBus.finished();
      return;
    }

    try {
      await this.processCoordination(taskId, contextId, eventBus, history, promptOverrides, provider);
    } catch (error: any) {
      console.error(`[Coordinator] Error in task ${taskId}:`, error);
      eventBus.publish({
        kind: "status-update",
        taskId,
        contextId,
        status: {
          state: "failed",
          message: {
            kind: "message",
            role: "agent",
            messageId: uuidv4(),
            parts: [{ kind: "text", text: "I encountered an issue while planning your trip. Please try again with a more specific request." }],
            taskId,
            contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      } as TaskStatusUpdateEvent);
    } finally {
      eventBus.finished();
    }
  }

  // ─── Agentic orchestration ────────────────────────────────────────────────────

  private async processCoordination(
    taskId: string,
    contextId: string,
    eventBus: ExecutionEventBus,
    history: Message[],
    promptOverrides?: any,
    provider?: LLMProvider
  ): Promise<void> {
    if (this.cancelledTasks.has(taskId)) {
      this.publishStatus(taskId, contextId, "canceled", "Travel planning task cancelled.", true, eventBus);
      return;
    }

    await this.publishProgress(taskId, contextId, "Planning your trip...", eventBus);

    const tools = this.buildToolDefinitions();
    const systemPrompt = promptOverrides?.coordinator?.system ?? this.buildSystemPrompt();
    const llmMessages = this.buildLLMMessages(history);

    const loopResult = await this.runAgenticLoop(
      llmMessages, tools, systemPrompt, taskId, contextId, eventBus, promptOverrides, provider
    );

    if (loopResult.type === "ask_user") {
      // Surface clarifying question to user and end turn
      await this.publishAskUser(taskId, contextId, loopResult.text, history, eventBus);
      return;
    }

    // Final plan — publish artifact
    await this.publishFinalPlan(taskId, contextId, loopResult.text, loopResult.tokenUsage, history, eventBus);
  }

  // ─── Agentic loop ─────────────────────────────────────────────────────────────

  private async runAgenticLoop(
    initialMessages: LLMMessage[],
    tools: ToolDefinition[],
    systemPrompt: string,
    taskId: string,
    contextId: string,
    eventBus: ExecutionEventBus,
    promptOverrides?: any,
    provider?: LLMProvider
  ): Promise<{
    type: "final" | "ask_user";
    text: string;
    tokenUsage: { inputTokens: number; outputTokens: number; breakdown: Array<{ step: string; input: number; output: number }> };
  }> {
    const llmClient = createLLMClient(provider);
    if (!llmClient.completeWithTools) {
      throw new Error(`Provider "${llmClient.provider}" does not support tool use`);
    }

    const messages: LLMMessage[] = [...initialMessages];
    const accumulator = { inputTokens: 0, outputTokens: 0, breakdown: [] as Array<{ step: string; input: number; output: number }> };

    for (let turn = 1; turn <= MAX_LOOP_TURNS; turn++) {
      if (this.cancelledTasks.has(taskId)) break;

      console.log(`[Coordinator] Loop turn ${turn}/${MAX_LOOP_TURNS}`);

      const response = await llmClient.completeWithTools(messages, tools, {
        system: systemPrompt,
        maxTokens: 4096,
      });

      // Accumulate orchestrator token usage
      if (response.usage) {
        accumulator.inputTokens  += response.usage.inputTokens;
        accumulator.outputTokens += response.usage.outputTokens;
        accumulator.breakdown.push({ step: `Coordinator (turn ${turn})`, input: response.usage.inputTokens, output: response.usage.outputTokens });
      }

      // Add assistant turn to conversation
      messages.push({ role: "assistant", content: response.content });

      const toolCalls = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      const textParts = response.content.filter((b): b is TextBlock  => b.type === "text");

      // No tool calls = final text answer
      if (toolCalls.length === 0) {
        const finalText = textParts.map((b) => b.text).join("\n").trim();
        return { type: "final", text: finalText || "Travel plan complete.", tokenUsage: accumulator };
      }

      // Execute tool calls sequentially
      const toolResults: ToolResultContent[] = [];

      for (const toolCall of toolCalls) {
        if (toolCall.name === "ask_user") {
          const question: string = (toolCall.input as any).question ?? "Could you provide more details?";
          return { type: "ask_user", text: question, tokenUsage: accumulator };
        }

        if (toolCall.name === "call_agent") {
          const { agent_id, request, context } = toolCall.input as { agent_id: string; request: string; context?: string };
          const enrichedRequest = context ? `${request}\n\nAdditional context:\n${context}` : request;

          await this.publishProgress(taskId, contextId, `Consulting ${agent_id} specialist...`, eventBus);

          const agentResult = await this.agentRegistry.callAgentAPI(
            agent_id,
            "process_request",
            {
              request: enrichedRequest,
              provider,
              promptOverride: promptOverrides?.[agent_id],
            },
            AGENT_TIMEOUT_MS
          );

          // Accumulate sub-agent token usage
          if (agentResult.data?.tokenUsage) {
            const tu = agentResult.data.tokenUsage;
            accumulator.inputTokens  += tu.inputTokens  ?? 0;
            accumulator.outputTokens += tu.outputTokens ?? 0;
            accumulator.breakdown.push({ step: `${agent_id} specialist`, input: tu.inputTokens ?? 0, output: tu.outputTokens ?? 0 });
          }

          const resultText = agentResult.success
            ? (agentResult.data?.response ?? "Agent responded with no content.")
            : `The ${agent_id} specialist is temporarily unavailable. Please continue planning based on available information.`;

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            tool_name: toolCall.name,
            content: resultText,
          });
        }
      }

      // Feed tool results back to the LLM
      messages.push({ role: "user", content: toolResults });
    }

    // Max turns reached — return whatever we have
    console.warn(`[Coordinator] Agentic loop reached ${MAX_LOOP_TURNS}-turn limit`);
    return {
      type: "final",
      text: "I've gathered enough information to create your travel plan. Here's what I have so far — feel free to ask for more details on any section.",
      tokenUsage: accumulator,
    };
  }

  // ─── Tool definitions ─────────────────────────────────────────────────────────

  private buildToolDefinitions(): ToolDefinition[] {
    const agents = this.agentRegistry.getAllAgents();
    const agentEnum = agents.map((a) => a.id);
    const agentDesc = agents.map((a) => `${a.id}: ${a.description}`).join(" | ");

    return [
      {
        name: "ask_user",
        description:
          "Ask the user a clarifying question when destination or trip duration is unknown. After calling this, stop and wait for the user's reply.",
        input_schema: {
          type: "object" as const,
          properties: {
            question: { type: "string", description: "The clarifying question to ask the user" },
          },
          required: ["question"],
        },
      },
      {
        name: "call_agent",
        description: `Call a specialist travel agent by ID to get expert recommendations. Available agents — ${agentDesc}`,
        input_schema: {
          type: "object" as const,
          properties: {
            agent_id: {
              type: "string",
              enum: agentEnum,
              description: agentDesc,
            },
            request: {
              type: "string",
              description: "The full travel request to pass to the agent",
            },
            context: {
              type: "string",
              description:
                "Additional context from previous agent results (e.g. attraction areas, accommodation location) to help this agent produce more relevant results",
            },
          },
          required: ["agent_id", "request"],
        },
      },
    ];
  }

  private buildSystemPrompt(): string {
    const { coordinator } = getPrompts();
    const agents = this.agentRegistry.getAllAgents();
    const agentDescriptions = agents
      .map((a) => `[${a.id}]\nDescription: ${a.description}\nCapabilities: ${a.capabilities.join(", ")}`)
      .join("\n\n");
    return `${coordinator.system}\n\nAvailable specialist agents:\n${agentDescriptions}`;
  }

  /**
   * Convert A2A Message history into LLM conversation messages.
   * Each previous user and agent message becomes one LLMMessage.
   */
  private buildLLMMessages(history: Message[]): LLMMessage[] {
    return history
      .map((msg): LLMMessage | null => {
        const text = this.extractTextFromMessage(msg);
        if (!text) return null;
        return {
          role: msg.role === "agent" ? "assistant" : "user",
          content: text,
        };
      })
      .filter((m): m is LLMMessage => m !== null);
  }

  // ─── A2A event publishing ─────────────────────────────────────────────────────

  private async publishProgress(taskId: string, contextId: string, message: string, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.publish({
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
    } as TaskStatusUpdateEvent);
  }

  private publishStatus(
    taskId: string,
    contextId: string,
    state: "completed" | "canceled" | "failed",
    text: string,
    final: boolean,
    eventBus: ExecutionEventBus
  ): void {
    const msg: Message = {
      kind: "message",
      role: "agent",
      messageId: uuidv4(),
      parts: [{ kind: "text", text }],
      taskId,
      contextId,
    };
    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId,
      status: { state, message: msg, timestamp: new Date().toISOString() },
      final,
    } as TaskStatusUpdateEvent);
  }

  private async publishAskUser(
    taskId: string,
    contextId: string,
    question: string,
    history: Message[],
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const agentMsg: Message = {
      kind: "message",
      role: "agent",
      messageId: uuidv4(),
      parts: [{ kind: "text", text: question }],
      taskId,
      contextId,
    };

    // Store in history so next execute() sees the Q&A context
    history.push(agentMsg);
    contexts.set(contextId, history);

    // Publish the question as an artifact (frontend renders artifact content)
    const artifactEvent: TaskArtifactUpdateEvent = {
      kind: "artifact-update",
      taskId,
      contextId,
      artifact: {
        artifactId: uuidv4(),
        name: "clarification.md",
        description: "Clarifying question",
        parts: [{ kind: "text" as const, text: question }],
      },
      append: false,
      lastChunk: true,
    };
    eventBus.publish(artifactEvent);

    // Completed status — frontend treats this the same as a regular reply
    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId,
      status: { state: "completed", message: agentMsg, timestamp: new Date().toISOString() },
      final: true,
    } as TaskStatusUpdateEvent);
  }

  private async publishFinalPlan(
    taskId: string,
    contextId: string,
    finalText: string,
    tokenUsage: { inputTokens: number; outputTokens: number; breakdown: any[] },
    history: Message[],
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const artifact = {
      artifactId: uuidv4(),
      name: "travel_plan.md",
      description: "Complete travel plan",
      parts: [{ kind: "text" as const, text: finalText }],
      metadata: { tokenUsage },
    };

    try {
      this.taskStore.addTaskArtifact(taskId, artifact);
    } catch {
      // Task may not be in local store if using A2A standard flow
    }

    const artifactEvent: TaskArtifactUpdateEvent = {
      kind: "artifact-update",
      taskId,
      contextId,
      artifact,
      append: false,
      lastChunk: true,
    };
    eventBus.publish(artifactEvent);

    const agentMsg: Message = {
      kind: "message",
      role: "agent",
      messageId: uuidv4(),
      parts: [{ kind: "text", text: finalText }],
      taskId,
      contextId,
    };
    history.push(agentMsg);
    contexts.set(contextId, history);

    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId,
      status: { state: "completed", message: agentMsg, timestamp: new Date().toISOString() },
      final: true,
    } as TaskStatusUpdateEvent);
  }

  // ─── Utilities ────────────────────────────────────────────────────────────────

  private extractTextFromMessage(message: any): string {
    if (typeof message === "string") return message;
    if (message?.parts && Array.isArray(message.parts)) {
      return message.parts
        .filter((p: any) => p.kind === "text")
        .map((p: any) => p.text)
        .join(" ");
    }
    return "";
  }

  getActiveTasksCount(): number {
    return 0;
  }

  getTaskStoreStats(): any {
    return this.taskStore.getStats();
  }

  async getAgentsHealth(): Promise<Record<string, boolean>> {
    return this.agentRegistry.getAllAgentsHealth();
  }
}
