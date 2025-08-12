import dotenv from "dotenv";
import express from "express";
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

// 載入環境變數
dotenv.config();

// 驗證必要的環境變數
function validateEnvironment(): CoordinatorConfig {
  const metrioApiKey = process.env.METRIO_AI_API_KEY;
  if (!metrioApiKey) {
    throw new Error("METRIO_AI_API_KEY 環境變數是必須的");
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

  // 3. Create DefaultRequestHandler
  const requestHandler = new DefaultRequestHandler(
    travelAgentCard,
    taskStore,
    agentExecutor
  );

  // 4. Create and setup A2AExpressApp
  const appBuilder = new A2AExpressApp(requestHandler);
  const expressApp = appBuilder.setupRoutes(express());

  // 5. Start the server
  const PORT = config.port;
  expressApp.listen(PORT, () => {
    console.log(
      `[TravelAgent] Server using new framework started on http://localhost:${PORT}`
    );
    console.log(
      `[TravelAgent] Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`
    );
    console.log("[TravelAgent] Press Ctrl+C to stop the server");
  });
}

// 啟動應用程式 (僅在直接運行時)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main };
