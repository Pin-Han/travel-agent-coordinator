# Phase 18：旅途中即時輔助

## Context

目前系統專注在「出發前規劃」。Phase 18 新增旅途中即時輔助模式：用戶可在旅行當下詢問附近景點、今天天氣、某個地方怎麼去，系統切換為輕量即時查詢，不重新產生完整行程。

**先決條件**：Phase 14（情境感知）、Phase 15（三輪對話流程）。

---

## 功能範圍

- 自動偵測「即時模式」觸發詞（例如「我現在在...」「附近」「怎麼去」「今天」）
- 即時模式不呼叫完整的三輪流程，改為輕量單次查詢
- 可查詢：附近景點、交通路線、天氣、餐廳推薦、緊急資訊（醫院、警察）
- 回覆簡短（3–5 行），不產生完整行程

---

## 即時模式 vs 規劃模式

| 維度 | 規劃模式 | 即時模式 |
|------|----------|----------|
| 觸發條件 | 「幫我規劃...」「推薦...旅遊」 | 「我現在在...」「附近」「怎麼去」 |
| 流程 | 三輪對話，呼叫 3 個 agents | 單輪，只呼叫必要 agent |
| 回覆長度 | 完整行程（長） | 簡短直接（3–5 行）|
| 資料來源 | Tavily 搜尋 + LLM | 優先 Tavily 即時搜尋 |
| 記憶儲存 | 呼叫 extractAndSaveMemory | 不儲存（即時查詢不影響偏好記憶）|

---

## 技術設計

### 即時模式偵測（orchestrator prompt）

```
在判斷階段前，先檢查是否為即時查詢：

即時查詢觸發詞（符合任一即進入即時模式）：
- 「我現在在 [地點]」「我在 [地點]」
- 「附近」「nearby」「near me」「around here」
- 「怎麼去 [目的地]」「how to get to」
- 「今天天氣」「today's weather」
- 「緊急」「emergency」「醫院」「hospital」

進入即時模式後：
1. 識別查詢類型（導航 / 景點 / 天氣 / 餐廳 / 緊急）
2. 呼叫對應的 agent 或 Tavily 直接查詢
3. 以簡短格式回覆（見下方格式）
4. 不呼叫 ask_user 確認流程
```

### 即時查詢類型與對應處理

| 查詢類型 | 處理方式 | 回覆範例 |
|----------|----------|----------|
| 導航 | call_agent("transportation") | 「搭捷運板南線，約 12 分，$0.8」 |
| 附近景點 | call_agent("attractions") | 「附近 500m：龍山寺（免費）、剝皮寮歷史街區（免費）」 |
| 天氣 | Context Agent fetchWeather() | 「今天台北 28°C，下午有陣雨，建議帶傘」 |
| 餐廳 | Tavily 直接搜尋 | 「附近推薦：阿宗麵線（評分 4.6）、鼎泰豐信義店（步行 5 分）」 |
| 緊急 | 硬編碼 + Tavily | 「台灣急救：119 \| 警察：110 \| 最近醫院：台大醫院（MRT 台大醫院站）」 |

### 新增 `src/services/realtimeQueryService.ts`

```typescript
export type RealtimeQueryType =
  | "navigation"
  | "nearby_attractions"
  | "weather"
  | "restaurant"
  | "emergency";

export interface RealtimeQuery {
  type: RealtimeQueryType;
  location?: string;
  destination?: string;
  rawText: string;
}

export function detectRealtimeQuery(userText: string): RealtimeQuery | null {
  // 偵測即時查詢觸發詞，回傳 RealtimeQuery 或 null（規劃模式）
}

export async function handleRealtimeQuery(
  query: RealtimeQuery,
  provider?: LLMProvider
): Promise<string> {
  // 根據類型呼叫對應 agent / Tavily / 硬編碼資料
  // 回傳簡短 Markdown 字串
}
```

---

## 即時模式輸出格式

```markdown
📍 **[查詢主題]**

[直接回答，2–4 行]

> 資料來源：即時搜尋 · [時間戳]
```

範例（導航）：
```markdown
📍 **從現在位置到龍山寺**

搭捷運板南線往南港方向，龍山寺站下車（出口 1），步行 3 分鐘。
票價：NT$25（約 $0.8）· 車程：約 12 分鐘

> 資料來源：即時搜尋 · 14:32
```

---

## 邊界條件

| 情境 | 處理方式 |
|------|----------|
| 用戶在即時模式突然說「重新規劃行程」 | 切換回規劃模式，重新走三輪流程 |
| Tavily 無即時結果 | fallback 到 LLM 知識，標注「估算，建議現場確認」 |
| 緊急查詢（emergency） | 優先回覆硬編碼緊急電話，再附 Tavily 結果 |
| 無法判斷是即時還是規劃 | 預設為規劃模式（安全降級）|

---

## 受影響的檔案

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `docs/prompts/orchestrator.md` | 修改 | 新增即時模式偵測邏輯與簡短回覆格式說明 |
| `src/services/realtimeQueryService.ts` | 新建 | 即時查詢類型偵測 + 分類處理 |
| `src/agents/orchestratorExecutor.ts` | 修改 | `processCoordination()` 前先呼叫 `detectRealtimeQuery()`，命中即走即時流程 |

---

## 驗證方式

1. 輸入：「我現在在龍山寺，附近有什麼好玩的？」→ 確認回覆簡短（不走三輪流程）
2. 輸入：「從萬華怎麼去台北 101？」→ 確認回覆為導航資訊
3. 輸入：「台北今天天氣怎樣？」→ 確認回覆為天氣資訊
4. 輸入：「緊急，我需要醫院」→ 確認優先回傳緊急電話
5. 即時模式結束後輸入「幫我重新規劃行程」→ 確認切換回規劃模式
