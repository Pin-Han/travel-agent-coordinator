import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../../docs/prompts");

export interface AgentPrompt {
  system: string;
  user: string;
}

export interface CoordinatorPrompt {
  system: string;
  integration?: string; // deprecated — kept for backward compat; not used by agentic loop
  fallback?: string;    // deprecated
  clarify?: string;     // deprecated
}

export interface Prompts {
  attractions: AgentPrompt;
  accommodation: AgentPrompt;
  transportation: AgentPrompt;
  coordinator: CoordinatorPrompt;
}

// ── Markdown parser ───────────────────────────────────────────────────────────
// Splits a .md file into sections keyed by `## heading`.
// Leading/trailing whitespace is trimmed from each section body.
function parseMdSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = content.split(/^## /m);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    if (newline === -1) continue;
    const key = part.slice(0, newline).trim().toLowerCase();
    const body = part.slice(newline + 1).trim();
    if (key) sections[key] = body;
  }
  return sections;
}

function readAgentPrompt(agentName: string): AgentPrompt {
  const filePath = join(PROMPTS_DIR, `${agentName}.md`);
  if (!existsSync(filePath)) {
    console.warn(`[PromptStore] ${filePath} not found — using empty prompt`);
    return { system: "", user: "" };
  }
  const sections = parseMdSections(readFileSync(filePath, "utf-8"));
  return {
    system: sections["system"] ?? "",
    user: sections["user"] ?? "",
  };
}

function readCoordinatorPrompt(): CoordinatorPrompt {
  const filePath = join(PROMPTS_DIR, "coordinator.md");
  if (!existsSync(filePath)) {
    console.warn(`[PromptStore] coordinator.md not found — using empty prompt`);
    return { system: "", integration: "", fallback: "", clarify: "" };
  }
  const sections = parseMdSections(readFileSync(filePath, "utf-8"));
  return {
    system:      sections["system"]      ?? "",
    integration: sections["integration"] ?? "",
    fallback:    sections["fallback"]    ?? "",
    clarify:     sections["clarify"]     ?? "",
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

// Every call re-reads from disk so all processes see edits immediately.

export function getEvaluatorSystemPrompt(): string {
  const filePath = join(PROMPTS_DIR, "evaluator.md");
  if (!existsSync(filePath)) return "";
  const sections = parseMdSections(readFileSync(filePath, "utf-8"));
  return sections["system"] ?? "";
}

export function getMemoryExtractorSystemPrompt(): string {
  const filePath = join(PROMPTS_DIR, "memory-extractor.md");
  if (!existsSync(filePath)) return "";
  const sections = parseMdSections(readFileSync(filePath, "utf-8"));
  return sections["system"] ?? "";
}

export function getPrompts(): Prompts {
  return {
    attractions:    readAgentPrompt("attractions"),
    accommodation:  readAgentPrompt("accommodation"),
    transportation: readAgentPrompt("transportation"),
    coordinator:    readCoordinatorPrompt(),
  };
}

function writeAgentMd(agentName: string, prompt: AgentPrompt): void {
  const title = agentName.charAt(0).toUpperCase() + agentName.slice(1);
  const content = `# ${title} Agent\n\n## system\n\n${prompt.system}\n\n## user\n\n${prompt.user}\n`;
  writeFileSync(join(PROMPTS_DIR, `${agentName}.md`), content, "utf-8");
}

function writeCoordinatorMd(prompt: CoordinatorPrompt): void {
  const existing = existsSync(join(PROMPTS_DIR, "coordinator.md"))
    ? readFileSync(join(PROMPTS_DIR, "coordinator.md"), "utf-8")
    : "";
  // Preserve the `clarify` section — it's managed by the system, not the UI
  const existingSections = parseMdSections(existing);
  const clarifySectionText = prompt.clarify || existingSections["clarify"] || "";

  const content =
    `# Coordinator\n\n` +
    `## system\n\n${prompt.system}\n\n` +
    `## integration\n\n${prompt.integration}\n\n` +
    `## fallback\n\n${prompt.fallback}\n` +
    (clarifySectionText ? `\n## clarify\n\n${clarifySectionText}\n` : "");
  writeFileSync(join(PROMPTS_DIR, "coordinator.md"), content, "utf-8");
}

export function savePrompts(prompts: Prompts): void {
  if (!existsSync(PROMPTS_DIR)) mkdirSync(PROMPTS_DIR, { recursive: true });
  writeAgentMd("attractions",    prompts.attractions);
  writeAgentMd("accommodation",  prompts.accommodation);
  writeAgentMd("transportation", prompts.transportation);
  writeCoordinatorMd(prompts.coordinator);
  console.log("[PromptStore] docs/prompts/*.md updated");
}
