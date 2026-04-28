import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAVILY_SERVER_PATH = join(__dirname, "../../node_modules/tavily-mcp/build/index.js");

/**
 * Singleton MCP client for Tavily Search.
 * Connects once per process, reused across all requests.
 */
export class TavilyMCPClient {
  private static instance: TavilyMCPClient | null = null;
  private client: Client | null = null;
  private connectingPromise: Promise<void> | null = null;

  static getInstance(): TavilyMCPClient {
    if (!TavilyMCPClient.instance) {
      TavilyMCPClient.instance = new TavilyMCPClient();
    }
    return TavilyMCPClient.instance;
  }

  /** Returns true if TAVILY_API_KEY is set */
  static isAvailable(): boolean {
    return !!process.env.TAVILY_API_KEY;
  }

  private async ensureConnected(): Promise<void> {
    if (this.client) return;
    if (this.connectingPromise) return this.connectingPromise;

    this.connectingPromise = this._connect().finally(() => {
      this.connectingPromise = null;
    });
    return this.connectingPromise;
  }

  private async _connect(): Promise<void> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error("TAVILY_API_KEY is not set");

    this.client = new Client({ name: "travel-agent", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [TAVILY_SERVER_PATH],
      env: { ...process.env, TAVILY_API_KEY: apiKey },
    });

    transport.onclose = () => {
      console.log("[MCP] Tavily transport closed, will reconnect on next call");
      this.client = null;
    };

    await this.client.connect(transport);
    console.log("[MCP] Tavily MCP client connected");
  }

  /**
   * Run a web search via Tavily MCP.
   * Falls back gracefully if the key is missing or the call fails.
   */
  async search(query: string, maxResults: number = 5): Promise<string | null> {
    if (!TavilyMCPClient.isAvailable()) return null;

    try {
      await this.ensureConnected();
      console.log(`[MCP] tool=tavily_search query="${query}"`);

      const result = await this.client!.callTool({
        name: "tavily_search",
        arguments: { query, max_results: maxResults },
      });

      return this.extractText(result);
    } catch (err) {
      console.error("[MCP] Tavily search failed:", err);
      this.client = null; // force reconnect next time
      return null;
    }
  }

  private extractText(result: unknown): string {
    const r = result as any;
    if (r?.content && Array.isArray(r.content)) {
      return r.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text as string)
        .join("\n\n");
    }
    return typeof result === "string" ? result : JSON.stringify(result);
  }
}
