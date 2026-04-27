import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import {
  InMemoryTaskStore,
  DefaultRequestHandler,
} from "@a2a-js/sdk/server";
import { A2AExpressApp } from "@a2a-js/sdk/server/express";
import type { AgentCard } from "@a2a-js/sdk";
import { AttractionsAgentExecutor } from "../agents/attractionsAgent.js";

dotenv.config();

const PORT = parseInt(process.env.ATTRACTIONS_PORT || "3001");

const agentCard: AgentCard = {
  name: "Attractions Recommendation Agent",
  description:
    "搜尋並推薦旅遊景點，附帶地理位置資訊供住宿規劃參考。接受 A2A JSON-RPC 2.0 任務。",
  url: `http://localhost:${PORT}/`,
  provider: {
    organization: "Travel Agent System",
    url: "http://localhost:3000",
  },
  protocolVersion: "0.3.0",
  version: "1.0.0",
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [
    {
      id: "attractions_recommendation",
      name: "Attractions Recommendation",
      description: "根據目的地、天數、偏好推薦景點行程，並提供地區分佈資訊",
      tags: ["travel", "attractions", "planning", "itinerary"],
      examples: [
        "幫我規劃紐約5天景點行程，喜歡博物館和街頭文化",
        "東京3天文化景點推薦，預算50000元",
      ],
      inputModes: ["text/plain"],
      outputModes: ["text/plain"],
    },
  ],
  securitySchemes: undefined,
  security: undefined,
  supportsAuthenticatedExtendedCard: false,
};

async function main() {
  const taskStore = new InMemoryTaskStore();
  const agentExecutor = new AttractionsAgentExecutor();
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    agentExecutor
  );

  const appBuilder = new A2AExpressApp(requestHandler);
  const app = appBuilder.setupRoutes(express());

  app.use(cors());

  // Health endpoint（供 Coordinator 健康檢查）
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", agent: "attractions", port: PORT });
  });

  app.listen(PORT, () => {
    console.log(
      `[AttractionsAgent] 🗺️  Server started on http://localhost:${PORT}`
    );
    console.log(
      `[AttractionsAgent] Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`
    );
  });
}

main().catch(console.error);
