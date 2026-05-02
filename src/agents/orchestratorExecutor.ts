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
import { getPrompts, getEvaluatorSystemPrompt, getMemoryExtractorSystemPrompt } from "../services/promptStore.js";
import { AgentRegistryService } from "../services/agentRegistry.js";
import { TaskStoreService } from "../services/taskStore.js";
import { MemoryService, MemoryInsights } from "../services/memoryService.js";
import { OrchestratorConfig } from "../types/index.js";
import {
  extractTripDetails,
  inferMealPreference,
  calculateBudgetBreakdown,
  checkBudgetCompliance,
  formatBudgetMarkdown,
} from "../services/budgetCalculator.js";
import type { AttractionsOutput, AccommodationOutput, TransportationOutput } from "../services/schemaValidator.js";

// Per-context A2A conversation history
const contexts: Map<string, Message[]> = new Map();

const MAX_LOOP_TURNS = 10;
const AGENT_TIMEOUT_MS = 90_000;
const MAX_EVAL_ROUNDS = 2;

interface EvaluationResult {
  score: number;
  passed: boolean;
  breakdown: Record<string, number>;
  feedback: string;
}

interface TokenAccumulator {
  inputTokens: number;
  outputTokens: number;
  breakdown: Array<{ step: string; input: number; output: number }>;
}

export class TravelOrchestratorExecutor implements AgentExecutor {
  private agentRegistry: AgentRegistryService;
  private taskStore: TaskStoreService;
  private memoryService: MemoryService;
  private cancelledTasks: Set<string> = new Set();

  constructor(_config: OrchestratorConfig) {
    this.agentRegistry = new AgentRegistryService();
    this.taskStore = new TaskStoreService();
    this.memoryService = new MemoryService();
    console.log("🚀 Travel Orchestrator Executor 初始化完成");
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

    console.log(`[Orchestrator] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`);

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
      console.error(`[Orchestrator] Error in task ${taskId}:`, error);
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
    const systemPrompt = promptOverrides?.orchestrator?.system ?? this.buildSystemPrompt();
    const llmMessages = this.buildLLMMessages(history);

    // Build full user request context for the evaluator (all user turns joined)
    const userRequest = history
      .filter((m) => m.role === "user")
      .map((m) => this.extractTextFromMessage(m))
      .filter(Boolean)
      .join("\n");

    const loopResult = await this.runAgenticLoop(
      llmMessages, tools, systemPrompt, userRequest, taskId, contextId, eventBus, promptOverrides, provider
    );

    if (loopResult.type === "ask_user") {
      // Surface clarifying question to user and end turn
      await this.publishAskUser(taskId, contextId, loopResult.text, history, eventBus);
      return;
    }

    // Extract and save memory (independent LLM call, non-blocking on failure)
    await this.extractAndSaveMemory(loopResult.text, history, provider);

    // Append budget breakdown (Phase 11) — non-blocking on failure
    const finalText = this.calculateAndAppendBudget(loopResult.text, loopResult.structuredResults, userRequest);

    // Final plan — publish artifact
    await this.publishFinalPlan(taskId, contextId, finalText, loopResult.tokenUsage, history, eventBus);
  }

  // ─── Agentic loop ─────────────────────────────────────────────────────────────

  private async runAgenticLoop(
    initialMessages: LLMMessage[],
    tools: ToolDefinition[],
    systemPrompt: string,
    userRequest: string,
    taskId: string,
    contextId: string,
    eventBus: ExecutionEventBus,
    promptOverrides?: any,
    provider?: LLMProvider
  ): Promise<{
    type: "final" | "ask_user";
    text: string;
    tokenUsage: TokenAccumulator;
    structuredResults: Map<string, any>;
  }> {
    const llmClient = createLLMClient(provider);
    if (!llmClient.completeWithTools) {
      throw new Error(`Provider "${llmClient.provider}" does not support tool use`);
    }

    const messages: LLMMessage[] = [...initialMessages];
    const accumulator: TokenAccumulator = { inputTokens: 0, outputTokens: 0, breakdown: [] };
    const structuredResults = new Map<string, any>();
    let evalRound = 0;
    let agentsCalled = 0; // only evaluate after at least one call_agent has run

    for (let turn = 1; turn <= MAX_LOOP_TURNS; turn++) {
      if (this.cancelledTasks.has(taskId)) break;

      console.log(`[Orchestrator] Loop turn ${turn}/${MAX_LOOP_TURNS}`);

      const response = await llmClient.completeWithTools(messages, tools, {
        system: systemPrompt,
        maxTokens: 4096,
      });

      // Accumulate orchestrator token usage
      if (response.usage) {
        accumulator.inputTokens  += response.usage.inputTokens;
        accumulator.outputTokens += response.usage.outputTokens;
        accumulator.breakdown.push({ step: `Orchestrator (turn ${turn})`, input: response.usage.inputTokens, output: response.usage.outputTokens });
      }

      // Add assistant turn to conversation
      messages.push({ role: "assistant", content: response.content });

      const toolCalls = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      const textParts = response.content.filter((b): b is TextBlock  => b.type === "text");

      // No tool calls = LLM produced a text response
      if (toolCalls.length === 0) {
        const finalText = textParts.map((b) => b.text).join("\n").trim() || "Travel plan complete.";

        // Only evaluate plans that were built with agent calls.
        // If no agent was called yet, this is a clarifying question or interim response — return directly.
        if (agentsCalled === 0) {
          return { type: "final", text: finalText, tokenUsage: accumulator, structuredResults };
        }

        await this.publishProgress(taskId, contextId, "Reviewing plan quality...", eventBus);
        const evalResult = await this.evaluatePlan(finalText, userRequest, provider, accumulator);
        console.log(`[Evaluator] Score: ${evalResult.score}/10, passed: ${evalResult.passed} (round ${evalRound + 1}/${MAX_EVAL_ROUNDS})`);

        if (evalResult.passed || evalRound >= MAX_EVAL_ROUNDS) {
          return { type: "final", text: finalText, tokenUsage: accumulator, structuredResults };
        }

        // Failed — inject feedback as an internal review, not as user criticism
        evalRound++;
        console.log(`[Evaluator] Requesting revision (round ${evalRound}/${MAX_EVAL_ROUNDS})...`);
        await this.publishProgress(
          taskId, contextId,
          `Refining plan quality (attempt ${evalRound})...`,
          eventBus
        );
        messages.push({
          role: "user",
          content:
            `[INTERNAL QUALITY REVIEW — do not mention this review in your response]\n` +
            `Score: ${evalResult.score}/10 (threshold: 7/10). Please improve the travel plan.\n` +
            `Issues to address:\n${evalResult.feedback}\n` +
            `IMPORTANT: You already have all the destination and trip details from the conversation above. ` +
            `Do NOT ask the user for more information — just revise the plan directly.`,
        });
        continue; // Back to top of for loop for revision turn
      }

      // Execute tool calls sequentially
      const toolResults: ToolResultContent[] = [];

      for (const toolCall of toolCalls) {
        if (toolCall.name === "ask_user") {
          const question: string = (toolCall.input as any).question ?? "Could you provide more details?";
          return { type: "ask_user", text: question, tokenUsage: accumulator, structuredResults };
        }

        if (toolCall.name === "read_memory") {
          const memory = this.memoryService.readMemory("default");
          const memoryText = JSON.stringify(memory, null, 2);
          console.log("[Memory] read_memory called — returning stored preferences");
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            tool_name: toolCall.name,
            content: memoryText,
          });
          continue;
        }

        if (toolCall.name === "call_agent") {
          const { agent_id, request, context } = toolCall.input as { agent_id: string; request: string; context?: string };
          const enrichedRequest = context ? `${request}\n\nAdditional context:\n${context}` : request;

          agentsCalled++;
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

          // Capture structured data for budget calculation (Phase 11)
          if (agentResult.success && agentResult.data?.structuredData) {
            structuredResults.set(agent_id, agentResult.data.structuredData);
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
    console.warn(`[Orchestrator] Agentic loop reached ${MAX_LOOP_TURNS}-turn limit`);
    return {
      type: "final",
      text: "I've gathered enough information to create your travel plan. Here's what I have so far — feel free to ask for more details on any section.",
      tokenUsage: accumulator,
      structuredResults,
    };
  }

  // ─── Evaluator ────────────────────────────────────────────────────────────────

  private async evaluatePlan(
    draftText: string,
    userRequest: string,
    provider: LLMProvider | undefined,
    accumulator: TokenAccumulator
  ): Promise<EvaluationResult> {
    const PASS_SCORE = 7;
    const fallback: EvaluationResult = { score: PASS_SCORE, passed: true, breakdown: {}, feedback: "" };

    try {
      const systemPrompt = getEvaluatorSystemPrompt();
      if (!systemPrompt) {
        console.warn("[Evaluator] evaluator.md not found — skipping evaluation");
        return fallback;
      }

      const prompt = `User's original request:\n${userRequest}\n\nDraft travel plan to evaluate:\n${draftText}`;
      const llmClient = createLLMClient(provider);
      const result = await llmClient.complete(prompt, { system: systemPrompt, maxTokens: 512 });

      // Accumulate evaluator token usage
      if (result.usage) {
        accumulator.inputTokens  += result.usage.inputTokens;
        accumulator.outputTokens += result.usage.outputTokens;
        accumulator.breakdown.push({ step: "evaluator", input: result.usage.inputTokens, output: result.usage.outputTokens });
      }

      // Parse JSON — handle ```json ... ``` wrappers
      const raw = result.text.trim();
      const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) ?? raw.match(/(\{[\s\S]*\})/);
      const parsed = JSON.parse(jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : raw);

      const score = Math.max(0, Math.min(10, Number(parsed.score) || 0));
      return {
        score,
        passed: score >= PASS_SCORE,
        breakdown: parsed.breakdown ?? {},
        feedback: String(parsed.feedback ?? ""),
      };
    } catch (err) {
      console.warn("[Evaluator] Evaluation failed — treating as passed:", err);
      return fallback;
    }
  }

  // ─── Memory extraction ────────────────────────────────────────────────────────

  private async extractAndSaveMemory(
    finalText: string,
    history: Message[],
    provider: LLMProvider | undefined
  ): Promise<void> {
    try {
      const systemPrompt = getMemoryExtractorSystemPrompt();
      if (!systemPrompt) {
        console.warn("[Memory] memory-extractor.md not found — skipping extraction");
        return;
      }

      // Build conversation summary for the extractor
      const conversationText = history
        .map((m) => {
          const text = this.extractTextFromMessage(m);
          if (!text) return null;
          const role = m.role === "agent" ? "Assistant" : "User";
          return `${role}: ${text}`;
        })
        .filter(Boolean)
        .join("\n\n");

      const prompt = `Conversation:\n${conversationText}\n\nFinal travel plan produced:\n${finalText}`;
      const llmClient = createLLMClient(provider);
      const result = await llmClient.complete(prompt, { system: systemPrompt, maxTokens: 512 });

      const raw = result.text.trim();
      const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) ?? raw.match(/(\{[\s\S]*\})/);
      const parsed = JSON.parse(jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : raw);

      const insights: MemoryInsights = {
        newPreferences: parsed.newPreferences ?? [],
        visitedPlaces:  parsed.visitedPlaces  ?? [],
        avoids:         parsed.avoids         ?? [],
        generalInsights: parsed.generalInsights ?? [],
      };

      const hasContent = Object.values(insights).some((arr) => arr.length > 0);
      if (hasContent) {
        this.memoryService.updateMemory("default", insights);
        console.log("[Memory] extractAndSaveMemory — saved:", JSON.stringify(insights));
      } else {
        console.log("[Memory] extractAndSaveMemory — nothing new to save");
      }
    } catch (err) {
      console.warn("[Memory] extractAndSaveMemory failed:", err);
    }
  }

  // ─── Budget calculation ────────────────────────────────────────────────────────

  /**
   * Appends a cost breakdown table to the final plan text.
   * Reads structured agent results collected during the agentic loop.
   * Returns the original text unchanged if structured data is unavailable or calculation fails.
   */
  private calculateAndAppendBudget(
    finalText: string,
    structuredResults: Map<string, any>,
    userRequest: string
  ): string {
    try {
      const attractionsData = structuredResults.get("attractions") as AttractionsOutput | undefined;
      const accommodationData = structuredResults.get("accommodation") as AccommodationOutput | undefined;
      const transportationData = structuredResults.get("transportation") as TransportationOutput | undefined;

      // Need at least attractions + accommodation to produce a meaningful estimate
      if (!attractionsData || !accommodationData) {
        console.log("[Budget] Skipping — structured data missing for attractions or accommodation");
        return finalText;
      }

      const { duration_days, travelers, budget_usd } = extractTripDetails(userRequest);

      // Infer meal preference from stored memory
      const memory = this.memoryService.readMemory("default");
      const meal_preference = inferMealPreference(memory.preferences.travelStyle);

      const breakdown = calculateBudgetBreakdown({
        destination: "",
        duration_days,
        travelers,
        budget_usd,
        attractions: attractionsData.attractions ?? [],
        accommodation: accommodationData.recommendations ?? [],
        transportation: transportationData ?? { primary_transit: "", key_routes: [] },
        meal_preference,
      });

      const compliance = checkBudgetCompliance(breakdown, budget_usd);
      const budgetMd = formatBudgetMarkdown(breakdown, compliance, travelers, budget_usd);

      console.log(`[Budget] Appended breakdown — total $${breakdown.total.min}–$${breakdown.total.max}, compliance: ${compliance.severity}`);
      return finalText + budgetMd;
    } catch (err) {
      console.warn("[Budget] calculateAndAppendBudget failed — returning plan without budget section:", err);
      return finalText;
    }
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
      {
        name: "read_memory",
        description:
          "Read the user's stored travel preferences and history. Always call this as your FIRST action in every planning session so you can personalise the plan.",
        input_schema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
      },
    ];
  }

  private buildSystemPrompt(): string {
    const { orchestrator } = getPrompts();
    const agents = this.agentRegistry.getAllAgents();
    const agentDescriptions = agents
      .map((a) => `[${a.id}]\nDescription: ${a.description}\nCapabilities: ${a.capabilities.join(", ")}`)
      .join("\n\n");
    return `${orchestrator.system}\n\nAvailable specialist agents:\n${agentDescriptions}`;
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
