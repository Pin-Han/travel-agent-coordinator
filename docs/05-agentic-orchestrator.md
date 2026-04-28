# Phase 5: Agentic Orchestrator — LLM-Driven Agent Dispatch

## Context

目前 coordinator 的執行流程是**寫死在程式碼裡的**：
```
收到訊息 → 無條件呼叫 attractions → 呼叫 accommodation → LLM synthesis
```

這代表：
- 使用者只說「台北」，系統馬上就去查景點和住宿
- 要呼叫哪些 agent、呼叫順序，都由 TypeScript 決定，不是 LLM 決定
- 資訊收集邏輯靠脆弱的 regex（`extractTravelInfo`），只懂中文格式

同時發現 `agentRegistry.ts` 裡的 `callAttractionsLLM` / `callAccommodationLLM` 有**各自的硬編碼中文 prompt**，完全繞過了 `config/prompts.json`，造成兩套 prompt 系統並存。

---

## 目標架構：Orchestrator 用 Tool Use 主導一切

### 概念

把每個 sub-agent 包裝成一個 **LLM tool（function）**，讓 orchestrator LLM 自己決定：
1. 資訊夠了嗎？不夠 → 問使用者
2. 要呼叫哪個 agent？
3. 呼叫完拿到結果，還需要什麼？
4. 全部拿到後 → 自己合成最終回覆

```
使用者訊息
    ↓
【Agentic Loop 開始】
    LLM（帶 tool definitions）
    ├── tool_use: ask_user(question)      → 發布 input-required，結束本輪
    ├── tool_use: call_attractions(...)   → 呼叫 agent，結果加回 messages，繼續
    ├── tool_use: call_accommodation(...) → 呼叫 agent，結果加回 messages，繼續
    ├── tool_use: call_transportation(...) → 呼叫 agent，結果加回 messages，繼續
    └── text（不再呼叫工具）               → 最終答案，發布 artifact
【Loop 結束】
```

### 為何這樣比較好

| | 現有（hardcoded pipeline） | 新（agentic tool use） |
|--|--------------------------|----------------------|
| 呼叫哪個 agent | TypeScript 寫死 | LLM 依情境決定 |
| 呼叫順序 | 永遠 attractions → accommodation | LLM 視需要調整 |
| 資訊不足 | 直接呼叫、結果品質差 | 先問使用者再呼叫 |
| 新增 agent | 要改 coordinatorExecutor.ts | 只需加 tool definition |
| 能力上限 | 只能三步流程 | 可多輪、可重新查詢 |

---

## Tools 的來源：Agent Card，不是手動定義

**程式端不手動寫死 tool schema。** 改為在 loop 開始前，從各 agent 讀取其 `AgentCard`，動態轉換成 LLM tool definitions。

### Agent Card → Tool Definition 轉換邏輯

每個 agent（api 模式）在 `agentRegistry.ts` 有自己的 card metadata；a2a 模式則從 `/.well-known/agent.json` 取。

轉換方式：

```typescript
// 1 個通用執行工具 + 動態 agent_id enum
function buildToolsFromCards(cards: AgentCard[]) {
  return [
    {
      name: "ask_user",
      description: "Ask the user a clarifying question before proceeding",
      input_schema: {
        type: "object",
        properties: {
          question: { type: "string" }
        },
        required: ["question"]
      }
    },
    {
      name: "call_agent",
      description: "Call a specialist travel agent by ID",
      input_schema: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            enum: cards.map(c => c.id),      // ← 從 registry 動態產生
            description: cards.map(c =>
              `${c.id}: ${c.description}`     // ← LLM 讀這個決定要叫誰
            ).join("\n")
          },
          request: {
            type: "string",
            description: "The full travel request context to pass to the agent"
          },
          context: {
            type: "string",
            description: "Additional context from previous agent results (e.g. attraction areas)"
          }
        },
        required: ["agent_id", "request"]
      }
    }
  ]
}
```

### Agent Cards 同時作為 System Prompt 的一部分

除了 tool schema，orchestrator 的 system prompt 也附上每個 agent 的完整 card 描述（skills、examples），讓 LLM 更準確判斷要呼叫誰：

```
You have access to the following specialist agents:

[attractions]
Description: 搜尋並推薦旅遊景點，附帶地理位置資訊供住宿規劃參考
Skills: Attractions Recommendation — 根據目的地、天數、偏好推薦景點行程
Examples: "幫我規劃紐約5天景點行程..." / "東京3天文化景點推薦..."

[accommodation]
Description: ...
Skills: ...

[transportation]
Description: ...
```

→ 新增 agent 時，只要在 `agentRegistry.ts` 增加一筆 card，orchestrator 就自動感知，**不需要改任何 coordinatorExecutor 邏輯**。

---

## Token 加總策略

一次完整對話可能走過：orchestrator 判斷 → 呼叫 A → 回來 → 呼叫 B → 回來 → 呼叫 C → 最終合成。**每一步都消耗 token，全部要加起來。**

### 需要記錄的 token 來源

```
一輪對話的 token 來源：

Orchestrator LLM turns（每次 loop 迭代呼叫一次 LLM）
  ├── Turn 1: "資訊不足，呼叫 ask_user"          → input + output tokens
  ├── Turn 2: "呼叫 attractions agent"           → input + output tokens
  ├── Turn 3: "呼叫 accommodation agent"         → input + output tokens
  ├── Turn 4: "呼叫 transportation agent"        → input + output tokens
  └── Turn 5: "資訊夠了，輸出最終答案"             → input + output tokens

Sub-agent LLM calls（api 模式，各 agent 自己呼叫 LLM）
  ├── attractions agent LLM call               → input + output tokens
  ├── accommodation agent LLM call             → input + output tokens
  └── transportation agent LLM call            → input + output tokens
```

### 實作方式

```typescript
// coordinatorExecutor.ts
interface TokenAccumulator {
  inputTokens: number;
  outputTokens: number;
  breakdown: Array<{
    step: string;   // e.g. "orchestrator_turn_1", "agent_attractions"
    input: number;
    output: number;
  }>;
}

// 在 runAgenticLoop 裡每次收到 LLM 回應就累加
accumulator.inputTokens  += turn.usage?.inputTokens ?? 0;
accumulator.outputTokens += turn.usage?.outputTokens ?? 0;
accumulator.breakdown.push({ step: `orchestrator_turn_${i}`, ... });

// executeTool 呼叫 agent 後，從 AgentAPIResponse 取出 tokenUsage 累加
const agentResult = await agentRegistry.callAgentAPI(...);
if (agentResult.data?.tokenUsage) {
  accumulator.inputTokens  += agentResult.data.tokenUsage.inputTokens;
  accumulator.outputTokens += agentResult.data.tokenUsage.outputTokens;
  accumulator.breakdown.push({ step: `agent_${agentId}`, ... });
}

// 最終 artifact 的 metadata 帶完整加總
artifact.metadata = {
  tokenUsage: {
    inputTokens:  accumulator.inputTokens,
    outputTokens: accumulator.outputTokens,
    breakdown:    accumulator.breakdown   // 前端可選擇顯示細項
  }
}
```

### 注意：a2a 模式下 sub-agent token 無法取得

a2a 模式下，sub-agent 在獨立 process 執行 LLM，目前不透過 A2A response 回傳 token 數。只有 api 模式（直接呼叫 `agentRegistry.callLLMAgent`）才能取到 sub-agent token。

→ 前端顯示時可標注：`Session: 3,241 tokens (orchestrator only)`（a2a 模式）或 `Session: 8,502 tokens (all agents included)`（api 模式）

---

## 受影響的檔案與改動方向

### 1. `src/services/llmClient.ts` — 新增 tool use 支援

目前 `LLMClient` 介面只有 `complete()`，需新增支援工具回呼的方法：

```typescript
export interface ToolDefinition { /* Anthropic/Gemini compatible tool schema */ }
export interface ToolUseResult { type: "tool_use"; name: string; id: string; input: Record<string, any> }
export interface TextResult    { type: "text"; text: string }
export type LLMTurnResult = (ToolUseResult | TextResult)[]

// LLMClient 新增：
completeWithTools(
  messages: Array<{ role: "user" | "assistant"; content: string | any[] }>,
  tools: ToolDefinition[],
  options?: LLMOptions
): Promise<{ content: LLMTurnResult; usage?: LLMUsage }>
```

- **Anthropic**：`client.messages.create({ tools, messages })` — 原生支援，回傳 `content` 陣列含 `tool_use` block
- **Gemini**：`model.generateContent({ tools: [{ functionDeclarations }] })` — 原生支援

### 2. `src/agents/coordinatorExecutor.ts` — 改為 Agentic Loop

**移除**：
- `callTwoMainAgents()`
- `integrateAgentResults()`（合成由 LLM 直接在 loop 最後輸出）
- `generateEnhancedSummary()`、`generateSimpleSummary()`
- `extractTravelInfo()`（不再需要 regex 提取，LLM 自己決定傳什麼給 tool）

**新增**：
- `runAgenticLoop(messages, eventBus)` — 主迴圈，最多跑 N 輪（防止無限迴圈，建議 10 輪上限）
- `executeTool(toolName, toolInput)` — 根據 tool name 分派到 `agentRegistry.callAgentAPI()`
- `ask_user` tool 的處理：發布 A2A `input-required` 狀態，讓使用者回覆後繼續同一 context

**多輪對話的 `input-required` 流程**：
```
Orchestrator 呼叫 ask_user("How many days?")
    ↓
coordinatorExecutor 發布 status: "input-required", final: true
    ↓ （使用者回覆，同一 contextId）
coordinatorExecutor.execute() 再次被呼叫
    ↓
從 contexts Map 取出歷史 → 把整段對話傳給 LLM → Loop 繼續
```

> A2A spec 有 `input-required` task state，正好對應這個場景。

### 3. `src/services/agentRegistry.ts` — 成為純粹的 Tool Executor

**移除**：
- `callAttractionsLLM()` — 裡面有硬編碼中文 prompt，應改用 `prompts.json`
- `callAccommodationLLM()` — 同上
- `extractDestination/Duration/Travelers/Budget/Preferences()` — 由 LLM tool input 取代

**保留並調整**：
- `callAgentAPI()` — 繼續作為統一入口（api 模式 / a2a 模式路由）
- api 模式改為讀 `prompts.json`，用 tool input 的結構化欄位組裝 prompt，不再 regex

**新增**：
- `callTransportationLLM()` — 同 attractions/accommodation 模式（讀 `prompts.json`）

### 4. `config/prompts.json` — Orchestrator System Prompt 是關鍵

Orchestrator 的 `system` prompt 要清楚描述：
- 你有哪些工具可用（呼應 tool definitions）
- 什麼情況下先問使用者（destination 和 duration_days 是必要資訊）
- 最終輸出的格式結構（對應 `orchestrator.md` 的四段式結構）
- 語言跟隨使用者

同時**移除** `coordinator.integration` 和 `coordinator.fallback` — 這兩個 prompt 是給舊的兩段式流程用的，agentic loop 之後不再需要。

---

## 簡化後的 `prompts.json` 結構

```json
{
  "coordinator": {
    "system": "You are a travel planning orchestrator with access to specialist agents...\n[4-step structure from orchestrator.md]\n[tool usage guidance]\n[language instruction]"
  },
  "attractions": {
    "system": "...",
    "user": "...(uses tool input fields, not regex-extracted fields)"
  },
  "accommodation": {
    "system": "...",
    "user": "..."
  },
  "transportation": {
    "system": "...",
    "user": "..."
  }
}
```

---

## 實作順序

| 步驟 | 內容 | 說明 |
|------|------|------|
| 1 | `llmClient.ts`：新增 `completeWithTools()` | Anthropic + Gemini 各自實作 |
| 2 | `config/prompts.json`：新增 transportation、改寫 coordinator system prompt | Prompt 先到位再改邏輯 |
| 3 | `agentRegistry.ts`：移除硬編碼 prompt，改讀 prompts.json；新增 transportation | 清理舊包袱 |
| 4 | `coordinatorExecutor.ts`：實作 agentic loop + `input-required` 處理 | 核心改動 |
| 5 | 端到端測試：單輪完整資訊 / 多輪補齊資訊 / graceful degradation | 驗證三種路徑 |

---

## 邊界條件

| 情境 | 處理方式 |
|------|----------|
| LLM 一直呼叫 tool 不停（無限迴圈） | Loop 上限 10 輪，超過直接用目前結果合成 |
| Agent 呼叫失敗 | Tool result 回傳 error message，LLM 決定是否繼續或告知使用者 |
| 使用者長時間不回覆 `input-required` | A2A task 維持 `input-required` 狀態，下次回覆時繼續 |
| Gemini 不支援某個 tool schema 格式 | `llmClient` 層做格式轉換（Anthropic schema → Gemini FunctionDeclaration） |
