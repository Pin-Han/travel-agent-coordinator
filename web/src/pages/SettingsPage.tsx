import { useEffect, useState } from "react";

interface AgentPrompt {
  system: string;
  user: string;
}

interface CoordinatorPrompt {
  system: string;
  integration: string;
  fallback: string;
}

interface Prompts {
  attractions: AgentPrompt;
  accommodation: AgentPrompt;
  coordinator: CoordinatorPrompt;
}

interface LLMConfig {
  provider: "anthropic" | "gemini";
}

const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: "anthropic",
};

const LABELS: Record<string, string> = {
  system: "System Prompt（角色設定）",
  user: "User Prompt（任務指令，{request} 會被替換為使用者需求）",
  integration:
    "整合 Prompt（{request}、{attractions}、{accommodation} 為變數）",
  fallback: "備用 Prompt（{request} 為變數，當 Sub-agent 全失敗時使用）",
};

const AGENT_NAMES: Record<string, string> = {
  attractions: "🗺️ Attractions Agent（景點推薦）",
  accommodation: "🏨 Accommodation Agent（住宿規劃）",
  coordinator: "🎯 Coordinator（整合層）",
};

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
        setPrompts(JSON.parse(stored));
        return;
      } catch {}
    }
    fetch("/api/prompts")
      .then((r) => r.json())
      .then((data) => {
        setPrompts(data);
        localStorage.setItem("agent-prompts", JSON.stringify(data));
      })
      .catch(() => setError("無法載入預設設定，請確認 Coordinator 已啟動。"));
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
        載入中...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b px-6 py-3 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-700">設定</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            修改後按「儲存」，設定存於瀏覽器本機，下次請求即生效
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          {saving ? "儲存中..." : saved ? "✓ 已儲存" : "儲存"}
        </button>
      </div>

      <div className="p-6 space-y-8 max-w-4xl">
        {/* LLM Provider Section */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b bg-gray-50">
            <h3 className="font-semibold text-gray-800">🤖 AI 模型設定</h3>
          </div>
          <div className="p-5 space-y-5">
            {/* Provider selection */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">
                選擇 AI 提供商
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
              選擇的提供商會隨請求傳給後端。API Key 需設定在伺服器的{" "}
              <code className="font-mono bg-gray-100 px-1 rounded">.env</code>{" "}
              檔案中（<code className="font-mono bg-gray-100 px-1 rounded">ANTHROPIC_API_KEY</code> 或{" "}
              <code className="font-mono bg-gray-100 px-1 rounded">GEMINI_API_KEY</code>）。
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
              {Object.entries(prompts[agent]).map(([field, value]) => (
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
