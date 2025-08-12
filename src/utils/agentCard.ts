import type { AgentCard } from "@a2a-js/sdk";
import { CoordinatorConfig } from "../types/index.js";

export function generateAgentCard(config: CoordinatorConfig): AgentCard {
  return {
    name: config.agentName,
    description: config.agentDescription,
    // Adjust the base URL and port as needed.
    url: `http://localhost:${config.port}/`,
    provider: {
      organization: "Travel Coordination Services",
      url: "https://travel-coordinator.com", // Added provider URL
    },
    protocolVersion: "0.3.0", // A2A protocol this agent supports.
    version: "1.0.0", // Incremented version
    capabilities: {
      streaming: true, // Supports streaming
      pushNotifications: false, // Assuming not implemented for this agent yet
      stateTransitionHistory: true, // Agent uses history
    },
    securitySchemes: undefined, // Or define actual security schemes if any
    security: undefined,
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "travel_coordination",
        name: "Travel Coordination",
        description:
          "Coordinate comprehensive travel planning including attractions, accommodation, and budget planning",
        tags: [
          "travel",
          "planning",
          "coordination",
          "attractions",
          "accommodation",
        ],
        examples: [
          "Please help me plan a 3-day trip to Taipei with a budget of NT$30,000, focusing on cultural sites and cuisine",
          "Plan a 5-day family trip to Kaohsiung with 2 children, need family-friendly attractions and accommodation",
          "Arrange a 2-day trip to Taichung focusing on food and shopping",
          "I want to visit Taiwan for 7 days, budget around NT$50,000 for 2 people",
          "Plan a romantic weekend getaway in Tainan",
          "Organize a business trip to Taipei with meetings and some sightseeing",
        ],
        inputModes: ["text/plain"], // Explicitly defining for skill
        outputModes: ["text/plain"], // Explicitly defining for skill
      },
    ],
    supportsAuthenticatedExtendedCard: false,
  };
}
