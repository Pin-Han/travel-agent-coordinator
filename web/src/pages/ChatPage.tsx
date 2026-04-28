import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

interface Message {
  id: string;
  role: "user" | "agent" | "error";
  text: string;
  timestamp: string;
  tokenUsage?: { input: number; output: number };
  durationMs?: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  userInput: string;
  durationMs: number;
  steps: { text: string; timestamp: string }[];
  tokenUsage?: { input: number; output: number };
}

const WELCOME: Message = {
  id: "welcome",
  role: "agent",
  text: "Hi! I'm your AI travel planning coordinator. Where would you like to go?\n\n**Try:** *Plan me a 4-day Tokyo trip, budget $1000, interested in temples and food, 2 people*",
  timestamp: new Date().toISOString(),
};

const STORAGE_KEY = "chat-history";
const LOGS_KEY = "agent-logs";
const MAX_MESSAGES = 100;
const MAX_LOGS = 50;

function loadHistory(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [WELCOME];
}

function saveLogEntry(entry: LogEntry) {
  try {
    const raw = localStorage.getItem(LOGS_KEY);
    const logs: LogEntry[] = raw ? JSON.parse(raw) : [];
    const updated = [entry, ...logs].slice(0, MAX_LOGS);
    localStorage.setItem(LOGS_KEY, JSON.stringify(updated));
  } catch {}
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <button
      onClick={handleCopy}
      className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors mt-1 ml-1 flex items-center gap-1"
    >
      {copied ? (
        <>
          <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-green-500">Copied!</span>
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

function ProgressIndicator({ status }: { status: string }) {
  return (
    <div className="flex justify-start">
      <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center mr-2 mt-1 shrink-0">
        AI
      </div>
      <div className="bg-white border border-blue-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm shadow-sm">
        <div className="flex items-center gap-2 text-blue-600">
          <svg className="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span className="text-gray-700">{status || "Planning your trip..."}</span>
        </div>
      </div>
    </div>
  );
}

const CONTEXT_KEY = "conversation-context-id";

function loadContextId(): string {
  try {
    const stored = localStorage.getItem(CONTEXT_KEY);
    if (stored) return stored;
  } catch {}
  const id = crypto.randomUUID();
  try { localStorage.setItem(CONTEXT_KEY, id); } catch {}
  return id;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>(loadHistory);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState("");
  const [sessionTokens, setSessionTokens] = useState(0);
  const [contextId, setContextId] = useState<string>(loadContextId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, currentStatus]);

  function clearConversation() {
    const newId = crypto.randomUUID();
    setContextId(newId);
    try { localStorage.setItem(CONTEXT_KEY, newId); } catch {}
    setMessages([WELCOME]);
    setSessionTokens(0);
    setCurrentStatus("");
    localStorage.removeItem(STORAGE_KEY);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setLoading(true);
    setCurrentStatus("");

    const startTime = Date.now();
    const logSteps: { text: string; timestamp: string }[] = [];

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const storedPrompts = localStorage.getItem("agent-prompts");
      const promptOverrides = storedPrompts ? JSON.parse(storedPrompts) : undefined;

      const storedConfig = localStorage.getItem("llm-config");
      const llmConfig = storedConfig ? JSON.parse(storedConfig) : null;
      const provider = llmConfig?.provider || undefined;

      const metadata: Record<string, any> = {};
      if (promptOverrides) metadata.prompts = promptOverrides;
      if (provider) metadata.provider = provider;

      const res = await fetch("/message/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "message/stream",
          id: `msg-${Date.now()}`,
          params: {
            message: {
              messageId: `msg-${Date.now()}`,
              role: "user",
              parts: [{ kind: "text", text }],
              kind: "message",
              contextId,
              metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
            },
          },
        }),
      });

      if (!res.ok) {
        throw new Error("The server couldn't process your request. Please try again.");
      }

      const contentType = res.headers.get("content-type") || "";

      // ── SSE streaming path ──────────────────────────────────────────────────
      if (contentType.includes("text/event-stream")) {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalText = "";
        let tokenUsage: Message["tokenUsage"] | undefined;

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let parsed: any;
            try {
              parsed = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            const event = parsed?.result;
            if (!event) continue;

            const kind: string = event.kind;

            if (kind === "status-update") {
              const msg: string | undefined = event.status?.message?.parts?.[0]?.text;
              if (msg) {
                setCurrentStatus(msg);
                logSteps.push({ text: msg, timestamp: new Date().toISOString() });
              }
              if (event.final) break outer;
            } else if (kind === "artifact-update") {
              const txt: string | undefined = event.artifact?.parts?.[0]?.text;
              if (txt) finalText = txt;
              const usage = event.artifact?.metadata?.tokenUsage;
              if (usage) {
                tokenUsage = { input: usage.inputTokens, output: usage.outputTokens };
                setSessionTokens((prev) => prev + usage.inputTokens + usage.outputTokens);
              }
            }
          }
        }

        const durationMs = Date.now() - startTime;

        // Save to log
        saveLogEntry({
          id: crypto.randomUUID(),
          timestamp: userMsg.timestamp,
          userInput: text,
          durationMs,
          steps: logSteps,
          tokenUsage,
        });

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "agent",
            text: finalText || "(No response received)",
            timestamp: new Date().toISOString(),
            tokenUsage,
            durationMs,
          },
        ]);
        return;
      }

      // ── Fallback: plain JSON (non-streaming) ────────────────────────────────
      const data = await res.json();
      const task = data.result;
      const reply =
        task?.artifacts?.[0]?.parts?.[0]?.text ||
        task?.status?.message?.parts?.[0]?.text ||
        "(No response received)";

      const durationMs = Date.now() - startTime;
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "agent",
          text: reply,
          timestamp: new Date().toISOString(),
          durationMs,
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "error",
          text: err.message || "Something went wrong. Please try again.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
      setCurrentStatus("");
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 border-b bg-white flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-700">Travel Planner</h2>
          <p className="text-xs text-gray-400 hidden sm:block">Agentic Coordinator · Attractions + Accommodation + Transportation</p>
        </div>
        <div className="flex items-center gap-3">
          {sessionTokens > 0 && (
            <span className="text-xs text-gray-400 hidden sm:inline">
              Session: {sessionTokens.toLocaleString()} tokens
            </span>
          )}
          <button
            onClick={clearConversation}
            disabled={loading}
            className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-40 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {(msg.role === "agent" || msg.role === "error") && (
              <div className={`w-7 h-7 rounded-full text-white text-xs flex items-center justify-center mr-2 mt-1 shrink-0 ${
                msg.role === "error" ? "bg-red-500" : "bg-blue-600"
              }`}>
                {msg.role === "error" ? "!" : "AI"}
              </div>
            )}
            <div className="flex flex-col max-w-[85%] sm:max-w-[75%]">
              <div
                className={`rounded-2xl px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-tr-sm"
                    : msg.role === "error"
                    ? "bg-red-50 border border-red-200 text-red-700 rounded-tl-sm"
                    : "bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm"
                }`}
              >
                {msg.role === "agent" ? (
                  <div className="prose prose-sm max-w-none prose-headings:text-gray-800 prose-headings:font-semibold prose-h2:text-base prose-h3:text-sm">
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                  </div>
                ) : msg.role === "error" ? (
                  <div className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                    {msg.text}
                  </div>
                ) : (
                  msg.text
                )}
              </div>
              {msg.role === "agent" && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[11px] text-gray-400 mt-1 ml-1">
                    {msg.durationMs != null && `${(msg.durationMs / 1000).toFixed(1)}s`}
                    {msg.durationMs != null && msg.tokenUsage && " · "}
                    {msg.tokenUsage && `Input ${msg.tokenUsage.input.toLocaleString()} · Output ${msg.tokenUsage.output.toLocaleString()} tokens`}
                  </span>
                  <CopyButton text={msg.text} />
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Single-line progress indicator while loading */}
        {loading && <ProgressIndicator status={currentStatus} />}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 sm:px-6 py-4 border-t bg-white">
        <div className="flex gap-2 sm:gap-3">
          <input
            className="flex-1 min-w-0 border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Describe your trip..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-4 sm:px-5 py-2 rounded-xl text-sm font-medium transition-colors shrink-0"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
