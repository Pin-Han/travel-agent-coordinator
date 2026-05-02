# Phase 7: Evaluator Agent

## Context

Phase 5 的 Agentic Loop 讓 LLM 自主決定呼叫哪些 agent、何時詢問使用者，但規劃產出後沒有任何機制驗證品質。Phase 7 引入一個獨立的 **Evaluator Agent**，對 Coordinator 產出的草稿打分，不夠好就要求重做（feedback loop）。

> **注意：並行執行不在本 Phase 範圍內。**
> 旅遊場景下，attractions → accommodation → transportation 的依賴鏈是 domain logic（先確認景點區域，再搜尋附近住宿），不應為了速度而犧牲推薦精準度。執行順序維持 Phase 5 的序列設計。

---

## 架構

```
Coordinator Agentic Loop
  → call_agent(attractions)
  → call_agent(accommodation)   ← 使用 attractionArea context
  → call_agent(transportation)  ← 使用兩個 area context
  → 輸出草稿規劃
         ↓
  Evaluator Agent（獨立 LLM call）
  ├── score ≥ 7/10  → 回傳用戶
  └── score < 7/10  → feedback 附加回 Coordinator messages → 重新規劃
                       最多 2 輪評估，第 2 輪無論如何直接回傳
```

---

## Evaluator Agent 設計

### 角色定位

Evaluator 是一個**獨立的 LLM call**，不是新的 server process。它在 Coordinator 輸出草稿後執行，扮演「嚴格的旅遊規劃審查員」。

### 評分維度（總分 10 分）

```
1. 資訊完整性（0-2 分）
   - 是否涵蓋景點、住宿、交通三個面向？
   - 每天行程是否具體？（有名稱 vs. 只說「參觀某博物館」）

2. 地理合理性（0-2 分）
   - 景點與住宿是否地理位置合理？
   - 交通路線是否符合實際地理關係？

3. 預算符合度（0-2 分）
   - 推薦內容是否符合用戶指定預算？
   - 若用戶未提供預算，此項給滿分 2 分

4. 實用性（0-2 分）
   - 是否包含可執行的資訊？（交通方式、預訂建議、開放時間、費用估算）

5. 需求匹配（0-2 分）
   - 是否符合用戶指定偏好（文化、美食、購物、自然等）？
   - 天數、人數是否正確？

門檻：≥ 7 分通過
```

### Evaluator 輸出格式

```json
{
  "score": 8,
  "passed": true,
  "breakdown": {
    "completeness": 2,
    "geographic": 2,
    "budget": 1,
    "practicality": 2,
    "preference_match": 1
  },
  "feedback": "Budget alignment could be improved — recommended hotels appear above the stated $500 budget. Preference match is good overall."
}
```

### 失敗時的處理

Evaluator 回傳 `passed: false` 時：
- `feedback` 文字以 `tool_result` 形式加回 Coordinator 的 messages
- Coordinator 繼續 loop，依據 feedback 重新規劃
- 最多允許 **2 輪**評估；第 2 輪無論分數如何，直接回傳該輪規劃

---

## 受影響的檔案

### 1. `docs/prompts/evaluator.md`（新建）

Evaluator 的 system prompt，包含：
- 審查員角色定義（強調獨立性、批判性）
- 評分維度詳細說明
- 輸出 JSON 格式要求

### 2. `src/agents/orchestratorExecutor.ts`

新增：
- `EvaluationResult` interface
- `evaluatePlan(draftText, userRequest, provider)` — 呼叫 LLM 打分，回傳 `EvaluationResult`
- `runAgenticLoop()` 修改：產出 `type: "final"` 後，先過 evaluator；若失敗，將 feedback 附加到 messages 並繼續（`evaluationRound` 計數器控制最多 2 輪）

### 3. `docs/prompts/orchestrator.md`

不需改動（序列執行的工作流程描述維持不變）。

---

## Token 影響

每次請求多一次 Evaluator LLM call：
- Input：evaluator system prompt（~300 tokens）+ user request（~100 tokens）+ draft plan（~800-1200 tokens）
- Output：JSON 評分（~100 tokens）
- 預估每次多 ~1300-1700 input tokens

重新規劃時（Evaluator 失敗）：額外一輪 Coordinator loop + Evaluator，約多 ~5000 tokens。

Token breakdown 加入 `evaluator` 欄位：
```typescript
accumulator.breakdown.push({ step: "evaluator", input: ..., output: ... });
```

---

## 實作順序

| 步驟 | 內容 |
|------|------|
| 1 | `docs/prompts/evaluator.md` — 撰寫評分 prompt（含角色強化指令） |
| 2 | `orchestratorExecutor.ts` — 新增 `EvaluationResult` interface 和 `evaluatePlan()` |
| 3 | `orchestratorExecutor.ts` — 修改 `runAgenticLoop()` 加入 evaluator 流程 |
| 4 | 端到端測試（見下） |

---

## 驗證方式

1. **品質 pass**：完整旅遊查詢（目的地 + 天數 + 偏好）→ Evaluator 分數 ≥ 7 → 直接回傳；token breakdown 有 `evaluator` 欄位
2. **品質 fail + 重試**：console log 應顯示 evaluator 分數 < 7、feedback 內容、Coordinator 重新規劃
3. **最大重試保護**：Evaluator 連續失敗 2 輪後強制回傳第 2 輪規劃，不無限迴圈
4. **容錯**：Evaluator LLM 回傳非 JSON → `try/catch` parse，失敗視為 `passed: true` 直接回傳草稿

---

## Optional 後續優化：Self-evaluation bias 緩解

使用同一個 LLM 評估自己的輸出，天生有偏高傾向，可能導致 `score < 7` 很少觸發。以下是可選的改進方向，可在驗證基本流程後再考慮：

1. **強角色指令**：Evaluator prompt 明確指定「你是獨立審查員，不是計劃的作者，你的工作是找出問題，不是讚美」（成本低，效果有限但值得加）
2. **提供原始需求作為對照**：Evaluator 同時看到 user request 和 draft plan，比只看計劃文字更能判斷「有沒有回應需求」
3. **換 provider 互評**：Anthropic 出計劃、Gemini 評分（反之亦然）。效果最好，但需要兩個 API key，複雜度較高

---

## 邊界條件

| 情境 | 處理方式 |
|------|----------|
| Evaluator LLM 回傳非 JSON | `try/catch` parse，失敗視為 `passed: true`（不阻擋回傳） |
| Evaluator 呼叫本身 timeout / 拋出例外 | 視為 `passed: true`，直接回傳草稿 |
| 第 2 輪 Evaluator 仍失敗 | 強制回傳第 2 輪規劃，不再重試 |
| LLM 輸出評分異常（score > 10 或 < 0） | `passed` 以 `score >= 7` 計算，但 clamp 到 0-10 |
