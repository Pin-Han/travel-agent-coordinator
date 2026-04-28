import { useState } from "react";
import type { LogEntry } from "./ChatPage";

const LOGS_KEY = "agent-logs";

function loadLogs(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LOGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function stepOffset(stepIso: string, startIso: string): string {
  const diff = new Date(stepIso).getTime() - new Date(startIso).getTime();
  return `+${(diff / 1000).toFixed(1)}s`;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>(loadLogs);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function clearLogs() {
    localStorage.removeItem(LOGS_KEY);
    setLogs([]);
    setExpanded(new Set());
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b px-6 py-3 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-700">Request Logs</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {logs.length} {logs.length === 1 ? "entry" : "entries"} · stored in browser
          </p>
        </div>
        {logs.length > 0 && (
          <button
            onClick={clearLogs}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            Clear logs
          </button>
        )}
      </div>

      <div className="p-6 max-w-4xl space-y-3">
        {logs.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm">No logs yet.</p>
            <p className="text-xs mt-1">Send a travel request from the Chat page to see logs here.</p>
          </div>
        ) : (
          logs.map((entry) => {
            const isOpen = expanded.has(entry.id);
            return (
              <div
                key={entry.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
              >
                {/* Summary row */}
                <button
                  onClick={() => toggleExpand(entry.id)}
                  className="w-full flex items-start gap-3 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                >
                  <span className="text-gray-400 mt-0.5">{isOpen ? "▼" : "▶"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 font-medium truncate">
                      {entry.userInput}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatTime(entry.timestamp)}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-4 text-xs text-gray-500">
                    <span className="font-mono">{formatDuration(entry.durationMs)}</span>
                    {entry.tokenUsage && (
                      <span className="hidden sm:inline text-gray-400">
                        {(entry.tokenUsage.input + entry.tokenUsage.output).toLocaleString()} tokens
                      </span>
                    )}
                  </div>
                </button>

                {/* Expanded detail */}
                {isOpen && (
                  <div className="border-t border-gray-100 px-5 py-4 bg-gray-50">
                    {/* Token breakdown */}
                    {entry.tokenUsage && (
                      <p className="text-xs text-gray-500 mb-3">
                        Input {entry.tokenUsage.input.toLocaleString()} · Output {entry.tokenUsage.output.toLocaleString()} tokens
                        · Total {formatDuration(entry.durationMs)}
                      </p>
                    )}

                    {/* Step timeline */}
                    {entry.steps.length > 0 ? (
                      <ol className="space-y-1.5">
                        {entry.steps.map((step, i) => (
                          <li key={i} className="flex items-start gap-3 text-xs">
                            <span className="font-mono text-gray-400 shrink-0 w-14 text-right">
                              {stepOffset(step.timestamp, entry.timestamp)}
                            </span>
                            <span className="text-gray-700">{step.text}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-xs text-gray-400">No step details recorded.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
