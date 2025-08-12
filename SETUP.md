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

編輯 `.env` 文件，填入以下必要的 API 金鑰：

```bash
# Metrio AI API 金鑰 (必須)
METRIO_AI_API_KEY=your_metrio_ai_api_key_here
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

### Metrio AI API

1. 前往 [Metrio AI](https://metrio.ai/)
2. 註冊並登入帳戶
3. 取得您的 API 金鑰
4. 將金鑰填入 `.env` 文件的 `METRIO_AI_API_KEY`

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

### 使用測試客戶端

```bash
node test-client.js
```

## 📋 可用端點

- `GET /.well-known/agent-card.json` - 取得代理卡片
- `POST /message/send` - 發送訊息
- `POST /message/stream` - 串流訊息
- `POST /tasks/get` - 查詢任務狀態
- `POST /tasks/cancel` - 取消任務
- `GET /health` - 健康檢查
- `GET /status` - 服務狀態
- `GET /docs` - API 文檔

## 🔧 配置選項

您可以在 `.env` 文件中調整以下設定：

```bash
# 伺服器設定
PORT=3000
NODE_ENV=development

# 協調設定
MAX_COORDINATION_STEPS=10
TASK_TIMEOUT_MS=300000

# 代理設定
COORDINATOR_AGENT_NAME=Travel Coordinator Agent
COORDINATOR_AGENT_DESCRIPTION=智能旅遊規劃協調服務
```

## ❗ 常見問題

### 編譯錯誤

如果遇到 TypeScript 編譯錯誤，請嘗試：

```bash
npm run clean
npm run build
```

### API 連接錯誤

- 檢查 API 金鑰是否正確設定
- 確認網路連接正常
- 查看控制台輸出的錯誤訊息

### 服務無法啟動

- 檢查 PORT 是否被其他服務占用
- 確認所有必要的環境變數都已設定

## 🎯 下一步

1. 查看 [README.md](./README.md) 了解詳細功能
2. 查看 [API 文檔](http://localhost:3000/docs) 了解完整 API
3. 自定義 Prompt 或添加新的代理服務

## 💬 支援

如需協助，請：

1. 檢查日誌輸出
2. 查看 GitHub Issues
3. 聯絡開發團隊
