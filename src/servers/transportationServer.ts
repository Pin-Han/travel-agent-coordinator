import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import {
  InMemoryTaskStore,
  DefaultRequestHandler,
} from "@a2a-js/sdk/server";
import { A2AExpressApp } from "@a2a-js/sdk/server/express";
import type { AgentCard } from "@a2a-js/sdk";
import { TransportationAgentExecutor } from "../agents/transportationAgent.js";

dotenv.config();

const PORT = parseInt(process.env.TRANSPORTATION_PORT || "3003");

const agentCard: AgentCard = {
  name: "Transportation Planning Agent",
  description:
    "Plans daily transit routes based on attraction areas and accommodation location. Recommends transport modes, estimates travel times and costs. Accepts A2A JSON-RPC 2.0 tasks.",
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
      id: "transportation_planning",
      name: "Transportation Planning",
      description:
        "Plans daily transit routes from accommodation to attractions, recommends transport modes, and estimates costs",
      tags: ["travel", "transportation", "transit", "routing", "planning"],
      examples: [
        "5-day Tokyo trip — plan daily routes from Shinjuku to attractions",
        "New York 3 days — subway routes from Midtown to Brooklyn and Queens",
        "Paris 4 days — transit from 9th arrondissement hotel to Louvre, Versailles, Montmartre",
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
  const agentExecutor = new TransportationAgentExecutor();
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    agentExecutor
  );

  const appBuilder = new A2AExpressApp(requestHandler);
  const app = appBuilder.setupRoutes(express());

  app.use(cors());

  // Health endpoint (used by Coordinator health checks)
  app.get("/health", (_req, res) => {
    const provider = process.env.LLM_PROVIDER || "anthropic";
    const hasKey =
      provider === "gemini"
        ? !!process.env.GEMINI_API_KEY
        : !!process.env.ANTHROPIC_API_KEY;
    if (hasKey) {
      res.json({ status: "ok", agent: "transportation", port: PORT });
    } else {
      res.status(503).json({ status: "error", reason: "API key not configured" });
    }
  });

  app.listen(PORT, () => {
    console.log(
      `[TransportationAgent] 🚇  Server started on http://localhost:${PORT}`
    );
    console.log(
      `[TransportationAgent] Agent Card: http://localhost:${PORT}/.well-known/agent.json`
    );
  });
}

main().catch(console.error);
