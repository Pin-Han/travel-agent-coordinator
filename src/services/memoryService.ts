import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(__dirname, "../../data/memory");

export interface UserMemory {
  userId: string;
  lastUpdated: string;
  preferences: {
    travelStyle: string[];
    avoids: string[];
    budgetRange: string;
    groupSize: number | null;
    tripLength: string;
  };
  visitedPlaces: string[];
  insights: string[];
}

export interface MemoryInsights {
  newPreferences?: string[];
  visitedPlaces?: string[];
  avoids?: string[];
  generalInsights?: string[];
}

const MAX_INSIGHTS = 20;
const MAX_VISITED = 50;

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

function emptyMemory(userId: string): UserMemory {
  return {
    userId,
    lastUpdated: new Date().toISOString(),
    preferences: {
      travelStyle: [],
      avoids: [],
      budgetRange: "",
      groupSize: null,
      tripLength: "",
    },
    visitedPlaces: [],
    insights: [],
  };
}

function memoryPath(userId: string): string {
  return join(MEMORY_DIR, `${userId}.json`);
}

export class MemoryService {
  constructor() {
    if (!existsSync(MEMORY_DIR)) {
      mkdirSync(MEMORY_DIR, { recursive: true });
    }
  }

  readMemory(userId = "default"): UserMemory {
    const filePath = memoryPath(userId);
    if (!existsSync(filePath)) {
      return emptyMemory(userId);
    }
    try {
      return JSON.parse(readFileSync(filePath, "utf-8")) as UserMemory;
    } catch (err) {
      console.warn(`[MemoryService] Failed to parse ${filePath}:`, err);
      return emptyMemory(userId);
    }
  }

  updateMemory(userId = "default", insights: MemoryInsights): void {
    const memory = this.readMemory(userId);

    if (insights.newPreferences?.length) {
      memory.preferences.travelStyle = dedupe([
        ...memory.preferences.travelStyle,
        ...insights.newPreferences,
      ]);
    }

    if (insights.avoids?.length) {
      memory.preferences.avoids = dedupe([
        ...memory.preferences.avoids,
        ...insights.avoids,
      ]);
    }

    if (insights.visitedPlaces?.length) {
      memory.visitedPlaces = dedupe([
        ...memory.visitedPlaces,
        ...insights.visitedPlaces,
      ]).slice(-MAX_VISITED);
    }

    if (insights.generalInsights?.length) {
      memory.insights = [
        ...memory.insights,
        ...insights.generalInsights,
      ].slice(-MAX_INSIGHTS);
    }

    memory.lastUpdated = new Date().toISOString();
    this.writeSafe(userId, memory);
  }

  clearMemory(userId = "default"): void {
    this.writeSafe(userId, emptyMemory(userId));
  }

  // Atomic write: write to tmp file then rename to prevent partial writes
  private writeSafe(userId: string, data: UserMemory): void {
    if (!existsSync(MEMORY_DIR)) {
      mkdirSync(MEMORY_DIR, { recursive: true });
    }
    const filePath = memoryPath(userId);
    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmpPath, filePath);
  }
}
