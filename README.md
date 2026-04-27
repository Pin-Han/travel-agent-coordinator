# Travel Agent Coordinator

A multi-agent travel planning system built on [Google's A2A Protocol](https://google.github.io/A2A/) — demonstrating how independent AI agents discover, communicate, and collaborate via JSON-RPC 2.0.

## Architecture

```
User (React Web UI :5173)
        │  A2A JSON-RPC 2.0
        ▼
Coordinator Agent (:3000)
  ├── Parses intent & splits tasks
  ├── Calls sub-agents in parallel
  ├── Synthesizes results with LLM
  └── Graceful degradation when sub-agents fail
        │
        ├── [A2A Protocol] ──▶ Attractions Agent (:3001)
        │                        └── /.well-known/agent-card.json
        │                        └── POST /message/send
        │                        └── GET  /health
        │
        └── [A2A Protocol] ──▶ Accommodation Agent (:3002)
                                 └── /.well-known/agent-card.json
                                 └── POST /message/send
                                 └── GET  /health
```

### Dual-mode operation

Each sub-agent supports two modes, switchable via environment variable:

| Mode | How it works | When to use |
|------|-------------|-------------|
| `api` (default) | Coordinator calls LLM directly — no separate process needed | Local dev, quick testing |
| `a2a` | Each agent runs as an independent process; Coordinator sends real A2A JSON-RPC 2.0 requests | Demo, showcasing the full protocol |

## Features

- **A2A Protocol** — Agents expose `/.well-known/agent-card.json` for capability discovery; communication follows the A2A JSON-RPC 2.0 spec
- **Multi-provider LLM** — Switch between Anthropic (Claude) and Google (Gemini) from the UI; provider is passed as request metadata, no server restart needed
- **Configurable prompts** — Edit system/user prompts for each agent in the Settings page; stored in `localStorage`, applied on every request
- **Graceful degradation** — If a sub-agent is unavailable, the Coordinator falls back to a direct LLM response instead of failing
- **Web UI** — React + Vite chat interface with real-time status and a prompt/provider settings page

## Getting Started

### Prerequisites

- Node.js 18+
- An API key for Anthropic or Gemini (at least one)

### 1. Install dependencies

```bash
npm install
cd web && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your key:

```env
# Pick one (or both)
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...

# Set which provider to use by default (anthropic | gemini)
LLM_PROVIDER=anthropic
```

### 3. Start

```bash
# Start everything: coordinator + both sub-agents + web UI
npm run dev:all

# Backend only (no web UI)
npm run dev:agents

# Kill all ports if something is stuck
npm run kill-ports
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Running in A2A mode

To exercise the real A2A protocol (each agent as a separate process):

```env
ATTRACTIONS_MODE=a2a
ACCOMMODATION_MODE=a2a
```

Then `npm run dev:all` will start all three backend processes. The Coordinator will discover and call sub-agents via JSON-RPC 2.0 over HTTP.

## Project Structure

```
src/
├── agents/
│   ├── coordinatorExecutor.ts   # Orchestration logic
│   ├── attractionsAgent.ts      # Attractions AgentExecutor
│   └── accommodationAgent.ts    # Accommodation AgentExecutor
├── servers/
│   ├── attractionsServer.ts     # Express server :3001
│   └── accommodationServer.ts   # Express server :3002
├── services/
│   ├── llmClient.ts             # AnthropicClient / GeminiClient / factory
│   ├── agentRegistry.ts         # Agent registration, health checks, A2A calls
│   ├── promptStore.ts           # config/prompts.json read/write
│   └── taskStore.ts             # In-memory task state
├── types/
├── utils/
│   └── agentCard.ts
└── index.ts                     # Coordinator entry point

web/
├── src/
│   ├── pages/
│   │   ├── ChatPage.tsx         # Conversation UI
│   │   └── SettingsPage.tsx     # Prompt editor + provider selector
│   └── App.tsx
└── vite.config.ts               # Proxies /api and /message to :3000

config/
└── prompts.json                 # Default prompts for all agents
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_PROVIDER` | `anthropic` or `gemini` | `anthropic` |
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `ANTHROPIC_MODEL` | Claude model ID | `claude-haiku-4-5-20251001` |
| `GEMINI_API_KEY` | Google Gemini API key | — |
| `GEMINI_MODEL` | Gemini model ID | `gemini-2.0-flash` |
| `ATTRACTIONS_MODE` | `api` or `a2a` | `api` |
| `ACCOMMODATION_MODE` | `api` or `a2a` | `api` |
| `ATTRACTIONS_AGENT_URL` | Sub-agent URL (a2a mode) | `http://localhost:3001` |
| `ACCOMMODATION_AGENT_URL` | Sub-agent URL (a2a mode) | `http://localhost:3002` |
| `PORT` | Coordinator port | `3000` |

## API Endpoints (Coordinator)

| Endpoint | Description |
|----------|-------------|
| `GET  /.well-known/agent-card.json` | A2A agent discovery |
| `POST /message/send` | Send a message (synchronous) |
| `GET  /api/prompts` | Get current prompt configuration |
| `PUT  /api/prompts` | Update prompt configuration |

## Roadmap

- [x] Phase 0 — Replace internal SDK with Anthropic SDK; build LLM abstraction layer
- [x] Phase 1 — Real A2A sub-agents with agent-card and health endpoints
- [x] Phase 1.5 — React web UI (chat + settings)
- [x] Phase 1.6 — Multi-provider LLM support (Anthropic + Gemini)
- [ ] Phase 2 — MCP tool integration (Tavily Search, Google Calendar)
- [ ] Phase 3 — SSE streaming for real-time agent progress
- [ ] Phase 4 — Retry logic and cost tracking
- [ ] Phase 5 — Demo polish (architecture diagram, demo GIF)

## License

Apache 2.0
