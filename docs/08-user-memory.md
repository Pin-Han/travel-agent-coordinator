# Phase 8: User Memory Agent

## Context

Phase 7 讓系統「輸出更好的規劃」，Phase 8 讓系統「越用越了解你」。

目前每次對話都從零開始——系統不記得你不喜歡人多、不記得你去過東京、不記得你的預算習慣。User Memory Agent 解決這個問題：把每次規劃的關鍵偏好記錄下來，下次對話自動帶入。

這是讓系統從「工具」演化為「私人旅遊顧問」的關鍵一步。

---

## 架構

### Memory Agent 的角色

Memory Agent 不是一個獨立的 LLM server，而是 Coordinator 工具箱裡的兩個 tool：

```
Coordinator Agentic Loop 工具箱（Phase 8 後）
  ├── ask_user(question)          ← 已有
  ├── call_agent(agent_id, ...)   ← 已有
  ├── read_memory()               ← 新增：讀取用戶偏好
  └── update_memory(insights)     ← 新增：更新用戶偏好
```

### 整體流程

```
收到用戶訊息
    ↓
[Loop 開始前] Coordinator 自動呼叫 read_memory()
    ↓
Memory context 注入 system prompt（「這位用戶偏好文化景點、預算中等、曾去過東京」）
    ↓
正常 Agentic Loop（規劃旅遊）
    ↓
[規劃完成後] Coordinator 呼叫 update_memory(新洞察)
    ↓
Memory 寫入持久化儲存
```

---

## Memory 的內容結構

```json
{
  "userId": "default",
  "lastUpdated": "2026-04-28T12:00:00Z",
  "preferences": {
    "travelStyle": ["cultural", "foodie"],
    "avoids": ["crowded tourist spots", "beach resorts"],
    "budgetRange": "mid-range ($500-$1500 per trip)",
    "groupSize": 2,
    "tripLength": "3-5 days"
  },
  "visitedPlaces": ["Tokyo", "Kyoto", "Seoul"],
  "unfinishedPlans": [
    {
      "destination": "Prague",
      "mentionedAt": "2026-03-15",
      "context": "User asked about a 5-day Europe trip but didn't complete the planning"
    }
  ],
  "insights": [
    "Prefers local restaurants over tourist-recommended ones",
    "Usually travels in April or October",
    "Interested in architecture and history"
  ]
}
```

---

## 實作選項

### Option A：JSON 檔案（展示版，建議 Phase 8 先做這個）

```
data/
└── memory/
    └── default.json    ← 單用戶，開箱即用
    └── {userId}.json   ← 多用戶擴充預留
```

**優點**：
- 零依賴，不需要資料庫
- 方便 demo（直接看 JSON 檔案驗證）
- 實作時間短

**缺點**：
- 多 process 並行寫入需要加 file lock 或改序列化
- 無法跨機器共享

**實作重點**：
```typescript
// src/services/memoryService.ts
class MemoryService {
  private filePath: string;

  async readMemory(userId = "default"): Promise<UserMemory>
  async updateMemory(userId = "default", insights: Partial<UserMemory>): Promise<void>
  private async writeSafe(data: UserMemory): Promise<void>  // 加 tmp file + rename 防止寫入中斷
}
```

### Option B：SQLite（可選升級）

```typescript
// 用 better-sqlite3（同步 API，簡單）
db.prepare("INSERT OR REPLACE INTO memories VALUES (?, ?, ?)").run(userId, key, value)
```

**適合**：Phase 8 後期或用戶數量增加時升級。不在 Phase 8 核心範圍內。

---

## Coordinator 的改動

### 新增兩個 Tool Definition

```typescript
{
  name: "read_memory",
  description: "Read the user's stored travel preferences and history before planning. Always call this at the start of planning.",
  input_schema: {
    type: "object",
    properties: {},
    required: []
  }
},
{
  name: "update_memory",
  description: "After producing a travel plan, extract and store new insights about the user's preferences for future use.",
  input_schema: {
    type: "object",
    properties: {
      insights: {
        type: "object",
        description: "Structured insights extracted from this conversation",
        properties: {
          newPreferences: { type: "array", items: { type: "string" } },
          visitedPlaces:  { type: "array", items: { type: "string" } },
          avoids:         { type: "array", items: { type: "string" } },
          generalInsights:{ type: "array", items: { type: "string" } }
        }
      }
    },
    required: ["insights"]
  }
}
```

### System Prompt 引導

```
## Memory Tools
You have access to read_memory and update_memory tools.
- Call read_memory() as the FIRST action in every planning session.
  Incorporate the user's stored preferences naturally into your planning — don't announce "I see from your profile that..."
- After delivering the final travel plan, call update_memory() with any new preferences or insights you learned.
  Only update if there's genuinely new information — don't overwrite good data with assumptions.
```

### Loop 裡的執行流程

```typescript
// executeTool() 新增兩個 case:
case "read_memory":
  const memory = await this.memoryService.readMemory(userId);
  return JSON.stringify(memory);  // 回傳給 LLM 作為 tool result

case "update_memory":
  const { insights } = toolCall.input as { insights: MemoryInsights };
  await this.memoryService.updateMemory(userId, insights);
  return "Memory updated successfully.";
```

---

## userId 的來源

Phase 8 初期：使用固定 `"default"`（單用戶 demo）。

未來擴充方向：
- 從 HTTP header（`X-User-ID`）取得
- 從前端 localStorage 產生並持久化的 UUID
- 正式認證系統（Phase 9+ 的事）

---

## 前端配合改動

### Settings 頁新增「Memory」區塊（選做）

```
[Memory]
  ○ 啟用跨對話記憶
  [清除我的記憶] ← DELETE /api/memory
```

### API Endpoints 新增

```
GET  /api/memory          ← 讀取當前 memory（debug 用）
DELETE /api/memory        ← 清除 memory（用戶可從 UI 操作）
```

---

## 受影響的檔案

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `src/services/memoryService.ts` | 新建 | `readMemory()` / `updateMemory()` / `clearMemory()` |
| `src/agents/orchestratorExecutor.ts` | 修改 | 新增 `read_memory` / `update_memory` tool handling；注入 `MemoryService` |
| `src/services/agentRegistry.ts` | 無需改動 | Memory 由 coordinator 直接處理，不走 agent registry |
| `docs/prompts/orchestrator.md` | 修改 | 補充 Memory Tools 使用說明 |
| `src/index.ts` | 修改 | 新增 `GET /api/memory` / `DELETE /api/memory` endpoint |
| `web/src/pages/SettingsPage.tsx` | 修改（選做） | Memory 啟用/清除 UI |
| `data/memory/` | 新建目錄 | JSON 記憶體儲存位置（加入 .gitignore） |

---

## 隱私設計

- `data/memory/` 加入 `.gitignore`（不 commit 用戶資料）
- Memory 只存**偏好和洞察**，不存原始對話內容（符合最小化原則）
- 清除 API 讓用戶完全控制自己的資料

---

## 實作順序

| 步驟 | 內容 |
|------|------|
| 1 | `src/services/memoryService.ts` — `readMemory()` / `updateMemory()` / `clearMemory()` |
| 2 | `orchestratorExecutor.ts` — 注入 MemoryService，新增兩個 tool definition |
| 3 | `orchestratorExecutor.ts` — `executeTool()` 新增 `read_memory` / `update_memory` case |
| 4 | `docs/prompts/orchestrator.md` — Memory Tools 使用引導 |
| 5 | `src/index.ts` — `/api/memory` endpoints |
| 6 | 驗證（見下） |
| 7 | `SettingsPage.tsx` — Memory 清除 UI（選做） |

---

## 驗證方式

1. **首次對話**：詢問東京行程 → `read_memory` 回傳空物件 → 正常規劃 → `update_memory` 記錄「用戶問過東京、偏好文化景點」
2. **第二次對話**：詢問京都行程 → `read_memory` 回傳上次記憶 → Coordinator 規劃時自動帶入文化景點偏好（不需要用戶重說）
3. **記憶清除**：呼叫 `DELETE /api/memory` → 再次對話 → 從零開始
4. **JSON 驗證**：查看 `data/memory/default.json`，確認結構正確、偏好有被更新

---

## 邊界條件

| 情境 | 處理方式 |
|------|----------|
| Memory 檔案不存在（首次） | `readMemory()` 回傳空 `UserMemory` 物件（不報錯） |
| `update_memory` LLM 輸出格式不符 | `try/catch` parse，失敗時 log warning 但不中斷 |
| 多輪對話同時寫入（race condition） | JSON 版使用 tmp file + atomic rename；SQLite 版天然串列化 |
| Memory 資料過大（長期使用） | `insights` 陣列保留最新 20 條；`visitedPlaces` 保留最新 50 筆 |
