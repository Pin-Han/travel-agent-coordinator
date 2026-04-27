# 快速設置指南

## 🚀 快速開始

### 1. 環境準備

確保您的系統已安裝：

- Node.js 18+
- npm 或 yarn

### 2. 設置 API 金鑰

複製環境變數範例文件：

```bash
cp .env.example .env
```

編輯 `.env` 文件，填入必要的 API 金鑰：

```bash
# Anthropic API 金鑰 (必須)
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

### 3. 安裝並啟動

```bash
# 安裝依賴
npm install

# 編譯專案
npm run build

# 啟動服務
npm start

# 或者開發模式 (支援熱重載)
npm run dev
```

服務將在 `http://localhost:3000` 啟動。

## 🔑 API 金鑰取得方式

### Anthropic API

1. 前往 [Anthropic Console](https://console.anthropic.com/)
2. 註冊並登入帳戶
3. 建立 API 金鑰
4. 將金鑰填入 `.env` 文件的 `ANTHROPIC_API_KEY`

## 🧪 快速測試

### 健康檢查

```bash
curl http://localhost:3000/health
```

### 測試旅遊規劃

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
        "parts": [
          {
            "kind": "text",
            "text": "請幫我規劃台北2天旅遊，預算20000元"
          }
        ],
        "kind": "message"
      }
    }
  }'
```

## 📋 可用端點

- `GET /.well-known/agent-card.json` - 取得代理卡片
- `POST /message/send` - 發送訊息
- `POST /message/stream` - 串流訊息
- `POST /tasks/get` - 查詢任務狀態
- `POST /tasks/cancel` - 取消任務
- `GET /health` - 健康檢查

## 🔧 配置選項

您可以在 `.env` 文件中調整以下設定：

```bash
# 伺服器設定
PORT=3000
NODE_ENV=development

# Agent 模式 (api = 直接 LLM, a2a = 獨立 sub-agent process)
ATTRACTIONS_MODE=api
ACCOMMODATION_MODE=api

# 協調設定
MAX_COORDINATION_STEPS=10
TASK_TIMEOUT_MS=300000
```

## ❗ 常見問題

### 編譯錯誤

如果遇到 TypeScript 編譯錯誤，請嘗試：

```bash
npm run clean
npm run build
```

### 服務無法啟動

- 檢查 `ANTHROPIC_API_KEY` 是否正確設定
- 確認 PORT 是否被其他服務占用
- 查看控制台輸出的錯誤訊息
