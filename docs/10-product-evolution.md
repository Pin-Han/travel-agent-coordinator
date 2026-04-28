# 旅遊客服產品演化路線圖

## 設計哲學：Harness Engineering

參照 Claude Code 的 Harness 架構，旅遊客服系統的品質提升不是靠「換更好的 LLM」，而是靠**建立更好的執行環境**。

```
Guides（事前引導）→ Agent 執行 → Sensors（事後驗證）→ 通過 or 重試
```

### 目前系統的 Harness 現況

```
Guides（已有）                    Sensors（已有）
──────────────                    ────────────────
✅ docs/prompts/*.md              ✅ Evaluator Agent（Phase 7）LLM 打分
✅ Agent Card（capability 宣告）   ⚠️  extractAttractionArea()（regex，脆弱）
✅ CLAUDE.md（開發規範）           ❌  Schema 驗證（無）
✅ Retry with backoff             ❌  地理合理性 hard check（無）
✅ Graceful degradation           ❌  預算符合度 hard check（無）
```

**核心缺口**：目前所有 Sensor 都是「軟性」的（LLM 評分），沒有任何「硬性」的結構驗證。
Agent 輸出的是自由文字 markdown，下一個 agent 靠 LLM 理解，整條鏈的脆弱點集中在這裡。

---

## Phase 10：結構化輸出（所有後續功能的基礎）

> **一句話**：Agent 改為輸出結構化 JSON，加入 Schema Sensor 驗證，讓資料流變得可靠。

### 為什麼先做這個

地圖視覺化、匯出、預算計算、多輪精煉，全部都需要結構化資料。現在做，後面全部受益。

### Harness 視角

```
Guides 新增：
  - 每個 agent 的 prompt 加入 JSON schema 輸出要求
  - coordinator prompt 描述如何處理結構化 agent 結果

Sensors 新增：
  - SchemaValidator（新）：驗證 agent 回傳 JSON 符合預定 schema
  - 驗證失敗 → 重試一次（加入「你的上次輸出缺少 X 欄位」feedback）
  - 驗證仍失敗 → graceful degradation（用自由文字繼續，log warning）
```

### 輸出 Schema 設計

**Attractions Agent 輸出：**
```json
{
  "area_summary": "Asakusa, Shinjuku, Shibuya districts",
  "attractions": [
    {
      "name": "Senso-ji Temple",
      "area": "Asakusa",
      "category": "temple",
      "recommended_duration_hours": 2,
      "estimated_cost_usd": 0,
      "best_time": "early morning",
      "notes": "Arrive before 9am to avoid crowds"
    }
  ],
  "suggested_day_groupings": [
    { "day": 1, "area": "Asakusa", "attraction_names": ["Senso-ji Temple", "Nakamise Shopping Street"] }
  ]
}
```

**Accommodation Agent 輸出：**
```json
{
  "area_summary": "Shinjuku area, near transportation hub",
  "recommendations": [
    {
      "name": "Shinjuku Granbell Hotel",
      "area": "Shinjuku",
      "price_range_usd_per_night": { "min": 80, "max": 130 },
      "distance_to_attractions": "10 min walk to Shinjuku Gyoen",
      "booking_tip": "Book 2+ weeks ahead for better rates"
    }
  ]
}
```

**Transportation Agent 輸出：**
```json
{
  "primary_transit": "Tokyo Metro + JR Lines",
  "recommended_pass": { "name": "IC Card (Suica)", "cost_usd": 15, "notes": "Covers all subways and convenience stores" },
  "key_routes": [
    { "from": "Asakusa", "to": "Shinjuku", "method": "Tokyo Metro Ginza Line", "duration_min": 30, "cost_usd": 2.5 }
  ],
  "airport_transfer": { "method": "Narita Express (N'EX)", "cost_usd": 30, "duration_min": 60 }
}
```

### 受影響的檔案

| 檔案 | 變更 |
|------|------|
| `docs/prompts/attractions.md` | 加入 JSON schema 輸出要求 |
| `docs/prompts/accommodation.md` | 加入 JSON schema 輸出要求 |
| `docs/prompts/transportation.md` | 加入 JSON schema 輸出要求 |
| `src/services/schemaValidator.ts` | 新建：validate + retry logic |
| `src/services/agentRegistry.ts` | agent 呼叫後加 schema validation |
| `src/agents/coordinatorExecutor.ts` | coordinator 整合時使用結構化資料 |
| `docs/prompts/coordinator.md` | 描述如何用結構化輸出合成最終規劃 |

---

## Phase 11：地圖視覺化 + 行程匯出

> **一句話**：結構化輸出到位後，把行程畫在地圖上、匯出成可用的格式。

### Harness 視角

```
Guides：
  - coordinator prompt 加入「輸出包含 map_data 區塊」要求

Sensors：
  - 地理座標驗證（有 lat/lng 才顯示地圖，否則 fallback 純文字）
  - 匯出前驗證資料完整性
```

### 功能設計

**互動地圖（右側 Panel）**

```
┌─────────────────┬─────────────────────┐
│  Chat           │  🗺️ Map             │
│                 │                     │
│  AI: 這是你的   │  [Google Maps]      │
│  東京行程...    │  📍 Senso-ji        │
│                 │  📍 Shinjuku        │
│                 │  🏨 Hotel           │
│                 │                     │
│                 │  Day 1 ──▶ Day 2    │
└─────────────────┴─────────────────────┘
```

- 使用 Google Maps Embed API 或 Mapbox（免費額度夠 demo 用）
- 景點用 📍、住宿用 🏨、交通路線用虛線連接
- 點擊標記顯示 popup（名稱、費用、備註）

**匯出格式**

| 格式 | 用途 | 實作方式 |
|------|------|----------|
| `.ics` | 加入 Google Calendar / Apple Calendar | 純文字格式，手動生成 |
| PDF | 列印 / 傳給朋友 | `jsPDF` 或後端 Puppeteer |
| JSON | 開發者用 / 未來匯入 | 直接下載結構化資料 |

### 受影響的檔案

| 檔案 | 變更 |
|------|------|
| `web/src/pages/ChatPage.tsx` | 右側 MapPanel，根據 artifact 有無 map_data 顯示 |
| `web/src/components/MapPanel.tsx` | 新建：Google Maps Embed 元件 |
| `web/src/components/ExportMenu.tsx` | 新建：.ics / PDF / JSON 下載按鈕 |
| `docs/prompts/coordinator.md` | 要求合成時輸出 map_data 區塊 |

---

## Phase 12：多輪精煉（Plan Refinement）

> **一句話**：用戶拿到規劃後，能說「太貴了」「第二天行程太緊」，系統做局部修改而非整體重生成。

### 為什麼這是最重要的產品功能

真實旅遊規劃從來不是「一次生成就滿意」。用戶需要反覆調整。目前每次新訊息都觸發完整的三 agent 流程，成本高、速度慢，且把用戶好不容易確定的部分也全部推翻。

### Harness 視角

```
Guides 新增：
  - coordinator prompt 加入「識別修改意圖 vs 新規劃意圖」的判斷邏輯
  - 修改意圖時：只呼叫受影響的 agent，傳入現有規劃作為 context

Sensors 新增：
  - Plan State Validator：修改後驗證整體規劃的一致性（天數對不對、景點還在不在對的天）
```

### Plan State 設計

```typescript
interface PlanState {
  destination: string;
  duration_days: number;
  travelers: number;
  budget_usd?: number;
  days: Array<{
    day: number;
    theme: string;
    attractions: AttractionItem[];
    accommodation: AccommodationItem;
    transportation_notes: string;
  }>;
  total_estimated_cost?: { min: number; max: number };
  generated_at: string;
  version: number;   // 每次修改 +1
}
```

### 對話流程

```
用戶：「太貴了，把住宿換成預算選項」
    ↓
Coordinator 識別：modification intent（不是新規劃）
    ↓
只呼叫 Accommodation Agent，傳入：
  - 現有 PlanState
  - 修改指令：「budget accommodation, under $60/night」
    ↓
Accommodation Agent 回傳新的住宿選項
    ↓
Coordinator 更新 PlanState（只換住宿欄位）
    ↓
回覆：「已將住宿更換為預算選項，每晚約 $50-$65。其他安排不變。」
    ↓
Plan State version: 2，地圖標記更新
```

### 修改意圖分類

| 修改類型 | 觸發的 agent |
|----------|-------------|
| 「換住宿」「太貴了」 | Accommodation only |
| 「加一個景點」「移除 X」 | Attractions only |
| 「交通怎麼安排」 | Transportation only |
| 「縮短到 3 天」「增加人數」 | 全部重新規劃 |
| 「整個重來」 | 清除 PlanState，全部重新規劃 |

### 受影響的檔案

| 檔案 | 變更 |
|------|------|
| `src/services/planStateService.ts` | 新建：PlanState 的 CRUD，存 per-context |
| `src/agents/coordinatorExecutor.ts` | 規劃前讀 PlanState；識別修改 vs 新規劃意圖；修改後更新 State |
| `docs/prompts/coordinator.md` | 加入修改意圖識別邏輯、局部更新工作流程 |
| `web/src/pages/ChatPage.tsx` | 每次收到 artifact 更新 plan state，地圖同步更新 |

---

## Phase 13：預算計算（數字感）

> **一句話**：讓規劃有具體數字，而不是「符合中等預算」這種空話。

### 設計

在 coordinator 整合完三個 agent 結果後，新增一個 `calculateBudget()` 步驟：

```
三個 agent 結果（結構化）
    ↓
calculateBudget()（LLM call，帶結構化資料）
    ↓
輸出：
  景點門票：$45-$60
  住宿 4 晚：$280-$480
  餐飲（每日 $30）：$120
  市區交通：$30
  ─────────────────
  預估總費用：$475 - $690
  （不含機票）
```

### Harness Sensor

- 預算符合度 hard check：計算結果是否超出用戶指定預算
- 超出 → 自動在回覆加入「⚠️ 以下建議超出您的 $500 預算，可考慮更換為...」

---

## Phase 14：情境感知（讓規劃更貼近現實）

> **一句話**：加入時間、天氣、假日、簽證等真實情境資訊。

### 資訊來源

| 情境 | 資料來源 | 實作難度 |
|------|----------|----------|
| 當地天氣 | OpenWeatherMap API（免費） | 低 |
| 當地國定假日 | Nager.Date API（免費） | 低 |
| 台灣護照簽證資訊 | Tavily 搜尋（無官方 API） | 中 |
| 旅遊安全警示 | 外交部 API 或 Tavily | 中 |
| 當季特色活動 | Tavily 搜尋 | 低 |

### 實作方式

新增 `ContextAgent`，在三個主要 agent 呼叫前先執行：

```
ContextAgent（快速，parallel 執行，不阻擋主流程）
  ├── 天氣查詢（出發日期 + 目的地）
  ├── 假日查詢（旅遊期間有沒有重要節日）
  └── 安全警示（目的地有沒有旅遊警示）
      ↓
結果附加到 coordinator context
      ↓
Attractions / Accommodation / Transportation 看到這些 context
```

---

## 整體 Harness 演化圖

```
Phase 10 後的系統狀態：

Guides                           Sensors
──────────────────               ──────────────────────────────
✅ docs/prompts/*.md             ✅ Evaluator（LLM 打分）
✅ Agent Card                    ✅ SchemaValidator（JSON hard check）
✅ CLAUDE.md                     ✅ BudgetValidator（Phase 13）
✅ JSON Schema 定義              ✅ GeoSanityCheck（Phase 11）
✅ 修改意圖分類規則（Phase 12）   ✅ PlanConsistencyCheck（Phase 12）

                    ↓
Agent 執行環境越來越可靠，不再靠 LLM 運氣
```

---

## 實作優先序

| Phase | 核心價值 | 先決條件 | 建議時機 |
|-------|----------|----------|----------|
| **10** 結構化輸出 | 所有後續功能的基礎 | 無 | 立刻 |
| **11** 地圖 + 匯出 | 展示效果最強 | Phase 10 | 接著做 |
| **12** 多輪精煉 | 最重要的產品功能 | Phase 10 | 核心迭代 |
| **13** 預算計算 | 信任感（有數字） | Phase 10 | Phase 12 後 |
| **14** 情境感知 | 真實感（天氣假日） | 無 | 最後 |
