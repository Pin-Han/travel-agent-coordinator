# Travel Agent Coordinator

一個基於 A2A 協議的智能旅遊協調代理，使用 Metrio AI 提供完整的旅遊規劃服務。

## 🌟 功能特色

- **🤖 多代理協調**: 整合景點推薦、住宿規劃和預算分析代理
- **🔌 Metrio AI 整合**: 利用 Metrio AI 的專業旅遊 Prompt
- **📡 A2A 協議**: 完全符合 Agent-to-Agent 通信標準
- **🎯 實時協調**: 支援串流更新和任務狀態追蹤
- **💰 預算分析**: 智能預算規劃和成本估算 (內建演算法)
- **🚀 簡化架構**: 純 Metrio AI 驅動，無需額外 AI 服務

## 🏗️ 架構概述

```
用戶請求 → Coordinating Agent → 順序呼叫專業代理
                                       ↓
景點推薦 (Metrio AI) → 住宿規劃 (Metrio AI) → 預算分析 (內建)
                                       ↓
                    整合結果 → 回傳給用戶
```

## 🚀 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 設置環境變數

複製 `.env.example` 到 `.env` 並填入必要的 API 金鑰：

```bash
cp .env.example .env
```

編輯 `.env` 文件：

```env
# 伺服器設定
PORT=3000
NODE_ENV=development

# Metrio AI API 設定
METRIO_AI_API_URL=https://api.metrio.ai/v1/chat/completion
METRIO_AI_API_KEY=your_metrio_ai_api_key_here
METRIO_AI_PROJECT_ID=patrick-test-250519-3683

# Metrio AI Prompt IDs
COORDINATING_PROMPT_ID=944817
ACCOMMODATION_PROMPT_ID=144932
ATTRACTION_PROMPT_ID=138152
```

### 3. 建置專案

```bash
npm run build
```

### 4. 啟動服務

```bash
# 開發模式 (支援熱重載)
npm run dev

# 生產模式
npm start
```

服務將在 `http://localhost:3000` 啟動。

## 📋 API 端點

### A2A 標準端點

- `GET /.well-known/agent-card.json` - 取得代理卡片
- `POST /message/send` - 發送訊息
- `POST /message/stream` - 串流訊息
- `POST /tasks/get` - 查詢任務狀態
- `POST /tasks/cancel` - 取消任務

### 額外端點

- `GET /health` - 健康檢查
- `GET /status` - 服務狀態
- `GET /docs` - API 文檔

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
        "parts": [
          {
            "kind": "text",
            "text": "請幫我規劃台北3天旅遊，預算30000元，喜歡文化古蹟和美食"
          }
        ],
        "kind": "message"
      }
    }
  }'
```

### 家庭旅遊規劃

```bash
curl -X POST http://localhost:3000/message/send \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "id": "test-002",
    "params": {
      "message": {
        "messageId": "msg-002",
        "role": "user",
        "parts": [
          {
            "kind": "text",
            "text": "計劃帶2個小孩到高雄玩5天，需要親子友善的景點和住宿"
          }
        ],
        "kind": "message"
      }
    }
  }'
```

### 串流訊息範例

```javascript
// 使用 A2A JavaScript SDK
import { A2AClient } from "@a2a-js/sdk/client";

const client = new A2AClient("http://localhost:3000");

const streamParams = {
  message: {
    messageId: "stream-001",
    role: "user",
    parts: [{ kind: "text", text: "規劃台中2天1夜旅遊" }],
    kind: "message",
  },
};

const stream = client.sendMessageStream(streamParams);

for await (const event of stream) {
  if (event.kind === "status-update") {
    console.log("狀態更新:", event.status.message.parts[0].text);
  } else if (event.kind === "artifact-update") {
    console.log("結果更新:", event.artifact.name);
  }
}
```

## 🔧 開發指南

### 專案結構

```
src/
├── agents/           # 代理執行器
│   └── coordinatorExecutor.ts
├── services/         # 服務模組
│   ├── metrioClient.ts   # Metrio AI 客戶端
│   ├── agentRegistry.ts  # 代理註冊管理
│   └── taskStore.ts      # 任務存儲
├── types/            # TypeScript 類型定義
├── utils/            # 工具函數
└── index.ts          # 主程式入口
```

### 環境設定

確保以下環境變數正確設定：

- `METRIO_AI_API_KEY`: Metrio AI API 金鑰
- `METRIO_AI_PROJECT_ID`: Metrio AI 專案 ID

### 添加新代理

1. 在 `src/services/agentRegistry.ts` 中註冊新代理
2. 實現對應的 API 呼叫邏輯
3. 更新協調執行器中的處理流程

### 自定義 Prompt

修改 `src/services/metrioClient.ts` 中的相關方法或在 Metrio AI 平台上編輯 Prompt 來調整協調邏輯。

## 🧪 測試

### 健康檢查

```bash
curl http://localhost:3000/health
```

### 服務狀態

```bash
curl http://localhost:3000/status
```

### 代理卡片

```bash
curl http://localhost:3000/.well-known/agent-card.json
```

## 📊 監控

服務提供以下監控端點：

- **健康檢查**: 包含任務統計、代理狀態、記憶體使用
- **任務追蹤**: 實時任務狀態和進度
- **代理狀態**: 各代理的健康狀況

## 🔒 安全考量

- API 金鑰通過環境變數管理
- 請求超時機制防止資源占用
- 任務自動清理避免記憶體洩漏
- CORS 和安全標頭配置

## 🚧 已知限制

- 目前主要支援台灣地區的旅遊規劃
- 依賴外部 API 服務的可用性
- 複雜行程規劃可能需要較長處理時間
- 預算計算基於簡化的估算模型

## 🤝 貢獻指南

1. Fork 專案
2. 創建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交變更 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 開啟 Pull Request

## 📝 授權

此專案採用 Apache 2.0 授權 - 查看 [LICENSE](LICENSE) 文件了解詳情。

## 🆘 支援

如有問題或建議，請：

1. 查看 [API 文檔](http://localhost:3000/docs)
2. 檢查 [Issues](https://github.com/example/travel-agent-coordinator/issues)
3. 聯絡支援團隊: support@travel-coordinator.com

## 🔗 相關資源

- [A2A Protocol](https://github.com/a2aproject/a2a-js)
- [Metrio AI](https://metrio.ai/)
- [Express.js](https://expressjs.com/)

---

**Happy Coding! 🎉**
