/**
 * Phase 10: Schema Sensor
 *
 * Hard-validates structured JSON output from each specialist agent.
 * Validation failure triggers a one-shot retry with specific feedback.
 * If the retry also fails, the caller falls back to plain-text mode.
 */

// ── Structured output types ───────────────────────────────────────────────────

export interface AttractionItem {
  name: string;
  area: string;
  category: string;
  recommended_duration_hours: number;
  estimated_cost_usd: number;
  best_time?: string;
  notes?: string;
}

export interface DayGrouping {
  day: number;
  area: string;
  attraction_names: string[];
}

export interface AttractionsOutput {
  area_summary: string;
  attractions: AttractionItem[];
  suggested_day_groupings: DayGrouping[];
}

export interface AccommodationItem {
  name: string;
  area: string;
  price_range_usd_per_night: { min: number; max: number };
  distance_to_attractions: string;
  booking_tip?: string;
}

export interface AccommodationOutput {
  area_summary: string;
  recommendations: AccommodationItem[];
}

export interface RouteItem {
  from: string;
  to: string;
  method: string;
  duration_min: number;
  cost_usd: number;
}

export interface TransportationOutput {
  primary_transit: string;
  recommended_pass?: { name: string; cost_usd: number; notes?: string };
  key_routes: RouteItem[];
  airport_transfer?: { method: string; cost_usd: number; duration_min: number };
}

// ── Validation result ─────────────────────────────────────────────────────────

export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  errors: string[];
}

// ── JSON extraction helper ────────────────────────────────────────────────────

/**
 * Attempt to extract a JSON object from LLM output.
 * Handles code fences (```json ... ```) and bare JSON.
 */
export function extractJSON(text: string): any | null {
  const trimmed = text.trim();

  // Try ```json ... ``` block first
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch {}
  }

  // Try first {...} block
  const braceMatch = trimmed.match(/(\{[\s\S]*\})/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[1]); } catch {}
  }

  // Try raw parse
  try { return JSON.parse(trimmed); } catch {}

  return null;
}

// ── Per-agent validators ──────────────────────────────────────────────────────

export function validateAttractions(raw: string): ValidationResult<AttractionsOutput> {
  const parsed = extractJSON(raw);
  if (!parsed) return { valid: false, errors: ["Response is not valid JSON"] };

  const errors: string[] = [];

  if (typeof parsed.area_summary !== "string" || !parsed.area_summary.trim()) {
    errors.push("Missing required field: area_summary (string)");
  }
  if (!Array.isArray(parsed.attractions) || parsed.attractions.length === 0) {
    errors.push("Missing required field: attractions (non-empty array)");
  } else {
    parsed.attractions.slice(0, 3).forEach((item: any, i: number) => {
      if (!item.name) errors.push(`attractions[${i}].name is required`);
      if (!item.area) errors.push(`attractions[${i}].area is required`);
    });
  }
  if (!Array.isArray(parsed.suggested_day_groupings) || parsed.suggested_day_groupings.length === 0) {
    errors.push("Missing required field: suggested_day_groupings (non-empty array)");
  }

  return errors.length === 0
    ? { valid: true, data: parsed as AttractionsOutput, errors: [] }
    : { valid: false, errors };
}

export function validateAccommodation(raw: string): ValidationResult<AccommodationOutput> {
  const parsed = extractJSON(raw);
  if (!parsed) return { valid: false, errors: ["Response is not valid JSON"] };

  const errors: string[] = [];

  if (typeof parsed.area_summary !== "string" || !parsed.area_summary.trim()) {
    errors.push("Missing required field: area_summary (string)");
  }
  if (!Array.isArray(parsed.recommendations) || parsed.recommendations.length === 0) {
    errors.push("Missing required field: recommendations (non-empty array)");
  } else {
    parsed.recommendations.slice(0, 2).forEach((item: any, i: number) => {
      if (!item.name) errors.push(`recommendations[${i}].name is required`);
      if (!item.area) errors.push(`recommendations[${i}].area is required`);
    });
  }

  return errors.length === 0
    ? { valid: true, data: parsed as AccommodationOutput, errors: [] }
    : { valid: false, errors };
}

export function validateTransportation(raw: string): ValidationResult<TransportationOutput> {
  const parsed = extractJSON(raw);
  if (!parsed) return { valid: false, errors: ["Response is not valid JSON"] };

  const errors: string[] = [];

  if (typeof parsed.primary_transit !== "string" || !parsed.primary_transit.trim()) {
    errors.push("Missing required field: primary_transit (string)");
  }
  if (!Array.isArray(parsed.key_routes) || parsed.key_routes.length === 0) {
    errors.push("Missing required field: key_routes (non-empty array)");
  }

  return errors.length === 0
    ? { valid: true, data: parsed as TransportationOutput, errors: [] }
    : { valid: false, errors };
}

// ── Retry feedback builder ────────────────────────────────────────────────────

export function buildRetryFeedback(agentId: string, errors: string[]): string {
  return (
    `Your previous response was not valid JSON or was missing required fields.\n` +
    `Issues found:\n${errors.map((e) => `- ${e}`).join("\n")}\n\n` +
    `Please respond again with ONLY a valid JSON object. Do not include any explanation, ` +
    `markdown, or text outside the JSON.`
  );
}
