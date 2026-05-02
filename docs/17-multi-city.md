# Phase 17：多城市串聯行程

## Context

目前系統每次只能規劃單一城市。旅行者常見需求是「東京 3 天 → 京都 2 天 → 大阪 2 天」這樣的串聯行程。Phase 17 讓 orchestrator 能識別多城市請求，分段規劃各城市，並加入城市間移動的交通安排。

**先決條件**：Phase 15（三輪對話流程）。

---

## 功能範圍

- 支援 2–4 個城市串聯（超過 4 個建議拆單次請求）
- 各城市各自呼叫三個 specialist agents
- 城市間移動（新幹線、飛機、巴士）由 transportation agent 統一處理
- 行程概覽先呈現各城市天數分配，確認後再逐城市展開
- 預算計算涵蓋全程所有城市

---

## 技術設計

### 多城市識別（orchestrator prompt）

LLM 在收到請求時先判斷是否為多城市：
- 偵測關鍵詞：「→」「再去」「接著」「then」「followed by」「A and B」
- 若是多城市，提取 `cities: [{name, days}]` 陣列
- 若天數加總與總天數不符，依比例分配或 `ask_user` 確認

### 三輪對話調整（多城市版）

```
Turn 1 — 整體行程概覽
  各城市各呼叫 attractions agent
  ↓
  呈現各城市 Day 概覽 + 城市間移動方式

Turn 2 — 住宿確認（各城市）
  各城市各呼叫 accommodation agent
  ↓
  分城市呈現住宿比較表

Turn 3 — 完整交通 + 預算（最終）
  各城市各呼叫 transportation agent
  ↓
  城市內交通 + 城市間交通 + 全程預算合計
```

### 資料結構

```typescript
interface MultiCityPlan {
  cities: Array<{
    name: string;
    days: number;
    attractions: AttractionsOutput;
    accommodation: AccommodationOutput;
    transportation: TransportationOutput;
  }>;
  inter_city_transport: Array<{
    from: string;
    to: string;
    method: string;          // "新幹線" / "飛機" / "夜巴"
    duration_hours: number;
    cost_usd: number;
    booking_tip?: string;
  }>;
}
```

### Agent 呼叫策略

- 各城市的三個 agent 可以**並行呼叫**（同一城市的 attractions → accommodation → transportation 仍需依序）
- 城市 A 的 attractions agent 完成後，立即開始呼叫城市 A 的 accommodation + 城市 B 的 attractions
- 最大並行數：3（避免 rate limit）

---

## 輸出格式（Turn 1 多城市版）

```markdown
## 📅 7 天日本關西行程概覽

### 🗺 城市分配

| 城市 | 天數 | 主題 |
|------|------|------|
| 東京 | 3 天 | 現代都市、潮流文化 |
| 京都 | 2 天 | 傳統寺廟、茶道體驗 |
| 大阪 | 2 天 | 美食、道頓堀夜生活 |

### 🚄 城市間移動

| 路段 | 交通方式 | 時間 | 費用（/人）|
|------|----------|------|-----------|
| 東京 → 京都 | 新幹線 Nozomi | 2h 20m | $120 |
| 京都 → 大阪 | JR 新快速 | 15 min | $5 |

這樣的安排你覺得 OK 嗎？確認後我逐城市規劃詳細行程。
```

---

## 邊界條件

| 情境 | 處理方式 |
|------|----------|
| 城市數超過 4 個 | ask_user 建議拆為兩次規劃 |
| 城市間有簽證問題 | 於 Turn 1 標注（呼叫 Phase 14 Context Agent） |
| 各城市天數加總與總天數不符 | ask_user 確認分配，或依比例自動調整 |
| 某城市 agent 失敗 | Graceful degradation，用 LLM 知識補充，標注「估算」 |
| 預算只指定總額 | 依城市天數比例分配，Turn 1 說明分配邏輯 |

---

## 受影響的檔案

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `docs/prompts/orchestrator.md` | 修改 | 新增多城市識別邏輯、並行 agent 呼叫策略、多城市輸出格式 |
| `src/agents/orchestratorExecutor.ts` | 修改 | 支援並行呼叫多城市 attractions agents |
| `src/services/budgetCalculator.ts` | 修改 | 新增 `inter_city_transport` 費用項目、多城市總計 |

---

## 驗證方式

1. 輸入：「幫我規劃東京 3 天、京都 2 天、大阪 2 天，共 7 天，2 人，預算 $3000」
2. Turn 1 確認：出現城市分配表格 + 城市間交通表格
3. Turn 2 確認：各城市各一個住宿比較表（分城市呈現）
4. Turn 3 確認：各城市交通 + 城市間交通 + 全程預算（含跨城市費用）
5. 輸入超過 4 城市，確認系統建議拆單次規劃
