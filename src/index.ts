import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  DefaultRequestHandler,
} from "@a2a-js/sdk/server";
import { A2AExpressApp } from "@a2a-js/sdk/server/express";
import type { AgentCard } from "@a2a-js/sdk";

import { TravelCoordinatorExecutor } from "./agents/coordinatorExecutor.js";
import { generateAgentCard } from "./utils/agentCard.js";
import { CoordinatorConfig } from "./types/index.js";
import { getPrompts, savePrompts } from "./services/promptStore.js";
import { MemoryService } from "./services/memoryService.js";

// 載入環境變數
dotenv.config();

// 驗證必要的環境變數
function validateEnvironment(): CoordinatorConfig {
  const provider = process.env.LLM_PROVIDER || "anthropic";
  if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
    console.warn("⚠️  LLM_PROVIDER=gemini 但 GEMINI_API_KEY 未設定，請求時會失敗");
  } else if (provider !== "gemini" && !process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠️  ANTHROPIC_API_KEY 未設定，請求時會失敗（或在設定頁面切換為 Gemini）");
  }

  return {
    port: parseInt(process.env.PORT || "3000"),
    agentId: process.env.COORDINATOR_AGENT_ID || "travel_coordinator_agent",
    agentName: process.env.COORDINATOR_AGENT_NAME || "Travel Coordinator Agent",
    agentDescription:
      process.env.COORDINATOR_AGENT_DESCRIPTION || "智能旅遊規劃協調服務",
    maxCoordinationSteps: parseInt(process.env.MAX_COORDINATION_STEPS || "10"),
    taskTimeoutMs: parseInt(process.env.TASK_TIMEOUT_MS || "300000"),
  };
}

// --- Travel Agent Card ---
const config = validateEnvironment();
const travelAgentCard: AgentCard = generateAgentCard(config);

async function main() {
  // 1. Create TaskStore
  const taskStore: TaskStore = new InMemoryTaskStore();

  // 2. Create AgentExecutor
  const agentExecutor: AgentExecutor = new TravelCoordinatorExecutor(config);
  const memoryService = new MemoryService();

  // 3. Create DefaultRequestHandler
  const requestHandler = new DefaultRequestHandler(
    travelAgentCard,
    taskStore,
    agentExecutor
  );

  // 4. Create and setup A2AExpressApp
  const appBuilder = new A2AExpressApp(requestHandler);
  const baseApp = express();
  baseApp.use(cors());
  baseApp.use(express.json());
  const expressApp = appBuilder.setupRoutes(baseApp);

  // Prompt 管理 API（供前端 Settings 頁面使用）
  expressApp.get("/api/prompts", (_req, res) => {
    res.json(getPrompts());
  });

  expressApp.put("/api/prompts", (req, res) => {
    try {
      savePrompts(req.body);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Memory API
  expressApp.get("/api/memory", (_req, res) => {
    res.json(memoryService.readMemory("default"));
  });

  expressApp.delete("/api/memory", (_req, res) => {
    memoryService.clearMemory("default");
    res.json({ ok: true });
  });

  // 5. Start the server
  const PORT = config.port;
  expressApp.listen(PORT, () => {
    console.log(
      `[TravelAgent] Server using new framework started on http://localhost:${PORT}`
    );
    console.log(
      `[TravelAgent] Agent Card: http://localhost:${PORT}/.well-known/agent.json`
    );
    console.log("[TravelAgent] Press Ctrl+C to stop the server");
  });
}

// 啟動應用程式 (僅在直接運行時)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main };
