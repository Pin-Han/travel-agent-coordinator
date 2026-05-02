# Phase 9: UX 優化、Log 頁面、記憶萃取改善

## Context

Phase 9 針對四個使用體驗問題進行改善：
1. 不知道 AI 回覆花了多久
2. 等待時累積一大堆已完成項目，視覺雜亂
3. 沒有 debug 用的 log 記錄，難以追蹤 sub-agent 呼叫狀況
4. 記憶萃取不夠準確（Coordinator 同時規劃 + 萃取，精準度有限）

---

## 架構變更

### Feature 1：單行進度（Claude Code 風格）

移除堆疊式進度顯示，改為單行原地替換：

```
舊：
✓ Planning your trip...
✓ Consulting attractions specialist...
→ Consulting accommodation specialist...

新：
→ Consulting accommodation specialist...   ← 只顯示這一行，持續替換
```

### Feature 2：回覆耗時顯示

```
訊息底部：12.3s · Input 450 · Output 820 tokens
```

### Feature 3：Log 頁面（localStorage）

```
Sidebar → 📋 Logs

Log 列表（最新在前）：
┌─────────────────────────────────────────────────┐
│ 2026-04-28 14:23  「我想去東京 5 天...」  12.3s  │ ▶
├─────────────────────────────────────────────────┤
│ 展開後：                                         │
│   14:23:01  Planning your trip...               │
│   14:23:02  Consulting attractions specialist...│
│   14:23:06  Consulting accommodation specialist │
│   14:23:09  Reviewing plan quality...           │
│   Token usage: Input 3200 · Output 1800         │
└─────────────────────────────────────────────────┘

[Clear logs]
```

儲存格式（localStorage key: `agent-logs`，最多 50 筆）：
```typescript
interface LogEntry {
  id: string;
  timestamp: string;       // 請求開始時間 ISO
  userInput: string;
  durationMs: number;
  steps: { text: string; timestamp: string }[];
  tokenUsage?: { input: number; output: number };
}
```

### Feature 4：獨立記憶萃取

**舊做法（不穩定）：**
Coordinator LLM 規劃完後「順便」呼叫 `update_memory` tool，萃取品質取決於 Coordinator 的心情。

**新做法（類似 Evaluator）：**
```
規劃完成 → Evaluator 打分通過
    ↓
extractAndSaveMemory()  ← 獨立 LLM call，只負責萃取
使用 docs/prompts/memory-extractor.md 的 prompt
    ↓
寫入 data/memory/default.json
```

---

## 受影響的檔案

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `web/src/pages/ChatPage.tsx` | 修改 | 單行進度、耗時顯示、LogEntry 寫入 localStorage |
| `web/src/pages/LogsPage.tsx` | 新建 | Log 頁面 UI |
| `web/src/App.tsx` | 修改 | 新增 `/logs` 路由和 sidebar 連結 |
| `docs/prompts/memory-extractor.md` | 新建 | 記憶萃取專用 prompt |
| `src/agents/orchestratorExecutor.ts` | 修改 | 移除 `update_memory` tool、新增 `extractAndSaveMemory()` |
| `docs/prompts/orchestrator.md` | 修改 | 移除 `update_memory` 指引 |

---

## 邊界條件

| 情境 | 處理方式 |
|------|----------|
| localStorage 超過 50 筆 | 保留最新 50 筆，移除最舊的 |
| `extractAndSaveMemory` LLM 失敗 | `try/catch`，失敗 log warning 不中斷主流程 |
| 記憶萃取回傳非 JSON | parse 失敗視為無新資訊，不寫入 |
| Log 頁面無資料 | 顯示空狀態說明 |

---

## 驗證方式

1. **單行進度**：送出請求，等待期間只有一行文字持續替換，不堆疊
2. **耗時**：AI 回覆底部顯示「X.Xs · Input X · Output X tokens」
3. **Log 頁面**：sidebar 有 Logs 連結 → 進入後看到請求記錄 → 展開看每步驟時間 → Clear 後清空
4. **記憶萃取**：第一次問東京 → 查看 `data/memory/default.json` 有偏好記錄 → 第二次問京都自動帶入偏好
