import { useEffect, useState } from "react";

interface AgentPrompt {
  system: string;
  user: string;
}

interface CoordinatorPrompt {
  system: string;
  integration?: string;
  fallback?: string;
}

interface TransportationPrompt {
  system: string;
  user: string;
}

interface Prompts {
  attractions: AgentPrompt;
  accommodation: AgentPrompt;
  transportation: TransportationPrompt;
  coordinator: CoordinatorPrompt;
}

interface LLMConfig {
  provider: "anthropic" | "gemini";
}

const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: "anthropic",
};

const LABELS: Record<string, string> = {
  system: "System Prompt (role definition)",
  user: "User Prompt (task template — {request} is replaced with the user's input)",
  integration:
    "Integration Prompt (variables: {request}, {attractions}, {accommodation}, {transportation})",
  fallback: "Fallback Prompt (variable: {request} — used when all sub-agents fail)",
};

const AGENT_NAMES: Record<string, string> = {
  attractions: "🗺️ Attractions Agent",
  accommodation: "🏨 Accommodation Agent",
  transportation: "🚇 Transportation Agent",
  coordinator: "🎯 Coordinator (synthesis layer)",
};

// Fields managed by the system or deprecated — hidden from the UI editor
const HIDDEN_FIELDS = new Set(["clarify", "integration", "fallback"]);

export default function SettingsPage() {
  const [prompts, setPrompts] = useState<Prompts | null>(null);
  const [llmConfig, setLLMConfig] = useState<LLMConfig>(DEFAULT_LLM_CONFIG);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Load LLM config from localStorage
    const storedConfig = localStorage.getItem("llm-config");
    if (storedConfig) {
      try {
        setLLMConfig({ ...DEFAULT_LLM_CONFIG, ...JSON.parse(storedConfig) });
      } catch {}
    }

    // Load prompts: localStorage first, fallback to backend
    const stored = localStorage.getItem("agent-prompts");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Evict stale cache if it's missing required agents added in later versions
        if (parsed && parsed.transportation) {
          setPrompts(parsed);
          return;
        }
      } catch {}
      localStorage.removeItem("agent-prompts");
    }
    fetch("/api/prompts")
      .then((r) => r.json())
      .then((data) => {
        setPrompts(data);
        localStorage.setItem("agent-prompts", JSON.stringify(data));
      })
      .catch(() => setError("Failed to load default settings. Make sure the Coordinator server is running."));
  }, []);

  function handleChange(agent: keyof Prompts, field: string, value: string) {
    if (!prompts) return;
    setPrompts({ ...prompts, [agent]: { ...prompts[agent], [field]: value } });
  }

  function handleSave() {
    if (!prompts) return;
    setSaving(true);
    try {
      localStorage.setItem("agent-prompts", JSON.stringify(prompts));
      localStorage.setItem("llm-config", JSON.stringify(llmConfig));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <div className="p-8 text-red-600 bg-red-50 m-6 rounded-xl border border-red-200">
        {error}
      </div>
    );
  }

  if (!prompts) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b px-6 py-3 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-700">Settings</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Changes are saved to your browser and take effect on the next request.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          {saving ? "Saving..." : saved ? "✓ Saved" : "Save"}
        </button>
      </div>

      <div className="p-6 space-y-8 max-w-4xl">
        {/* LLM Provider Section */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b bg-gray-50">
            <h3 className="font-semibold text-gray-800">🤖 AI Model</h3>
          </div>
          <div className="p-5 space-y-5">
            {/* Provider selection */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">
                AI Provider
              </label>
              <div className="flex gap-4">
                {(["anthropic", "gemini"] as const).map((p) => (
                  <label
                    key={p}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                      llmConfig.provider === p
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 hover:bg-gray-50 text-gray-600"
                    }`}
                  >
                    <input
                      type="radio"
                      name="provider"
                      value={p}
                      checked={llmConfig.provider === p}
                      onChange={() =>
                        setLLMConfig((c) => ({ ...c, provider: p }))
                      }
                      className="accent-blue-600"
                    />
                    <span className="text-sm font-medium capitalize">{p === "anthropic" ? "Anthropic (Claude)" : "Google (Gemini)"}</span>
                  </label>
                ))}
              </div>
            </div>

            <p className="text-xs text-gray-400 mt-1">
              The selected provider is sent with each request. API keys must be set in the server's{" "}
              <code className="font-mono bg-gray-100 px-1 rounded">.env</code>{" "}
              file (<code className="font-mono bg-gray-100 px-1 rounded">ANTHROPIC_API_KEY</code> or{" "}
              <code className="font-mono bg-gray-100 px-1 rounded">GEMINI_API_KEY</code>).
            </p>
          </div>
        </section>

        {/* Prompt Settings */}
        {(Object.keys(AGENT_NAMES) as Array<keyof Prompts>).map((agent) => (
          <section key={agent} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b bg-gray-50">
              <h3 className="font-semibold text-gray-800">
                {AGENT_NAMES[agent]}
              </h3>
            </div>
            <div className="p-5 space-y-5">
              {Object.entries(prompts[agent] ?? {}).filter(([field]) => !HIDDEN_FIELDS.has(field)).map(([field, value]) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">
                    {LABELS[field] || field}
                  </label>
                  <textarea
                    rows={field === "system" ? 2 : 8}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                    value={value as string}
                    onChange={(e) =>
                      handleChange(agent, field, e.target.value)
                    }
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
