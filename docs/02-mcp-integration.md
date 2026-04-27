# Phase 2：MCP 工具整合

> **目標**：讓每個 Sub-agent 成為真正的 MCP Client，呼叫真實外部 API，不靠 LLM 訓練知識產出資料  
> **完成標準**：Attractions Agent 能搜到真實景點資訊；Flight Agent 能從 Amadeus Sandbox 拿到航班資料；行程確認後能寫入 Google Calendar  
> **預估工時**：4–5 天

---

## 工具選型總表

| Agent | MCP Tool | 資料來源 | 費用 | API Key 取得 |
|-------|----------|---------|------|------------|
| Attractions | Tavily MCP | Tavily Search API | 免費 1,000 次/月，無需信用卡 | [app.tavily.com](https://app.tavily.com/) |
| Attractions | Fetch MCP | 直接爬取網頁 | 完全免費 | 無需 key |
| Flight | 自製 Amadeus MCP | Amadeus Sandbox | 完全免費（測試資料） | [developers.amadeus.com](https://developers.amadeus.com/) |
| Accommodation | Tavily MCP | Tavily Search API | 同上共用配額 | 同上 |
| Coordinator | Google Calendar MCP | Google Calendar API | 免費 | Google Cloud Console |

**總結**：整個系統只需要 3 個 API key，全部有免費 tier，Demo 零成本。費用一律以 USD 顯示，不做貨幣換算。

---

## 2.1 Amadeus Sandbox — Flight Agent 的核心工具

### 為什麼選 Amadeus Sandbox

| 比較項目 | Amadeus Sandbox | 其他選項 |
|---------|----------------|---------|
| 費用 | 完全免費 | Skyscanner API 已關閉公開申請；FlightAware 有費用 |
| 資料格式 | 業界標準 IATA 格式，結構完整 | 部分替代品格式不穩定 |
| 適合 Demo | ✅ 測試資料夠真實（有航班號、時刻、價格） | — |
| 申請難度 | 填表後立即拿到 key | — |

> **注意**：Sandbox 回傳的是測試資料，不是真實時刻表。面試時可以直接說：「目前用 Amadeus Sandbox，換成 Production key 就能接真實航班，這是刻意的設計——讓這個 repo 任何人都能免費跑。」

### Amadeus API 申請步驟

1. 前往 `https://developers.amadeus.com/register`
2. 填寫基本資料（不需要信用卡）
3. 建立新 App → 選 Self-Service
4. 取得 `AMADEUS_CLIENT_ID` + `AMADEUS_CLIENT_SECRET`
5. Sandbox 環境的 base URL：`https://test.api.amadeus.com`

### 使用的 Amadeus API 端點

```
POST /v1/security/oauth2/token
  → 取得 access token（每 30 分鐘更新一次）

GET /v2/shopping/flight-offers
  → 搜尋航班選項
  → 參數：originLocationCode, destinationLocationCode, departureDate, adults, max
  → 回傳：航班號、起降時間、價格、停靠資訊
```

### 自製 Amadeus MCP Server 設計

```typescript
// src/mcp-servers/amadeus/index.ts
// 這個 MCP Server 包裝 Amadeus API，讓 Flight Agent 透過 MCP 呼叫

const tools = [
  {
    name: "search_flights",
    description: "Search for available flights between two airports",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "IATA airport code, e.g. TPE" },
        destination: { type: "string", description: "IATA airport code, e.g. JFK" },
        departure_date: { type: "string", description: "YYYY-MM-DD format" },
        adults: { type: "number", description: "Number of adult passengers" },
        max_results: { type: "number", description: "Max number of results to return" }
      },
      required: ["origin", "destination", "departure_date"]
    }
  },
  {
    name: "get_airport_code",
    description: "Look up IATA airport code for a city name",
    inputSchema: {
      type: "object",
      properties: {
        city_name: { type: "string", description: "City name in English" }
      },
      required: ["city_name"]
    }
  }
]
```

### Flight Agent 的 LLM → MCP 呼叫流程

```
Flight Agent 收到任務：
  {
    "origin_city": "台北",
    "destination_city": "紐約",
    "departure_date": "2026-06-15",
    "return_date": "2026-06-20",
    "adults": 1,
    "budget_limit": 35000  // NTD
  }

Step 1: LLM 決定先呼叫 get_airport_code
  → "台北" → "TPE"
  → "紐約" → "JFK"

Step 2: LLM 呼叫 search_flights
  → origin: TPE, destination: JFK
  → departure_date: 2026-06-15
  → max_results: 5

Step 3: LLM 整理 Amadeus 回傳結果，格式化為標準輸出
  → 篩選符合預算的選項
  → 回傳結構化 FlightResult
```

### Amadeus 回傳資料範例（Sandbox）

```json
{
  "data": [{
    "itineraries": [{
      "duration": "PT18H30M",
      "segments": [{
        "departure": { "iataCode": "TPE", "at": "2026-06-15T10:30:00" },
        "arrival": { "iataCode": "JFK", "at": "2026-06-16T13:00:00" },
        "carrierCode": "CI",
        "number": "003",
        "numberOfStops": 1
      }]
    }],
    "price": {
      "currency": "USD",
      "total": "850.00",
      "grandTotal": "850.00"
    }
  }]
}
```

---

## 2.2 Tavily MCP — Attractions & Accommodation Agent

### 為什麼選 Tavily

Tavily 是專門為 AI Agent 設計的搜尋 API，回傳的是已經整理好的摘要文字，不是原始 HTML——這讓 LLM 不需要額外處理網頁內容，直接拿來用。免費 1,000 次/月，無需信用卡。

### 安裝與設定

```bash
# 官方已有 MCP server，直接用
npx -y @tavily-ai/tavily-mcp
```

```typescript
// Sub-agent 內部初始化 MCP Client
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const mcpClient = new Client({ name: "attractions-agent", version: "1.0.0" });
await mcpClient.connect(new StdioClientTransport({
  command: "npx",
  args: ["-y", "@tavily-ai/tavily-mcp"],
  env: { TAVILY_API_KEY: process.env.TAVILY_API_KEY! }
}));
```

### Attractions Agent 的搜尋策略

```typescript
// Step 1：搜尋景點
const attractionsResult = await mcpClient.callTool({
  name: "tavily_search",
  arguments: {
    query: `${destination} top attractions must-see spots`,
    max_results: 10
  }
});

// Step 2：搜尋每個景點的詳細資訊（用 Fetch MCP）
const detailResult = await fetchMcpClient.callTool({
  name: "fetch",
  arguments: { url: attractionUrl }
});

// Step 3：LLM 整理成結構化輸出（含地理位置、開放時間、費用）
```

### Accommodation Agent 的搜尋策略（依賴景點位置）

```typescript
// 從 Coordinator 傳入的 context 取得景點中心位置
const attractionCenterArea = context.attractions_center_area; // e.g., "Midtown Manhattan"

// 以景點位置為基準搜尋住宿
const hotelResult = await mcpClient.callTool({
  name: "tavily_search",
  arguments: {
    query: `hotels near ${attractionCenterArea} ${destination} budget under $${dailyBudget}`,
    max_results: 8
  }
});
```

> **這是面試亮點**：Accommodation Agent 不是獨立搜尋住宿，而是把「景點中心位置」當成搜尋條件，這是 Coordinator 依賴排序的具體展現。

---

## 2.3 Google Calendar MCP — 最終執行動作

### 為什麼 Calendar 由 Coordinator 直接呼叫（不透過 Sub-agent）

Calendar 是最終的**執行動作**，不是「查詢」。它代表：
- 使用者已確認整個行程
- 這是跨所有 Agent 輸出的整合結果
- 只有 Coordinator 有完整的行程資訊（航班 + 景點 + 住宿）

讓任何一個 Sub-agent 做這件事在邏輯上是錯的，這個設計本身就是一個可以在面試說的「設計決策」。

### 使用現成的 Google Calendar MCP

```bash
# Anthropic 官方 MCP servers 裡有 Google Calendar
npx @anthropic-ai/mcp-server-google-calendar
```

需要的設定：
1. Google Cloud Console 建立 OAuth 2.0 credentials
2. 啟用 Google Calendar API
3. 授權後取得 `credentials.json`

### Calendar 寫入規格

```typescript
// Coordinator 在使用者確認後呼叫
await calendarMcpClient.callTool({
  name: "create_event",
  arguments: {
    summary: "NYC Trip 🗽",
    start: { date: "2026-06-15" },  // 全天事件
    end: { date: "2026-06-20" },
    description: [
      "=== 航班資訊 ===",
      `去程：CI003 TPE→JFK，6/15 10:30 起飛`,
      `回程：CI004 JFK→TPE，6/20 14:00 起飛`,
      "",
      "=== 每日行程 ===",
      `Day 1 (6/15)：抵達，check-in，附近晚餐`,
      `Day 2 (6/16)：大都會博物館、中央公園`,
      // ...
    ].join("\n")
  }
});
```

---

## 2.4 環境變數總整理

```bash
# .env.example（完整版）

# LLM
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_anthropic_key_here

# 外部工具 API Keys
TAVILY_API_KEY=your_tavily_key             # 免費申請（無需信用卡）：app.tavily.com
AMADEUS_CLIENT_ID=your_amadeus_client_id   # 免費申請：developers.amadeus.com
AMADEUS_CLIENT_SECRET=your_amadeus_secret  # 同上
# Google Calendar（需要 OAuth flow，見 docs/setup-google-calendar.md）
GOOGLE_CALENDAR_CREDENTIALS_PATH=./credentials.json

# Agent Ports
COORDINATOR_PORT=3000
ATTRACTIONS_PORT=3001
FLIGHT_PORT=3002
ACCOMMODATION_PORT=3003

# A2A Mode（a2a = 真實 A2A Protocol；api = 直接呼叫，開發用）
ATTRACTIONS_MODE=a2a
FLIGHT_MODE=a2a
ACCOMMODATION_MODE=a2a
```

---

## 2.5 Phase 2 驗收標準

- [ ] Attractions Agent 呼叫 Brave Search，能回傳真實景點名稱（不是 LLM 幻想）
- [ ] Flight Agent 呼叫 Amadeus Sandbox，能回傳結構化航班資料（含起降時間、價格）
- [ ] Accommodation Agent 用景點位置當搜尋條件（可在 log 中驗證 query 包含景點名稱）
- [ ] Google Calendar 能寫入包含航班 + 每日行程的事件
- [ ] 所有 MCP 呼叫都有 log（`[MCP] tool=brave_web_search query="..."` 格式）

---

## 補充：面試時如何說 Amadeus Sandbox

> 「航班資料我用 Amadeus Sandbox——這是 Amadeus（全球最大旅遊技術公司之一）提供的免費測試環境，格式跟 Production 完全一樣，差別只是資料是測試資料。這個設計讓任何人都能免費 clone 這個 repo 跑起來，不需要付費訂閱。如果要接真實航班，只要換一個 Production key，程式碼不用改。這是我有意識的設計選擇——降低 onboarding 門檻。」
