import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "../../config/prompts.json");

export interface AgentPrompt {
  system: string;
  user: string;
}

export interface CoordinatorPrompt {
  system: string;
  integration: string;
  fallback: string;
}

export interface Prompts {
  attractions: AgentPrompt;
  accommodation: AgentPrompt;
  coordinator: CoordinatorPrompt;
}

const DEFAULT_PROMPTS: Prompts = {
  attractions: {
    system:
      "你是專業旅遊規劃師，提供詳細且實用的景點推薦，特別注重地理位置資訊以便後續住宿規劃使用。",
    user: "你是一位專業旅遊景點顧問。請根據以下旅遊需求，提供詳細的景點行程規劃：\n\n{request}\n\n請提供：\n1. 每天的景點安排（景點名稱、特色、建議停留時間）\n2. 每個景點所在地區（供住宿規劃參考）\n3. 各景點費用估算\n4. 最佳遊覽動線建議\n\n輸出格式：Markdown，結尾附「景點地區摘要」。\n請用繁體中文回答。",
  },
  accommodation: {
    system:
      "你是專業旅遊住宿規劃師，善用景點位置資訊來推薦最方便、最具性價比的住宿選擇。",
    user: "你是一位專業住宿規劃顧問。請根據以下旅遊需求（包含景點地區資訊），提供最適合的住宿方案：\n\n{request}\n\n請提供：\n1. 推薦住宿選項（2–3 間，含名稱、類型、價格區間、位置優勢）\n2. 依景點分布建議的住宿地區\n3. 各天的交通建議\n4. 訂房注意事項\n\n請用繁體中文回答，格式清晰。",
  },
  coordinator: {
    system:
      "你是一位專業的旅遊規劃協調師，擅長整合各方資訊，產出清晰易讀的旅遊計畫。",
    integration:
      "你是旅遊規劃協調專家。請將以下兩位專家的建議整合成一份完整、連貫的旅遊規劃報告。\n\n用戶需求：{request}\n\n景點推薦專家的建議：\n{attractions}\n\n住宿規劃專家的建議：\n{accommodation}\n\n請整合以上資訊，輸出一份格式清晰的完整旅遊規劃。請用繁體中文回答。",
    fallback:
      "你是一位專業的旅遊規劃師。請根據以下旅遊需求，提供完整的旅遊建議：\n\n{request}\n\n請包含景點、住宿、交通、預算估算。請用繁體中文回答，格式清晰易讀。",
  },
};

function loadFromFile(): Partial<Prompts> {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch {
    console.warn("[PromptStore] 無法讀取 prompts.json，使用預設值");
  }
  return {};
}

// 合併 file config 與 defaults（file 優先）
function merge(defaults: Prompts, overrides: Partial<Prompts>): Prompts {
  return {
    attractions: { ...defaults.attractions, ...overrides.attractions },
    accommodation: { ...defaults.accommodation, ...overrides.accommodation },
    coordinator: { ...defaults.coordinator, ...overrides.coordinator },
  };
}

// 每次呼叫都讀 file，確保多 process 間即時同步
export function getPrompts(): Prompts {
  return merge(DEFAULT_PROMPTS, loadFromFile());
}

export function savePrompts(prompts: Prompts): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(prompts, null, 2), "utf-8");
  console.log("[PromptStore] prompts.json 已更新");
}
