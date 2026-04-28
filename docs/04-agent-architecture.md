# Phase 4: Agent Architecture & Orchestrator Improvements

## Context

`docs/orchestrator.md` 定義了四個專家的依序呼叫流程，但目前程式碼只實作兩個 sub-agent（attractions + accommodation），**交通推薦**專家完全缺失。此外，coordinator system prompt 尚未對應 orchestrator.md 的四步驟流程與回覆結構。本文件規劃補齊的改動。

---

## 問題一：現有架構是否足夠完成一套旅遊分析？

**不足夠。** 以下是差距分析：

| 專家 | orchestrator.md 期待 | 目前狀態 | 缺口 |
|------|----------------------|----------|------|
| 景點推薦 | ✅ 第一步 | ✅ 已實作（Tavily 搜尋） | — |
| 住宿推薦 | ✅ 第二步，依賴景點位置 | ✅ 已實作（Tavily 搜尋） | — |
| 交通推薦 | ✅ 第三步，依賴景點＋住宿位置 | ❌ 完全缺失 | **需新增** |
| 整合行程 | ✅ 第四步 | ✅ coordinator LLM 負責 | 需更新 prompt |

### 為何需要獨立交通 Agent，而非直接塞進 coordinator synthesis？

交通規劃有兩個核心輸入：
1. **景點分布區域**（來自 attractions agent）
2. **住宿位置**（來自 accommodation agent）

只有在前兩步完成後，交通 agent 才能計算：「住宿 → 景點 A → 景點 B → 回住宿」的最佳路線、建議交通工具（地鐵/巴士/步行）、每日交通時間與費用。若塞進 coordinator synthesis，LLM 需要同時做景點整合 + 住宿整合 + 交通規劃三件事，輸出品質下降且難以用 Tavily 搜尋實時交通資訊。

### 其他潛在 Agent 評估

| Agent | 評估 | 結論 |
|-------|------|------|
| 預算 Agent | 預算計算依賴所有其他 agent 的輸出，在 coordinator synthesis 階段做更合適 | ❌ 不需獨立 |
| 天氣 Agent | 可在 attractions agent 中順帶 Tavily 搜尋當地季節天氣，不需獨立 agent | ❌ 不需獨立 |
| 文化/入境須知 Agent | 實用但非核心流程，可在 coordinator 的 integration prompt 中要求 LLM 補充 | ❌ 不需獨立 |

**結論：增加一個 Transportation Agent 即可對應 orchestrator.md 的規格，不需更多。**

---

## 問題二：Orchestrator Prompt 需要哪些調整？

### 現況 vs. 目標對比

**`docs/orchestrator.md`（目標）：**
- 流程：景點 → 住宿 → 交通 → 整合
- 回覆結構：熱情開場 + 行程亮點 → 詳細安排與住宿 → 交通指南與預算 → 實用提醒
- 原則：資訊不足時主動假設，不反問；語調專業可信、友好熱情

**`config/prompts.json` coordinator（現況）：**
- system prompt：描述為 "synthesising expert recommendations"，缺乏四步驟流程描述
- integration prompt：只整合兩個專家（attractions + accommodation），缺少 transportation
- fallback prompt：良好，可保留

### `config/prompts.json` 需要的改動

1. **`coordinator.system`**：更新為反映 4 個專家的協調者角色，加入 orchestrator.md 的回覆結構與語調指引
2. **`coordinator.integration`**：新增 `{transportation}` placeholder，整合三個專家結果
3. **新增 `transportation` 條目**：system + user prompt（同 attractions/accommodation 格式）

---

## 實作範圍

### 新增：Transportation Agent

**新增檔案：**
- `src/agents/transportationAgent.ts`（實作 `AgentExecutor`，同 attractionsAgent 模式）
- `src/servers/transportationServer.ts`（Express :3003，A2A routes + `/health`）

**修改檔案：**
- `config/prompts.json`：新增 `transportation` 條目
- `src/services/agentRegistry.ts`：新增 `transportation` agent 設定（port 3003）
- `src/agents/coordinatorExecutor.ts`：在 accommodation 之後加入 step 3 transportation call
- `package.json`：`dev:agents` 腳本加入 :3003

**Transportation Agent 的輸入：**
```
{request}          ← 原始使用者需求
{attractionArea}   ← 景點集中區域（來自 attractions agent）
{accommodationArea} ← 住宿位置（來自 accommodation agent）
```

**Transportation Agent 的輸出（Markdown）：**
- 每日交通路線建議（住宿 → 景點 → 回程）
- 建議交通工具（地鐵/巴士/步行/計程車）及理由
- 景點間移動時間估算
- 交通費用估算
- 機票/火車票建議（如適用）

### 更新：Orchestrator Prompt

**`coordinator.system` 改寫重點：**
- 加入「依序整合四個專家」的協調者角色描述
- 加入 orchestrator.md 的語調要求（專業可信、友好熱情、資訊不足主動假設不反問）

**`coordinator.integration` 更新：**
```
新增 {transportation} placeholder
回覆結構明確對應 orchestrator.md：
  1. Opening & highlights
  2. Day-by-day itinerary + accommodation
  3. Transportation guide + budget summary  ← 新增
  4. Practical tips & follow-up support
```

### 修復：`extractTravelInfo()` 語言問題

`coordinatorExecutor.ts` 的 `extractTravelInfo()` 有以下問題：
- 預設 destination 硬編碼為 `"台北"`（英文查詢時會拿到錯誤預設值）
- 預設 preferences 為 `["美食", "文化"]`（中文）
- 只能解析 `(\d+)天` / `(\d+)元` 格式（中文數字模式）

修復：
- destination 預設值改為 `""` (empty)，讓 LLM 從 `{request}` 自行解析
- 加入英文模式匹配：`(\d+)\s*days?`、`\$(\d+)`、`(\d+)\s*nights?`
- preferences 預設值改為 `[]`

---

## 調整後的整體流程

```
使用者輸入
    ↓
Coordinator（:3000）
    ↓ Step 1
Attractions Agent  →  景點 + 每日分區摘要
    ↓ Step 2（傳入 attractionArea）
Accommodation Agent → 住宿選項 + 住宿位置
    ↓ Step 3（傳入 attractionArea + accommodationArea）
Transportation Agent → 交通路線 + 費用估算
    ↓ Step 4（整合三份結果）
Coordinator LLM Synthesis
    ↓
最終旅遊計劃（Markdown）
```

---

## 受影響檔案清單

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `config/prompts.json` | 修改 + 新增 | coordinator prompt 更新；新增 transportation 條目 |
| `src/agents/transportationAgent.ts` | 新增 | Transportation AgentExecutor |
| `src/servers/transportationServer.ts` | 新增 | Express :3003，A2A routes |
| `src/services/agentRegistry.ts` | 修改 | 新增 transportation agent 設定 |
| `src/agents/coordinatorExecutor.ts` | 修改 | 新增 Step 3、更新 integration 呼叫、修復 extractTravelInfo |
| `package.json` | 修改 | dev:agents 加入 :3003 |

---

## 實作順序

| 步驟 | 內容 | 複雜度 |
|------|------|--------|
| 1 | `config/prompts.json`：更新 coordinator prompt + 新增 transportation | Low |
| 2 | `coordinatorExecutor.ts`：修復 `extractTravelInfo()` | Low |
| 3 | `agentRegistry.ts`：新增 transportation agent 設定 | Low |
| 4 | `src/agents/transportationAgent.ts`：實作 executor（複製 accommodationAgent 模式） | Medium |
| 5 | `src/servers/transportationServer.ts`：建立 :3003 server | Low |
| 6 | `coordinatorExecutor.ts`：加入 Step 3 transportation call + 更新 integration | Medium |
| 7 | `package.json`：更新 dev:agents script | Low |

---

## 驗證方式

1. **Transportation Agent 單獨測試**：curl `http://localhost:3003/health` 回傳 200
2. **完整流程測試**：傳送旅遊需求，確認 status-update 進度訊息依序出現（Step 1 → Step 2 → Step 3 → Synthesis）
3. **輸出結構驗證**：最終 Markdown 包含四個段落（開場亮點 / 行程住宿 / 交通指南 / 實用提醒）
4. **英文查詢測試**：傳送英文需求，確認 `extractTravelInfo` 不會回傳中文預設值
5. **Graceful degradation**：關掉 transportation server，確認系統仍能產出（用兩個 agent 結果整合）
