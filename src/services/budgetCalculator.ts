/**
 * Phase 11: Budget Calculator
 *
 * Pure functions for computing travel cost breakdowns and checking budget compliance.
 * No external dependencies — all inputs come from Phase 10 structured agent outputs.
 */

import type { AttractionItem, AccommodationItem, TransportationOutput } from "./schemaValidator.js";

// ── Input / output types ──────────────────────────────────────────────────────

export interface BudgetCalculationInput {
  destination: string;
  duration_days: number;
  travelers: number;
  budget_usd?: number;

  attractions: AttractionItem[];
  accommodation: AccommodationItem[];
  transportation: TransportationOutput;

  meal_preference?: "budget" | "mid-range" | "fine-dining";
}

export interface CostBreakdown {
  attractions:          { amount: number; note: string };
  accommodation:        { min: number; max: number; note: string };
  meals:                { amount: number; note: string };
  local_transportation: { amount: number; note: string };
  total:                { min: number; max: number };
}

export interface BudgetComplianceResult {
  compliant: boolean;
  severity: "none" | "warning" | "error";
  message?: string;
  suggestion?: string;
}

// ── Trip detail extraction ────────────────────────────────────────────────────

/**
 * Parse travelers count, trip duration, and optional budget from free-form user text.
 * Falls back to safe defaults when no match is found.
 */
export function extractTripDetails(userRequest: string): {
  duration_days: number;
  travelers: number;
  budget_usd?: number;
} {
  // Duration: "4天", "4 days", "4 nights"
  const daysMatch = userRequest.match(/(\d+)\s*(?:天|days?|nights?)/i);
  const duration_days = daysMatch ? Math.max(1, parseInt(daysMatch[1], 10)) : 3;

  // Travelers: "2人", "2 people", "2 travelers"
  const travelersMatch = userRequest.match(/(\d+)\s*(?:人|people|persons?|travelers?|adults?|guests?)/i);
  const travelers = travelersMatch ? Math.max(1, parseInt(travelersMatch[1], 10)) : 1;

  // Budget: "$1000", "1000 USD", "1000美元", "budget 1000"
  const budgetMatch = userRequest.match(
    /(?:\$|USD\s*)(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:USD|美元|dollars?)|(?:budget[:\s]+)(\d[\d,]*)/i
  );
  let budget_usd: number | undefined;
  const rawCapture = budgetMatch ? (budgetMatch[1] ?? budgetMatch[2] ?? budgetMatch[3]) : undefined;
  if (rawCapture) {
    const parsed = parseFloat(rawCapture.replace(/,/g, ""));
    if (!isNaN(parsed) && parsed > 0) budget_usd = parsed;
  }

  return { duration_days, travelers, budget_usd };
}

/**
 * Infer meal preference from stored memory travel-style tags.
 */
export function inferMealPreference(
  travelStyleTags: string[]
): "budget" | "mid-range" | "fine-dining" {
  const lower = travelStyleTags.map((s) => s.toLowerCase());
  if (lower.some((s) => s.includes("fine dining") || s.includes("luxury") || s.includes("精緻") || s.includes("高級"))) {
    return "fine-dining";
  }
  if (lower.some((s) => s.includes("budget") || s.includes("cheap") || s.includes("street food") || s.includes("小吃") || s.includes("背包"))) {
    return "budget";
  }
  return "mid-range";
}

// ── Core calculation ──────────────────────────────────────────────────────────

export function calculateBudgetBreakdown(input: BudgetCalculationInput): CostBreakdown {
  const { attractions, accommodation, transportation, duration_days, travelers, meal_preference } = input;

  // Attractions: sum per-attraction cost × travelers (skip nulls)
  const knownAttractions = attractions.filter((a) => typeof a.estimated_cost_usd === "number");
  const attractionsCost = knownAttractions.reduce(
    (sum, a) => sum + (a.estimated_cost_usd ?? 0) * travelers,
    0
  );
  const attractionsNote = knownAttractions.length > 0
    ? `${knownAttractions.length} 個景點門票（共 ${attractions.length} 個，${attractions.length - knownAttractions.length} 個費用未知）`
    : `${attractions.length} 個景點（費用未知）`;

  // Accommodation: cheapest recommendation × duration_days
  const sorted = [...accommodation].sort(
    (a, b) => a.price_range_usd_per_night.min - b.price_range_usd_per_night.min
  );
  const cheapest = sorted[0];
  const accommodationMin = cheapest ? cheapest.price_range_usd_per_night.min * duration_days : 0;
  const accommodationMax = cheapest ? cheapest.price_range_usd_per_night.max * duration_days : 0;
  const accommodationNote = cheapest
    ? `${duration_days} 晚 × ${cheapest.name}`
    : `${duration_days} 晚（住宿資料不完整）`;

  // Meals: per-person per-day rate × travelers × duration_days
  const mealRates: Record<"budget" | "mid-range" | "fine-dining", number> = {
    budget: 20,
    "mid-range": 45,
    "fine-dining": 100,
  };
  const mealRate = mealRates[meal_preference ?? "mid-range"];
  const mealsCost = mealRate * travelers * duration_days;
  const mealsNote = `每人每天約 $${mealRate}（${meal_preference ?? "mid-range"}）`;

  // Local transportation: sum route costs + pass, per person × travelers
  // Route cost_usd is a per-person cost for one leg — sum them up, then multiply by travelers
  const routeCostPerPerson = (transportation.key_routes ?? []).reduce(
    (sum, r) => sum + (r.cost_usd ?? 0),
    0
  );
  const passCostPerPerson = transportation.recommended_pass?.cost_usd ?? 0;
  const transportationCost = (routeCostPerPerson + passCostPerPerson) * travelers;
  const transportationNote = transportation.recommended_pass
    ? `含 ${transportation.recommended_pass.name}（$${passCostPerPerson}/人）`
    : "市區交通，不含機票";

  return {
    attractions:          { amount: attractionsCost, note: attractionsNote },
    accommodation:        { min: accommodationMin, max: accommodationMax, note: accommodationNote },
    meals:                { amount: mealsCost, note: mealsNote },
    local_transportation: { amount: transportationCost, note: transportationNote },
    total: {
      min: attractionsCost + accommodationMin + mealsCost + transportationCost,
      max: attractionsCost + accommodationMax + mealsCost + transportationCost,
    },
  };
}

// ── Budget compliance sensor ──────────────────────────────────────────────────

export function checkBudgetCompliance(
  breakdown: CostBreakdown,
  userBudget?: number
): BudgetComplianceResult {
  if (!userBudget || userBudget <= 0) {
    return { compliant: true, severity: "none" };
  }

  const { min: totalMin, max: totalMax } = breakdown.total;

  // Entire range is under budget
  if (totalMin <= userBudget) {
    return { compliant: true, severity: "none" };
  }

  const overageMin = totalMin - userBudget;
  const overageMax = totalMax - userBudget;

  // Overage ≤ 20% → warning
  if (overageMin <= userBudget * 0.2) {
    return {
      compliant: false,
      severity: "warning",
      message: `預估費用（$${totalMin}–$${totalMax}）略超出您的 $${userBudget} 預算。最多超出約 $${overageMax}。`,
      suggestion: "可將住宿換成更平價的選項，或減少一天行程。",
    };
  }

  // Overage > 20% → error
  return {
    compliant: false,
    severity: "error",
    message: `預估費用（$${totalMin}–$${totalMax}）明顯超出您的 $${userBudget} 預算。`,
    suggestion: "建議調整住宿等級或縮短行程天數。輸入「換預算住宿」或「縮短一天」調整。",
  };
}

// ── Markdown formatter ────────────────────────────────────────────────────────

export function formatBudgetMarkdown(
  breakdown: CostBreakdown,
  compliance: BudgetComplianceResult,
  travelers: number,
  budget_usd?: number
): string {
  const { attractions, accommodation, meals, local_transportation, total } = breakdown;

  const fmt = (n: number) => `$${Math.round(n)}`;

  const lines: string[] = [
    "",
    "---",
    `## 💰 預估費用（${travelers} 人）`,
    "",
    "| 項目 | 費用 |",
    "|------|------|",
    `| 景點門票 | ~${fmt(attractions.amount)}（${attractions.note}）|`,
    `| 住宿 | ${fmt(accommodation.min)}–${fmt(accommodation.max)}（${accommodation.note}）|`,
    `| 餐飲 | ~${fmt(meals.amount)}（${meals.note}）|`,
    `| 市區交通 | ~${fmt(local_transportation.amount)}（${local_transportation.note}）|`,
    `| **預估總計** | **${fmt(total.min)}–${fmt(total.max)}** |`,
    "",
    "> 不含機票。費用為估算值，實際以當地定價為準。",
  ];

  // Budget compliance block
  if (compliance.severity === "none" && budget_usd) {
    lines.push("", `✅ 符合預算（您的預算：$${budget_usd}）`);
  } else if (compliance.severity === "warning") {
    lines.push(
      "",
      `> ⚠️ **注意**：${compliance.message}`,
      `> ${compliance.suggestion}`
    );
  } else if (compliance.severity === "error") {
    lines.push(
      "",
      `> ❗ **超出預算**：${compliance.message}`,
      `> ${compliance.suggestion}`
    );
  }

  return lines.join("\n");
}
