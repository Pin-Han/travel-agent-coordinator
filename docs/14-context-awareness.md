# Phase 14：情境感知

## Context

目前的規劃忽略了幾個讓旅遊計畫「貼近現實」的關鍵資訊：八月去日本要考慮颱風季、旅遊期間遇到當地國定假日景點可能關門、特定目的地需要提前辦簽證。

Phase 14 新增一個 **Context Agent**，在主要的三個 agent 呼叫前 parallel 執行，把這些情境資訊注入規劃。

**先決條件**：Phase 10（結構化輸出）。Phase 12（多輪精煉）完成後效果更好（情境更新後可局部修改行程）。

---

## 架構

### Context Agent 的位置

```
Coordinator Agentic Loop
    ↓ （收到完整旅遊資訊後）
ContextAgent.gather()   ← Phase 14 新增，parallel 執行，不阻擋
    ↓
context 注入 coordinator system prompt 或 agent 的 request
    ↓
Attractions / Accommodation / Transportation 帶著情境資訊規劃
```

Context Agent **不是新的 A2A server process**，而是 coordinator 內的一個獨立 async function，parallel 執行：

```typescript
// 在呼叫主要三個 agent 前
const [contextData, _] = await Promise.allSettled([
  this.contextAgent.gather(destination, travelDates, travelers),
  // 可以同時啟動其他準備工作
]);
```

### 為什麼 parallel 而非阻擋

Context Agent 呼叫的是外部 API（天氣、假日），與三個主要 agent 的 LLM 呼叫不依賴。Parallel 執行可以讓整體耗時不增加太多（Context Agent 通常比 LLM 呼叫快）。

---

## 情境資料來源

| 情境類型 | 資料來源 | API 文件 | 費用 |
|----------|----------|----------|------|
| 天氣預報 | Open-Meteo API | open-meteo.com/en/docs | 完全免費，無 API key |
| 當地國定假日 | Nager.Date API | date.nager.at | 完全免費，無 API key |
| 台灣簽證資訊 | Tavily 搜尋 | — | 使用現有 TAVILY_API_KEY |
| 旅遊安全警示 | 台灣外交部旅遊警示 | boca.gov.tw | Tavily 搜尋 |
| 當季特色活動 | Tavily 搜尋 | — | 使用現有 TAVILY_API_KEY |

**設計原則**：優先使用免費、無 API key 的來源（Open-Meteo、Nager.Date），降低新用戶的設定門檻。

---

## ContextAgent 設計

```typescript
// src/services/contextAgent.ts

interface ContextData {
  weather?: WeatherContext;
  holidays?: HolidayContext;
  visa?: VisaContext;
  safety?: SafetyContext;
  seasonal_events?: SeasonalEventContext;
  warnings: string[];    // 需要特別提示用戶的事項
}

interface WeatherContext {
  summary: string;              // "April is cherry blossom season, mild 12-18°C"
  precautions: string[];        // ["Pack a light jacket", "Rain possible mid-April"]
  best_months_comparison?: string;  // "You're visiting in peak season"
}

interface HolidayContext {
  holidays_during_trip: Array<{
    date: string;
    name: string;
    impact: string;     // "Most temples open, department stores may close"
  }>;
  golden_week_warning?: boolean;   // 日本黃金週特別提示
}

interface VisaContext {
  passport: "Taiwan (ROC)";   // 目前只支援台灣護照
  requirement: "visa-free" | "e-visa" | "visa-required" | "unknown";
  duration_days?: number;     // 免簽天數
  notes: string;
}

interface SafetyContext {
  level: 1 | 2 | 3 | 4;       // 台灣外交部警示等級
  level_text: "正常" | "提高警覺" | "避免非必要旅遊" | "不宜前往";
  notes?: string;
}

class ContextAgent {
  async gather(
    destination: string,
    travelDates: { start?: string; end?: string; duration_days: number },
    travelers: number
  ): Promise<ContextData>
}
```

### gather() 內部流程

```typescript
async gather(destination, travelDates, travelers): Promise<ContextData> {
  const countryCode = await this.resolveCountryCode(destination);   // e.g. "JP" for Tokyo

  // 並行取得所有情境資料
  const [weather, holidays, visa, safety, events] = await Promise.allSettled([
    this.fetchWeather(destination, travelDates),
    this.fetchHolidays(countryCode, travelDates),
    this.fetchVisaInfo(destination, countryCode),
    this.fetchSafetyAlert(destination),
    this.fetchSeasonalEvents(destination, travelDates),
  ]);

  const warnings: string[] = [];

  // 警示條件檢查
  if (safety.status === "fulfilled" && safety.value.level >= 3) {
    warnings.push(`⚠️ 台灣外交部對 ${destination} 發布「${safety.value.level_text}」旅遊警示`);
  }
  if (holidays.status === "fulfilled" && holidays.value.golden_week_warning) {
    warnings.push("⚠️ 旅遊期間為日本黃金週，飯店和景點可能需要提前數月預訂");
  }

  return {
    weather: weather.status === "fulfilled" ? weather.value : undefined,
    holidays: holidays.status === "fulfilled" ? holidays.value : undefined,
    visa: visa.status === "fulfilled" ? visa.value : undefined,
    safety: safety.status === "fulfilled" ? safety.value : undefined,
    seasonal_events: events.status === "fulfilled" ? events.value : undefined,
    warnings,
  };
}
```

---

## 各資料來源實作細節

### 天氣：Open-Meteo API

```typescript
// 免費，無 API key，直接呼叫
async fetchWeather(destination: string, dates: TravelDates): Promise<WeatherContext> {
  const { lat, lng } = await this.geocode(destination);  // 用 Nominatim（OpenStreetMap，免費）

  // 取旅遊期間的每日預報
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${dates.start}&end_date=${dates.end}`;

  const res = await fetch(url);
  const data = await res.json();

  // 用 LLM 將數字轉為自然語言描述
  return this.summarizeWeather(data, destination);
}
```

**若旅行日期未知**：改為查詢「月份氣候特色」（用 LLM 知識描述，不呼叫 API）。

### 假日：Nager.Date API

```typescript
async fetchHolidays(countryCode: string, dates: TravelDates): Promise<HolidayContext> {
  const year = new Date(dates.start ?? Date.now()).getFullYear();
  const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`;

  const holidays = await fetch(url).then(r => r.json());

  // 篩選旅遊期間內的假日
  const relevantHolidays = holidays.filter(h =>
    h.date >= dates.start && h.date <= dates.end
  );

  // 日本黃金週特殊處理
  const goldenWeekDates = ["04-29", "05-03", "05-04", "05-05"];
  const isGoldenWeek = relevantHolidays.some(h =>
    goldenWeekDates.some(d => h.date.endsWith(d))
  );

  return {
    holidays_during_trip: relevantHolidays.map(h => ({
      date: h.date,
      name: h.localName,
      impact: this.assessHolidayImpact(h, countryCode),
    })),
    golden_week_warning: isGoldenWeek,
  };
}
```

**支援的國家代碼**（初期）：JP、KR、FR、GB、DE、IT、US、TH、SG、TW

### 簽證：Tavily 搜尋

```typescript
async fetchVisaInfo(destination: string, countryCode: string): Promise<VisaContext> {
  // 使用現有 Tavily MCP
  const result = await TavilyMCPClient.getInstance().search(
    `Taiwan ROC passport visa requirement ${destination} ${new Date().getFullYear()}`
  );

  // 用 LLM 從搜尋結果萃取結構化資訊
  const llmResult = await createLLMClient().complete([{
    role: "user",
    content: `Extract visa information for Taiwan passport holders visiting ${destination}. Search results: ${result}\n\nOutput JSON: {"requirement": "visa-free|e-visa|visa-required|unknown", "duration_days": number|null, "notes": "string"}`,
  }], { maxTokens: 200 });

  return JSON.parse(llmResult.content);
}
```

**免簽資訊快取**：台灣護照免簽國家不常變動，可以 in-memory 快取 24 小時，避免重複搜尋。

### 旅遊安全：外交部 Tavily 搜尋

```typescript
async fetchSafetyAlert(destination: string): Promise<SafetyContext> {
  const result = await TavilyMCPClient.getInstance().search(
    `台灣外交部旅遊警示 ${destination} site:boca.gov.tw`
  );
  // LLM 萃取警示等級
  // ...
}
```

---

## 情境資訊如何注入規劃

Context Agent 的輸出以兩種方式使用：

### 1. 注入 Coordinator system prompt

```typescript
const contextSummary = formatContextForPrompt(contextData);
// e.g.:
// "Travel context: Visiting Tokyo in late March. Weather: Cherry blossom peak (18-22°C),
//  light rain expected. Holidays: None during trip dates. Visa: Visa-free 90 days (Taiwan passport).
//  Safety: Level 1 (Normal). Note: Spring is peak tourist season, book attractions in advance."

const systemPrompt = `${baseSystemPrompt}\n\n## Current Travel Context\n${contextSummary}`;
```

### 2. 高優先級警示直接插入規劃開頭

`warnings` 陣列非空時（安全等級 ≥ 3、黃金週等），在最終規劃最上方顯示：

```markdown
⚠️ **旅遊注意事項**
- 旅遊期間為日本黃金週（4/29-5/5），飯店請提前 2-3 個月預訂
- 預測有零星降雨，建議攜帶雨具

---
## 你的東京 4 天行程
...
```

---

## 受影響的檔案

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `src/services/contextAgent.ts` | 新建 | `ContextAgent` class，所有外部 API 呼叫 |
| `src/agents/coordinatorExecutor.ts` | 修改 | `processCoordination()` 加入 `contextAgent.gather()` parallel 呼叫；context 注入 system prompt |
| `docs/prompts/coordinator.md` | 修改 | 加入「如何使用 Travel Context 區塊」說明 |
| `.env.example` | 不需改動 | 所有情境 API 使用現有 `TAVILY_API_KEY` 或免費無 key API |

---

## Harness 視角

**新增 Sensor**：
- **SafetyLevelBlocker**：安全等級 4（不宜前往）→ 規劃開頭插入強烈警示，並詢問「確定要繼續嗎？」（不阻擋規劃，但明確提醒）
- **SeasonalityChecker**：偵測黃金週、齋戒月（東南亞）、颱風季等特殊時期 → 自動加入 warnings

**這些是明確的業務規則，不需要 LLM 判斷，直接 hard-code：**

```typescript
// 業務規則 sensor，不走 LLM
if (contextData.safety?.level === 4) {
  warnings.push("⛔ 外交部建議不宜前往，請重新考慮目的地");
}

if (isGoldenWeekJapan(destination, travelDates)) {
  warnings.push("⚠️ 黃金週期間飯店住宿費用通常為平日 2-3 倍");
}
```

---

## 實作順序

| 步驟 | 內容 |
|------|------|
| 1 | `contextAgent.ts` — `fetchHolidays()`（Nager.Date，最簡單）|
| 2 | `contextAgent.ts` — `fetchWeather()`（Open-Meteo + Nominatim geocoding）|
| 3 | `contextAgent.ts` — `fetchVisaInfo()`（Tavily 搜尋 + LLM 萃取）|
| 4 | `contextAgent.ts` — `fetchSafetyAlert()`（Tavily 搜尋）|
| 5 | `contextAgent.ts` — `gather()` 整合，parallel Promise.allSettled |
| 6 | `coordinatorExecutor.ts` — 注入 system prompt |
| 7 | `coordinator.md` — 更新 prompt |
| 8 | 端到端測試（見下）|

---

## 驗證方式

1. **日本春天**：指定東京 3 月底行程 → 回覆包含賞櫻資訊、春季天氣、免簽 90 天
2. **黃金週**：指定日本 5/1-5/5 → warnings 顯示黃金週警示，住宿建議提前預訂
3. **國定假日**：指定法國 7/14（巴士底日）→ 警示部分景點關閉
4. **高風險目的地**：指定安全等級 3-4 的地區 → 強烈警示顯示在規劃最上方
5. **無出發日期**：不提供日期時 → 不呼叫 Open-Meteo，改用 LLM 描述月份氣候特色
6. **API 失敗**：斷網或 API 出錯 → `Promise.allSettled` 確保其他情境資料正常，失敗項目靜默略過

---

## 邊界條件

| 情境 | 處理方式 |
|------|----------|
| 目的地無法解析為國家代碼 | 跳過假日查詢，只用 LLM 知識提供情境 |
| Open-Meteo 超出查詢日期範圍（超過 16 天預報）| 改為月份氣候描述 |
| Nager.Date 不支援的國家 | 靜默略過，無假日資訊 |
| Context Agent 整體超時（> 8 秒）| abort all，不注入情境，主流程正常繼續 |
| 簽證資訊不確定 | 標注「建議至外交部官網確認最新規定」|
| 安全等級 API 失敗 | 靜默略過，不顯示安全資訊 |
