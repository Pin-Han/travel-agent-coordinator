import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import {
  InMemoryTaskStore,
  DefaultRequestHandler,
} from "@a2a-js/sdk/server";
import { A2AExpressApp } from "@a2a-js/sdk/server/express";
import type { AgentCard } from "@a2a-js/sdk";
import { AccommodationAgentExecutor } from "../agents/accommodationAgent.js";

dotenv.config();

const PORT = parseInt(process.env.ACCOMMODATION_PORT || "3002");

const agentCard: AgentCard = {
  name: "Accommodation Planning Agent",
  description:
    "根據景點位置規劃住宿方案，推薦最省交通成本的住宿地點。接受 A2A JSON-RPC 2.0 任務。",
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
      id: "accommodation_planning",
      name: "Accommodation Planning",
      description:
        "依據旅遊需求與景點分佈，推薦住宿選項並規劃交通方案",
      tags: ["travel", "accommodation", "hotel", "planning"],
      examples: [
        "紐約5天住宿規劃，景點主要在曼哈頓和布魯克林",
        "東京3天住宿，預算每晚3000元以內",
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
  const agentExecutor = new AccommodationAgentExecutor();
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
    res.json({ status: "ok", agent: "accommodation", port: PORT });
  });

  app.listen(PORT, () => {
    console.log(
      `[AccommodationAgent] 🏨  Server started on http://localhost:${PORT}`
    );
    console.log(
      `[AccommodationAgent] Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`
    );
  });
}

main().catch(console.error);
