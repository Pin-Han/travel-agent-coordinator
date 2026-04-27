# Travel Agent Coordinator

> A multi-agent travel planning system built on Google's A2A Protocol —
> demonstrating how independent AI agents discover and collaborate with each other.

## 🌟 功能特色

- **🤖 多代理協調**: 整合景點推薦、住宿規劃代理
- **📡 A2A 協議**: 完全符合 Agent-to-Agent (JSON-RPC 2.0) 通信標準
- **🔌 雙模式支援**: API 模式（直接 LLM）或 A2A 模式（獨立 sub-agent process）
- **🎯 實時協調**: 支援串流更新和任務狀態追蹤
- **🛡️ Graceful Degradation**: Sub-agent 失敗時自動降級，回傳 partial result

## 🏗️ 架構概述

```
使用者請求
    ↓
Coordinator Agent (:3000)
  ├── [A2A 模式] → Attractions Agent (:3001)
  └── [A2A 模式] → Accommodation Agent (:3002)

每個 Sub-agent 有自己的:
  ├── /.well-known/agent-card.json  (A2A 發現機制)
  ├── POST /message/send            (接受 A2A 任務)
  └── GET /health                   (健康檢查)
```

## 🚀 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 設置環境變數

```bash
cp .env.example .env
# 編輯 .env，填入 ANTHROPIC_API_KEY
```

### 3. 建置並啟動

```bash
npm run build
npm start

# 或開發模式
npm run dev
```

服務將在 `http://localhost:3000` 啟動。

## 📋 API 端點

- `GET /.well-known/agent-card.json` - A2A Agent 發現
- `POST /message/send` - 發送訊息（同步）
- `POST /message/stream` - 串流訊息（SSE）
- `POST /tasks/get` - 查詢任務狀態
- `POST /tasks/cancel` - 取消任務
- `GET /health` - 健康檢查

## 💬 使用範例

### 基本旅遊規劃

```bash
curl -X POST http://localhost:3000/message/send \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "id": "test-001",
    "params": {
      "message": {
        "messageId": "msg-001",
        "role": "user",
        "parts": [{ "kind": "text", "text": "請幫我規劃台北3天旅遊，預算30000元，喜歡文化古蹟和美食" }],
        "kind": "message"
      }
    }
  }'
```

## 🔧 開發指南

### 專案結構

```
src/
├── agents/
│   └── coordinatorExecutor.ts  # Coordinator 邏輯
├── services/
│   ├── llmClient.ts            # Anthropic SDK 抽象層
│   ├── agentRegistry.ts        # Agent 註冊與呼叫管理
│   └── taskStore.ts            # 任務狀態存儲
├── types/                      # TypeScript 類型定義
├── utils/
│   └── agentCard.ts            # A2A Agent Card 產生
└── index.ts                    # 主程式入口
```

### 環境設定

| 變數 | 說明 | 必填 |
|------|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 金鑰 | ✅ |
| `ANTHROPIC_MODEL` | 使用的模型（預設 claude-haiku-4-5-20251001） | — |
| `ATTRACTIONS_MODE` | `api` 或 `a2a`（預設 `api`） | — |
| `ACCOMMODATION_MODE` | `api` 或 `a2a`（預設 `api`） | — |
| `ATTRACTIONS_AGENT_URL` | A2A 模式下 Attractions Agent URL | — |
| `ACCOMMODATION_AGENT_URL` | A2A 模式下 Accommodation Agent URL | — |

## 📝 授權

此專案採用 Apache 2.0 授權。

## 🔗 相關資源

- [A2A Protocol Spec](https://github.com/a2aproject/a2a-js)
- [Anthropic API](https://docs.anthropic.com/)
- [Google A2A Protocol](https://google.github.io/A2A/)
