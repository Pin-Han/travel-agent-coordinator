# Phase 12：多輪精煉（Plan Refinement）

## Context

Phase 10 的結構化輸出讓行程資料變成可操作的 JSON。Phase 12 利用這份資料實現「局部修改」：用戶說「太貴了」，系統只重新查住宿，不把整份行程推翻重來。

這是讓系統從「工具」演化為「對話式旅遊顧問」的核心功能。

**先決條件**：Phase 10（結構化輸出 + PlanState 基礎型別）必須先完成。

---

## 核心問題

### 現在的行為（Phase 10 之後）

```
用戶：「太貴了，換預算住宿」
    ↓
Coordinator：識別為新請求 → 呼叫三個 agent → 整個行程重生成
    ↓
問題：景點、交通全部重做，用戶已滿意的部分被推翻
```

### Phase 12 的目標行為

```
用戶：「太貴了，換預算住宿」
    ↓
Coordinator：識別為修改意圖 → 只呼叫 Accommodation Agent
    → 傳入現有 PlanState + 修改指令
    ↓
Accommodation Agent 回傳新住宿選項
    ↓
Coordinator 更新 PlanState（只換住宿欄位，version +1）
    ↓
回覆：「已將住宿更換為預算選項（$50-$65/晚）。景點和交通安排不變。」
    ↓
地圖同步更新住宿標記
```

---

## PlanState 設計

```typescript
// src/services/planStateService.ts

interface PlanState {
  id: string;                    // plan UUID
  version: number;               // 每次修改 +1，從 1 開始
  destination: string;
  duration_days: number;
  travelers: number;
  budget_usd?: number;
  start_date?: string;           // ISO date，用戶提供時才有

  days: DayPlan[];

  accommodation: AccommodationPlan;   // 住宿獨立存（跨天共用）
  transportation: TransportationPlan; // 交通獨立存

  total_estimated_cost?: {
    min: number;
    max: number;
    currency: "USD";
    breakdown?: CostBreakdown;
  };

  map_data: MapData;             // Phase 11 消費
  generated_at: string;
  last_modified_at: string;
  modification_history: ModificationRecord[];
}

interface DayPlan {
  day: number;
  theme: string;
  attractions: AttractionItem[];
}

interface ModificationRecord {
  version: number;
  timestamp: string;
  user_request: string;          // 用戶原始說的話
  what_changed: string;          // "accommodation" | "attractions" | "transportation" | "full"
}
```

### 儲存位置

```typescript
// per-context 儲存，和 conversation history 同生命週期
const planStates: Map<string, PlanState> = new Map();  // key: contextId
```

---

## 修改意圖分類

### 分類邏輯

在 Coordinator `runAgenticLoop()` 開始前，先判斷這條訊息是「新規劃」還是「修改現有規劃」：

```typescript
type ModificationIntent =
  | { type: "new_plan" }
  | { type: "modify_accommodation"; instruction: string }
  | { type: "modify_attractions"; instruction: string }
  | { type: "modify_transportation"; instruction: string }
  | { type: "full_replan"; reason: string }
  | { type: "question"; topic: string }   // 問問題，不觸發規劃
```

**判斷方式**：用 LLM 一次輕量 call（不帶 tools），輸出 JSON：

```typescript
async function classifyModificationIntent(
  userText: string,
  hasPlanState: boolean,
  provider?: LLMProvider
): Promise<ModificationIntent>
```

**System prompt 判斷規則：**

```
有現有行程（hasPlanState = true）時：

修改住宿 → modify_accommodation
  觸發詞：「太貴」「換住宿」「換飯店」「更便宜」「更豪華」「換個地方住」
  包含：預算調整、地點偏好改變

修改景點 → modify_attractions
  觸發詞：「加一個」「移除」「換景點」「太累了」「行程太滿」「調整第X天」
  包含：新增/刪除/替換景點、天數調整（不改整體天數時）

修改交通 → modify_transportation
  觸發詞：「交通怎麼去」「有沒有比較快」「可以租車嗎」「JR Pass 值得嗎」

整體重新規劃 → full_replan
  觸發詞：「整個重來」「換目的地」「改成X天」「改成X個人」
  或：天數/人數/目的地改變

問問題 → question
  觸發詞：「幾月去比較好」「需要簽證嗎」「天氣怎麼樣」（不要求修改行程）

沒有現有行程（hasPlanState = false）時：
  → 永遠是 new_plan
```

---

## Coordinator 修改流程

### 修改住宿（最常見）

```typescript
case "modify_accommodation":
  await this.publishProgress(taskId, contextId, "Updating accommodation options...", eventBus);

  const currentPlan = planStates.get(contextId);
  const agentResult = await this.agentRegistry.callAgentAPI(
    "accommodation",
    "process_request",
    {
      request: intent.instruction,
      context: JSON.stringify({
        existing_plan: currentPlan,
        attraction_areas: currentPlan.days.flatMap(d => d.attractions.map(a => a.area)),
        modification: true,   // agent 知道這是修改，不是全新規劃
      }),
      provider,
    },
    AGENT_TIMEOUT_MS
  );

  // 更新 PlanState
  const updatedPlan = {
    ...currentPlan,
    accommodation: agentResult.data.structured.accommodation,
    map_data: rebuildMapData(currentPlan, { accommodation: agentResult.data.structured.accommodation }),
    version: currentPlan.version + 1,
    last_modified_at: new Date().toISOString(),
    modification_history: [
      ...currentPlan.modification_history,
      { version: currentPlan.version + 1, timestamp: new Date().toISOString(),
        user_request: userText, what_changed: "accommodation" }
    ],
  };
  planStates.set(contextId, updatedPlan);

  // 合成回覆（只說改了什麼）
  return { type: "final", text: synthesizeModificationReply(updatedPlan, "accommodation"), ... };
```

### 修改景點

類似住宿，但傳給 Attractions Agent 的 context 包含「現有景點列表」和「用戶想加/移除什麼」。

### 整體重新規劃

清除 PlanState，走完整的三 agent agentic loop（同 Phase 5 邏輯）。

### 問問題（不修改行程）

直接用 LLM 回答，不呼叫 agent，不更新 PlanState。

---

## 修改回覆格式

修改後的回覆要讓用戶清楚「什麼改了、什麼沒變」：

```
✅ 住宿已更新（v2）

**新住宿：**
- Shinjuku Budget Inn — $55/晚，Shinjuku 站步行 5 分鐘
- Asakusa Hostel Deluxe — $48/晚，雙人房

**估計住宿總費用：**$206-$220（4 晚）

景點安排和交通規劃不變。如需調整其他部分，請告訴我。
```

不重複輸出整份行程（太冗長），只說修改的部分。

---

## 版本歷史 UI（選做）

在 ChatPage 的 agent 訊息底部，有現有規劃時顯示版本徽章：

```
[v1] → [v2 住宿更新] → [v3 加景點]
```

點擊可以查看該版本的 modification record。

---

## 受影響的檔案

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `src/services/planStateService.ts` | 新建 | PlanState CRUD；`planStates` Map；`rebuildMapData()` |
| `src/agents/coordinatorExecutor.ts` | 修改 | 注入 PlanStateService；`classifyModificationIntent()`；各 case 處理 |
| `docs/prompts/coordinator.md` | 修改 | 加入修改意圖識別邏輯；修改回覆格式要求 |
| `docs/prompts/accommodation.md` | 修改 | 加入 `modification: true` 時的行為說明（只輸出住宿，不重複景點）|
| `docs/prompts/attractions.md` | 修改 | 同上，加入修改模式下的行為說明 |
| `web/src/pages/ChatPage.tsx` | 修改 | 每次 artifact 更新時，同步更新地圖（Phase 11）|

---

## Harness 視角

**Guides 新增**：
- `coordinator.md` 加入修改意圖識別規則（明確什麼情況觸發哪個 case）
- 各 agent prompt 加入「修改模式」說明，避免在只需要更新住宿時又輸出整份行程

**Sensors 新增**：
- **PlanConsistencyValidator**：修改後驗證 PlanState 一致性
  - 天數是否正確（days 陣列長度 = duration_days）
  - 每天至少有一個景點
  - 住宿存在（不是 null）
  - 違反 → log warning，不阻擋回傳（避免誤殺）

---

## 實作順序

| 步驟 | 內容 |
|------|------|
| 1 | `planStateService.ts` — PlanState 型別 + CRUD |
| 2 | `coordinatorExecutor.ts` — `classifyModificationIntent()` |
| 3 | `coordinatorExecutor.ts` — `modify_accommodation` case 完整流程 |
| 4 | `coordinatorExecutor.ts` — `modify_attractions` / `modify_transportation` case |
| 5 | `coordinatorExecutor.ts` — `full_replan` case（清除 state + 重走 Phase 5 流程）|
| 6 | `coordinatorExecutor.ts` — `question` case（直接 LLM 回答）|
| 7 | `docs/prompts/coordinator.md` — 更新 prompt |
| 8 | 端到端測試（見下）|

---

## 驗證方式

1. **首次規劃**：完整查詢 → 三 agent 全呼叫 → PlanState version 1 建立
2. **修改住宿**：「太貴了換預算選項」→ 只呼叫 Accommodation Agent → PlanState version 2；回覆只說住宿改了，不重複景點
3. **修改景點**：「Day 2 太累了移除一個景點」→ 只呼叫 Attractions Agent → PlanState version 3
4. **問問題**：「幾月去最好？」→ 直接 LLM 回答，不呼叫任何 agent，PlanState 不變
5. **整體重來**：「整個重來，改成 3 天」→ 清除 PlanState → 三 agent 重新呼叫
6. **無 PlanState**（新對話）：任何輸入都走 new_plan 流程

---

## 邊界條件

| 情境 | 處理方式 |
|------|----------|
| `classifyModificationIntent()` LLM 失敗 | 視為 `new_plan`，走完整流程（安全降級）|
| 分類不確定（e.g. 「改一下行程」模糊指令）| 視為 `full_replan`，或先 `ask_user` 確認要改哪個部分 |
| Agent 修改後回傳 schema 不符 | SchemaValidator（Phase 10）觸發，回傳舊版 PlanState + error message |
| 用戶要求修改但 PlanState 已過期（server 重啟）| PlanState 不存在 → 視為 `new_plan` → 重新規劃 |
| 修改 10 次以上（version ≥ 10）| 不限制，但 modification_history 只保留最新 10 筆 |
