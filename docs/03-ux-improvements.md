# Phase 3+ UX & Feature Improvements

## Context

目前系統已完成 Phase 0–3（A2A sub-agents、Web UI、Streaming、MCP 整合），但在日常使用上有幾個痛點：
1. 每次重新整理頁面，對話紀錄就消失
2. UI 文字夾雜中英文，不一致
3. 沒有 token 用量可見性
4. 回覆雖有 Markdown 渲染，但 prompt 沒有指示要結構化輸出
5. prompt 強制繁體中文，無法服務英文使用者

本次計劃同時解決上述五點，全部屬於前端 + prompt 層調整，不動 A2A 協議核心。

---

## 變更範圍

### 1. 對話歷史持久化（localStorage）

**目標**：重新整理後對話不消失

**作法**：
- `ChatPage.tsx`：`useEffect` 監聽 `messages` 變化 → 寫入 `localStorage['chat-history']`；mount 時讀回
- Message interface 加 `id: string`（`crypto.randomUUID()`）方便未來管理
- 加「Clear conversation」按鈕，清除 state 同時清除 localStorage
- 上限：保留最近 100 則訊息（超過時 shift 舊訊息）

**受影響檔案**：`web/src/pages/ChatPage.tsx`

---

### 2. 全面英文化 UI

**目標**：英文為主的介面，降低語言混用的認知負擔

**作法**：
- `ChatPage.tsx`：
  - 歡迎訊息改為英文（"Hi! I'm your travel planning assistant. Where would you like to go?"）
  - 載入狀態文字改英文（"Planning your trip..."、進度 status 文字）
  - 輸入框 placeholder、送出按鈕、錯誤訊息全改英文
  - 無法取得回應的 fallback 文字改英文
- `SettingsPage.tsx`：
  - 所有 label、標題、說明文字改英文
  - 儲存/重設按鈕改英文

**受影響檔案**：`web/src/pages/ChatPage.tsx`、`web/src/pages/SettingsPage.tsx`

---

### 3. Token 用量顯示（Inline，不開新頁面）

**決策**：每則 agent 回覆下方顯示小字 token 數，不另開頁面。
理由：inline 顯示不需要切換頁面，直接在對話脈絡中看到每次呼叫的費用，更直覺。Session 總計顯示在 chat header 右側。

**後端改動**：
- `src/services/llmClient.ts`：
  - 新增回傳介面：`LLMResponse { text: string; usage?: { inputTokens: number; outputTokens: number } }`
  - `AnthropicClient.complete()`：從 `message.usage` 取 `input_tokens`、`output_tokens` 並回傳
  - `GeminiClient.complete()`：從 `result.response.usageMetadata` 取 `promptTokenCount`、`candidatesTokenCount`
  - 注意：`llmClient.ts` 目前介面回傳 `Promise<string>`，需改為 `Promise<LLMResponse>`，並更新所有呼叫端

**呼叫端調整**：
- `src/services/agentRegistry.ts`：`AgentAPIResponse.data` 加 `tokenUsage?: { inputTokens: number; outputTokens: number }`
- `src/agents/orchestratorExecutor.ts`：彙整三個 LLM call（attractions/accommodation/synthesis）的 token 數，累加後放入 artifact event metadata

**前端顯示**：
- SSE `artifact-update` event 的 metadata 加入 token 數
- `Message` interface 加 `tokenUsage?: { input: number; output: number }`
- 在每則 agent 訊息泡泡底部顯示：`↑ 312 / ↓ 891 tokens`（小字、灰色）
- Chat header 右側顯示：`Session: 2,403 tokens`

**受影響檔案**：
- `src/services/llmClient.ts`（介面 + 實作）
- `src/services/agentRegistry.ts`（response 型別）
- `src/agents/orchestratorExecutor.ts`（彙整 + 傳遞）
- `web/src/pages/ChatPage.tsx`（顯示）

---

### 4. 結構化輸出（Prompt 指示 + Markdown 強化）

**目標**：LLM 回覆有清楚的段落標題、列表、表格

**作法**：
- `config/prompts.json`：coordinator 的 `integration` prompt 加入明確格式指示：
  ```
  Format the travel plan with clear Markdown sections:
  ## Day-by-Day Itinerary
  ## Top Attractions
  ## Accommodation Recommendations
  ## Practical Tips
  Use bullet points and tables where appropriate.
  ```
- 前端 Markdown 渲染強化：
  - 確認 `prose` 樣式套用正確（目前已有 `prose prose-sm`）
  - 可加 `prose-headings:font-semibold prose-h2:text-lg prose-h3:text-base` 讓標題層次明顯

**受影響檔案**：`config/prompts.json`、`web/src/pages/ChatPage.tsx`（樣式調整）

---

### 5. Prompt 改為回應使用者語言（需重寫 prompt 架構）

**目標**：使用者用英文問 → 英文回；用中文問 → 中文回

**根本問題**：目前 `config/prompts.json` 所有 system prompt 和 user prompt 模板的**指令文字都是繁體中文**。即使加上「respond in user's language」，LLM 看到的 context 大多是中文，仍會偏向中文輸出。

**作法**：
- `config/prompts.json`：**將三個 agent（attractions、accommodation、coordinator）的所有 prompt 指令文字全部改寫為英文**
  - `system` prompt：角色定義、能力描述改英文
  - `user` prompt：任務指示模板改英文，`{request}` / `{attractions}` / `{accommodation}` placeholder 保留
  - `integration` / `fallback` prompt：整合指示改英文
- 每個 agent 的 system prompt 結尾加：
  ```
  Always respond in the same language the user used in their request.
  ```
- 移除所有 `請用繁體中文回答`

**範例轉換**（attractions system prompt）：
```
Before: 你是專業旅遊規劃師，提供詳細且實用的景點推薦...請用繁體中文回答
After:  You are a professional travel planner specializing in attractions and dining recommendations...
        Always respond in the same language the user used in their request.
```

**受影響檔案**：`config/prompts.json`（全部 prompt 內容重寫）

---

## 實作順序

| 步驟 | 內容 | 複雜度 |
|------|------|--------|
| 1 | `config/prompts.json`：語言指示 + 格式指示（Prompt 重寫為英文） | Low |
| 2 | `web/src/pages/ChatPage.tsx` + `SettingsPage.tsx`：英文化 | Low |
| 3 | `ChatPage.tsx`：localStorage 對話持久化 | Low-Medium |
| 4 | `llmClient.ts`：回傳 `LLMResponse`（breaking change） | Medium |
| 5 | `agentRegistry.ts` + `orchestratorExecutor.ts`：傳遞 token 數 | Medium |
| 6 | `ChatPage.tsx`：顯示 token 數 | Low |
| 7 | `ChatPage.tsx`：Markdown 樣式調整（視效果而定） | Low |

**建議從最低風險的 1、2、3 開始**，token tracking（4–6）涉及後端介面變更，放後面做。

---

## 驗證方式

1. **localStorage 持久化**：送出幾則訊息後重新整理頁面，確認對話仍在；點 Clear conversation 後 localStorage 清空
2. **英文 UI**：瀏覽 Chat 頁與 Settings 頁，確認無殘餘中文硬字
3. **Token 顯示**：送出請求後，確認每則 agent 回覆下方出現 token 數字；header 顯示 session 累計
4. **語言跟隨**：用英文問 → 確認回覆為英文；用中文問 → 確認回覆為中文
5. **結構化輸出**：問一個旅遊規劃問題，確認回覆有 Markdown 標題段落、不是一整段無結構文字
