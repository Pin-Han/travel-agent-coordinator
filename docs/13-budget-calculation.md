# Phase 13：預算計算

## Context

「符合中等預算」不夠用。用戶想知道具體數字：這趟旅遊大概花多少錢？住宿佔多少？景點門票多少？餐飲呢？

Phase 13 在 coordinator 整合完三個 agent 的結構化結果後，新增一個 `calculateBudget()` 步驟，輸出明細費用表，並在超出預算時自動警示。

**先決條件**：Phase 10（結構化輸出，含費用欄位）。

---

## 資料來源

費用資料分三個精準度層級：

| 層級 | 來源 | 精準度 | 說明 |
|------|------|--------|------|
| 1（最準）| Tavily 搜尋 + 結構化輸出 | 高 | Agent 在 Phase 10 schema 裡已填入 `estimated_cost_usd` |
| 2（估算）| LLM 知識 | 中 | LLM 依目的地、住宿等級估算 |
| 3（備援）| 預設費用區間 | 低 | 熱門城市的經驗值表 |

Phase 13 優先使用層級 1，不足時 fallback 到層級 2。

---

## calculateBudget() 設計

### 觸發時機

```
三個 agent 呼叫完成
    ↓
coordinator 有完整 PlanState
    ↓
await this.calculateBudget(planState, userRequest, provider)
    ↓
更新 planState.total_estimated_cost
    ↓
費用明細附加到最終回覆
```

### 輸入

```typescript
interface BudgetCalculationInput {
  destination: string;
  duration_days: number;
  travelers: number;
  budget_usd?: number;           // 用戶指定的預算上限

  attractions: AttractionItem[]; // 已有 estimated_cost_usd
  accommodation: AccommodationItem[]; // 已有 price_range_usd_per_night
  transportation: TransportationPlan; // 已有 key_routes[].cost_usd

  meal_preference?: "budget" | "mid-range" | "fine-dining";  // 從 User Memory 或詢問
}
```

### 費用計算邏輯

```typescript
function calculateBudgetBreakdown(input: BudgetCalculationInput): CostBreakdown {
  // 景點門票
  const attractionsCost = input.attractions.reduce((sum, a) =>
    sum + (a.estimated_cost_usd ?? 0) * input.travelers, 0);

  // 住宿（取最便宜的推薦選項）
  const cheapestHotel = input.accommodation.sort((a, b) => a.price_range_usd_per_night.min - b.price_range_usd_per_night.min)[0];
  const accommodationMin = cheapestHotel.price_range_usd_per_night.min * input.duration_days;
  const accommodationMax = cheapestHotel.price_range_usd_per_night.max * input.duration_days;

  // 餐飲（每人每天估算）
  const mealCostPerPersonPerDay = {
    "budget": 20,
    "mid-range": 45,
    "fine-dining": 100,
  }[input.meal_preference ?? "mid-range"];
  const mealsCost = mealCostPerPersonPerDay * input.travelers * input.duration_days;

  // 交通（市區，不含機票）
  const transitCost = input.transportation.key_routes?.reduce((sum, r) =>
    sum + (r.cost_usd ?? 0) * input.travelers, 0) ?? 0;
  const transitPass = input.transportation.recommended_pass?.cost_usd ?? 0;
  const transportationCost = (transitCost + transitPass) * input.travelers;

  return {
    attractions: { amount: attractionsCost, note: `${input.attractions.length} 個景點門票` },
    accommodation: { min: accommodationMin, max: accommodationMax, note: `${input.duration_days} 晚` },
    meals: { amount: mealsCost, note: `每人每天約 $${mealCostPerPersonPerDay}` },
    local_transportation: { amount: transportationCost, note: "市區交通，不含機票" },
    total: {
      min: attractionsCost + accommodationMin + mealsCost + transportationCost,
      max: attractionsCost + accommodationMax + mealsCost + transportationCost,
    }
  };
}
```

### 輸出格式（附加到最終規劃底部）

```markdown
---
## 💰 預估費用（2 人）

| 項目 | 費用 |
|------|------|
| 景點門票 | ~$45 |
| 住宿 4 晚 | $280–$480 |
| 餐飲 | ~$360（每人每天 $45）|
| 市區交通 | ~$60 |
| **預估總計** | **$745–$945** |

> 不含機票。費用為估算值，實際以當地定價為準。
```

---

## 預算符合度 Sensor（Harness 核心）

這是 Phase 13 最重要的 harness 改進：**把預算檢查從「LLM 說符合」變成「數字驗證」**。

```typescript
function checkBudgetCompliance(
  breakdown: CostBreakdown,
  userBudget?: number
): BudgetComplianceResult {
  if (!userBudget) return { compliant: true, severity: "none" };

  const overageMin = breakdown.total.min - userBudget;
  const overageMax = breakdown.total.max - userBudget;

  if (overageMin <= 0) {
    return { compliant: true, severity: "none" };
  }

  if (overageMin > 0 && overageMin <= userBudget * 0.2) {
    // 超出 20% 以內：警示但不阻擋
    return {
      compliant: false,
      severity: "warning",
      message: `⚠️ 預估費用（$${breakdown.total.min}–$${breakdown.total.max}）略超出您的 $${userBudget} 預算。最大超出 $${overageMax}。`,
      suggestion: "可將住宿換成預算選項，或減少一天的行程。"
    };
  }

  // 超出 20% 以上：明確警示 + 建議調整
  return {
    compliant: false,
    severity: "error",
    message: `⚠️ 預估費用（$${breakdown.total.min}–$${breakdown.total.max}）明顯超出您的 $${userBudget} 預算。`,
    suggestion: "建議調整住宿等級或縮短行程天數。輸入「換預算住宿」或「縮短一天」調整。"
  };
}
```

**compliance result 的處理**：
- `severity: "none"` → 在費用明細下方加一行 "✅ 符合預算"
- `severity: "warning"` → 費用明細底部加警示黃色 block
- `severity: "error"` → 費用明細底部加警示紅色 block + 具體調整建議
- 兩種警示情況都**不阻擋回傳**，用戶知情後自行決定是否調整（配合 Phase 12 修改功能）

---

## 餐飲偏好的取得

`meal_preference` 影響費用估算的精準度。取得方式（優先序）：

1. **User Memory（Phase 8）**：記憶裡有「喜歡在地小吃」→ `budget`；「偏好精緻餐廳」→ `fine-dining`
2. **從用戶請求推斷**：「美食之旅」但未指定等級 → `mid-range`
3. **預設**：`mid-range`（不詢問，避免對話碎片化）

---

## 受影響的檔案

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `src/services/budgetCalculator.ts` | 新建 | `calculateBudgetBreakdown()`、`checkBudgetCompliance()` |
| `src/agents/coordinatorExecutor.ts` | 修改 | `publishFinalPlan()` 前呼叫 `calculateBudget()`；compliance result 附加到回覆 |
| `docs/prompts/coordinator.md` | 修改 | 加入費用明細的輸出格式說明 |
| `web/src/pages/ChatPage.tsx` | 修改（選做）| 費用明細顯示時，加入 budget bar（視覺化預算使用率）|

---

## Budget Bar UI（選做）

在費用明細下方加一個視覺化的預算使用率條：

```
預算使用率
$745 ───────────────────▓▓▓▓▓▒░░ $945 / $1000 預算
      ←── 最低估算 ──▶  ↑         ↑
                       最低        最高    預算上限
```

- 綠色區：在預算內
- 黃色區：接近上限（80-100%）
- 紅色區：超出預算

---

## 實作順序

| 步驟 | 內容 |
|------|------|
| 1 | `budgetCalculator.ts` — `calculateBudgetBreakdown()` |
| 2 | `budgetCalculator.ts` — `checkBudgetCompliance()` |
| 3 | `coordinatorExecutor.ts` — 整合到 `publishFinalPlan()` 流程 |
| 4 | `coordinator.md` — 費用明細格式說明 |
| 5 | 驗證（見下）|
| 6 | `ChatPage.tsx` — Budget Bar UI（選做）|

---

## 驗證方式

1. **有預算、符合**：`budget_usd=1000`，計算總費用 $800 → 顯示費用明細 + "✅ 符合預算"
2. **有預算、略超出**：`budget_usd=700`，計算總費用 $745-$945 → 顯示 warning 黃色 block + 調整建議
3. **有預算、明顯超出**：`budget_usd=500`，計算總費用 $745-$945 → 顯示 error 紅色 block + 具體建議
4. **無預算**：不顯示符合度，只顯示費用明細
5. **結構化資料缺少費用欄位**：`calculateBudgetBreakdown()` 使用 LLM fallback 估算，輸出加 "估算值" 標注
6. **超出預算但用戶選擇不調整**：配合 Phase 12，用戶可以說「沒關係，保持原樣」

---

## 邊界條件

| 情境 | 處理方式 |
|------|----------|
| 景點 `estimated_cost_usd` 為 null | 標注「費用未知」，從總計排除 |
| 住宿未指定晚數（無 `duration_days`）| 用 `planState.duration_days` |
| 機票費用 | 明確標注「不含機票」，不估算（地區差異太大）|
| 貨幣非美元（日圓、歐元）| Phase 10 schema 強制 USD，agent prompt 要求換算 |
| `calculateBudget()` 本身拋出例外 | `try/catch`，不附加費用明細，不中斷主流程 |
