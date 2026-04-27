import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

interface Message {
  role: "user" | "agent";
  text: string;
  timestamp: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "agent",
      text: "您好！我是旅遊規劃協調 AI。請告訴我您想去哪裡旅遊？（例如：幫我規劃東京 5 天行程，預算 60000 元，喜歡寺廟和美食）",
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setLoading(true);
    setStatus("正在聯絡各 Agent...");

    setMessages((prev) => [
      ...prev,
      { role: "user", text, timestamp: new Date().toISOString() },
    ]);

    try {
      // 從 localStorage 取出目前的 prompt 設定，隨請求帶給後端
      const storedPrompts = localStorage.getItem("agent-prompts");
      const promptOverrides = storedPrompts ? JSON.parse(storedPrompts) : undefined;

      const storedConfig = localStorage.getItem("llm-config");
      const llmConfig = storedConfig ? JSON.parse(storedConfig) : null;
      const provider = llmConfig?.provider || undefined;

      const metadata: Record<string, any> = {};
      if (promptOverrides) metadata.prompts = promptOverrides;
      if (provider) metadata.provider = provider;

      const res = await fetch("/message/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "message/send",
          id: `msg-${Date.now()}`,
          params: {
            message: {
              messageId: `msg-${Date.now()}`,
              role: "user",
              parts: [{ kind: "text", text }],
              kind: "message",
              metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
            },
          },
        }),
      });

      const data = await res.json();

      // 從 A2A Task artifacts 取出回應文字
      const task = data.result;
      const reply =
        task?.artifacts?.[0]?.parts?.[0]?.text ||
        task?.status?.message?.parts?.[0]?.text ||
        "（無法取得回應）";

      setMessages((prev) => [
        ...prev,
        { role: "agent", text: reply, timestamp: new Date().toISOString() },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "agent",
          text: `錯誤：${err.message}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-3 border-b bg-white flex items-center justify-between">
        <h2 className="font-semibold text-gray-700">旅遊規劃對話</h2>
        <span className="text-xs text-gray-400">Coordinator → Attractions + Accommodation</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "agent" && (
              <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center mr-2 mt-1 shrink-0">
                AI
              </div>
            )}
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-tr-sm"
                  : "bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm"
              }`}
            >
              {msg.role === "agent" ? (
                <div className="prose prose-sm max-w-none prose-headings:text-gray-800">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
              ) : (
                msg.text
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center mr-2 shrink-0">
              AI
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-500 shadow-sm">
              <span className="animate-pulse">{status || "思考中..."}</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t bg-white">
        <div className="flex gap-3">
          <input
            className="flex-1 border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="輸入旅遊需求，例如：幫我規劃東京 5 天行程..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-5 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            送出
          </button>
        </div>
      </div>
    </div>
  );
}
