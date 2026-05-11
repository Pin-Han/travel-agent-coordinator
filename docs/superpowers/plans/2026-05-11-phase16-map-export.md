# Phase 16: Map Visualization + Itinerary Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive Leaflet map showing attraction/accommodation locations, plus .ics calendar and JSON export.

**Architecture:** Modify agent prompts to include lat/lng in structured output → validate coordinates in schemaValidator → build MapData in orchestratorExecutor → render Leaflet map in new MapPanel component → add ExportMenu for .ics and JSON copy → split ChatPage layout for desktop/mobile.

**Tech Stack:** Leaflet, react-leaflet, OpenStreetMap tiles (zero API key)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `docs/prompts/attractions.md` | Modify | Add lat/lng to JSON schema |
| `docs/prompts/accommodation.md` | Modify | Add lat/lng to JSON schema |
| `src/services/schemaValidator.ts` | Modify | Add lat/lng to interfaces + validation |
| `src/agents/orchestratorExecutor.ts` | Modify | Add buildMapData() + attach to artifact metadata |
| `web/src/components/MapPanel.tsx` | Create | Leaflet map with markers + popups + routes |
| `web/src/components/ExportMenu.tsx` | Create | .ics download + JSON copy dropdown |
| `web/src/pages/ChatPage.tsx` | Modify | Split layout, parse mapData, wire MapPanel + ExportMenu |
| `web/package.json` | Modify | Add leaflet + react-leaflet deps |

---

### Task 1: Add lat/lng to Agent Prompts

**Files:**
- Modify: `docs/prompts/attractions.md`
- Modify: `docs/prompts/accommodation.md`

- [ ] **Step 1: Update attractions prompt schema**

In `docs/prompts/attractions.md`, add `lat` and `lng` fields to the attraction item schema. Replace the existing attraction object in the schema block:

```json
{
  "name": "<attraction name>",
  "lat": <number, latitude e.g. 35.7148>,
  "lng": <number, longitude e.g. 139.7967>,
  "area": "<district or neighborhood>",
  "category": "<temple|museum|park|shopping|food|entertainment|other>",
  "recommended_duration_hours": <number>,
  "estimated_cost_usd": <number, use 0 if free>,
  "best_time": "<optional: best time of day or season to visit>",
  "notes": "<optional: must-know tips or highlights>"
}
```

Also add to the Rules section:
```
- lat/lng must be realistic coordinates for the attraction (used for map display)
```

- [ ] **Step 2: Update accommodation prompt schema**

In `docs/prompts/accommodation.md`, add `lat` and `lng` fields to the recommendation item schema. Replace the existing recommendation object:

```json
{
  "name": "<hotel or accommodation name>",
  "lat": <number, latitude e.g. 35.6938>,
  "lng": <number, longitude e.g. 139.7010>,
  "area": "<district or neighborhood>",
  "price_range_usd_per_night": { "min": <number>, "max": <number> },
  "distance_to_attractions": "<e.g. '10 min walk to Shinjuku Gyoen'>",
  "booking_tip": "<optional: peak season advice, cancellation policy, etc.>"
}
```

Also add to the Rules section:
```
- lat/lng must be realistic coordinates for the accommodation (used for map display)
```

- [ ] **Step 3: Commit**

```bash
git add docs/prompts/attractions.md docs/prompts/accommodation.md
git commit -m "feat(phase16): add lat/lng to attractions and accommodation prompt schemas"
```

---

### Task 2: Update Schema Validator

**Files:**
- Modify: `src/services/schemaValidator.ts`

- [ ] **Step 1: Add lat/lng to interfaces**

In `src/services/schemaValidator.ts`, add `lat` and `lng` to `AttractionItem` (after line 12) and `AccommodationItem` (after line 34):

```typescript
export interface AttractionItem {
  name: string;
  lat: number;
  lng: number;
  area: string;
  category: string;
  recommended_duration_hours: number;
  estimated_cost_usd: number;
  best_time?: string;
  notes?: string;
}
```

```typescript
export interface AccommodationItem {
  name: string;
  lat: number;
  lng: number;
  area: string;
  price_range_usd_per_night: { min: number; max: number };
  distance_to_attractions: string;
  booking_tip?: string;
}
```

- [ ] **Step 2: Add coordinate validation to validateAttractions**

Inside `validateAttractions()`, in the `parsed.attractions.slice(0, 3).forEach(...)` block (around line 110), add after the `!item.area` check:

```typescript
if (typeof item.lat !== "number" || item.lat < -90 || item.lat > 90) {
  errors.push(`attractions[${i}].lat must be a number between -90 and 90`);
}
if (typeof item.lng !== "number" || item.lng < -180 || item.lng > 180) {
  errors.push(`attractions[${i}].lng must be a number between -180 and 180`);
}
```

- [ ] **Step 3: Add coordinate validation to validateAccommodation**

Inside `validateAccommodation()`, in the `parsed.recommendations.slice(0, 2).forEach(...)` block (around line 136), add after the `!item.area` check:

```typescript
if (typeof item.lat !== "number" || item.lat < -90 || item.lat > 90) {
  errors.push(`recommendations[${i}].lat must be a number between -90 and 90`);
}
if (typeof item.lng !== "number" || item.lng < -180 || item.lng > 180) {
  errors.push(`recommendations[${i}].lng must be a number between -180 and 180`);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/services/schemaValidator.ts
git commit -m "feat(phase16): validate lat/lng coordinates in schema validator"
```

---

### Task 3: Build MapData in Orchestrator

**Files:**
- Modify: `src/agents/orchestratorExecutor.ts`

- [ ] **Step 1: Add MapData types**

At the top of `src/agents/orchestratorExecutor.ts`, after the existing imports and before the `contexts` Map declaration (line 39), add:

```typescript
// ── MapData types (Phase 16) ─────────────────────────────────────────────────

interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  type: "attraction" | "accommodation";
  label: string;
  day?: number;
  popup: {
    title: string;
    description: string;
    cost?: string;
  };
}

interface MapRoute {
  from: string;
  to: string;
  method: string;
  duration_min: number;
}

interface MapData {
  center: { lat: number; lng: number };
  zoom: number;
  markers: MapMarker[];
  routes: MapRoute[];
}
```

- [ ] **Step 2: Add buildMapData() method**

Add a new private method to the `TravelOrchestratorExecutor` class, after the `calculateAndAppendBudget` method (after line 545):

```typescript
// ─── Map data generation ──────────────────────────────────────────────────────

/**
 * Builds MapData from structured agent results.
 * Returns null if no valid markers can be created.
 */
private buildMapData(structuredResults: Map<string, any>): MapData | null {
  try {
    const markers: MapMarker[] = [];

    // Extract attraction markers
    const attractionsData = structuredResults.get("attractions") as AttractionsOutput | undefined;
    if (attractionsData?.attractions) {
      // Build day lookup from suggested_day_groupings
      const dayLookup = new Map<string, number>();
      for (const group of attractionsData.suggested_day_groupings ?? []) {
        for (const name of group.attraction_names) {
          dayLookup.set(name, group.day);
        }
      }

      for (const item of attractionsData.attractions) {
        if (typeof item.lat !== "number" || typeof item.lng !== "number") continue;
        if (item.lat < -90 || item.lat > 90 || item.lng < -180 || item.lng > 180) {
          console.warn(`[MapData] Skipping attraction "${item.name}" — coordinates out of range (${item.lat}, ${item.lng})`);
          continue;
        }
        markers.push({
          id: `attr-${markers.length}`,
          lat: item.lat,
          lng: item.lng,
          type: "attraction",
          label: item.name,
          day: dayLookup.get(item.name),
          popup: {
            title: item.name,
            description: `${item.category} · ${item.area}`,
            cost: item.estimated_cost_usd > 0 ? `$${item.estimated_cost_usd}` : "Free",
          },
        });
      }
    }

    // Extract accommodation markers
    const accommodationData = structuredResults.get("accommodation") as AccommodationOutput | undefined;
    if (accommodationData?.recommendations) {
      for (const item of accommodationData.recommendations) {
        if (typeof item.lat !== "number" || typeof item.lng !== "number") continue;
        if (item.lat < -90 || item.lat > 90 || item.lng < -180 || item.lng > 180) {
          console.warn(`[MapData] Skipping accommodation "${item.name}" — coordinates out of range (${item.lat}, ${item.lng})`);
          continue;
        }
        markers.push({
          id: `accom-${markers.length}`,
          lat: item.lat,
          lng: item.lng,
          type: "accommodation",
          label: item.name,
          popup: {
            title: item.name,
            description: item.area,
            cost: `$${item.price_range_usd_per_night.min}–$${item.price_range_usd_per_night.max}/night`,
          },
        });
      }
    }

    if (markers.length === 0) return null;

    // Calculate center (average of all markers)
    const avgLat = markers.reduce((sum, m) => sum + m.lat, 0) / markers.length;
    const avgLng = markers.reduce((sum, m) => sum + m.lng, 0) / markers.length;

    // Extract routes from transportation data
    const routes: MapRoute[] = [];
    const transportationData = structuredResults.get("transportation") as TransportationOutput | undefined;
    if (transportationData?.key_routes) {
      for (const route of transportationData.key_routes) {
        routes.push({
          from: route.from,
          to: route.to,
          method: route.method,
          duration_min: route.duration_min,
        });
      }
    }

    console.log(`[MapData] Built map data: ${markers.length} markers, ${routes.length} routes`);

    return {
      center: { lat: avgLat, lng: avgLng },
      zoom: 12,
      markers,
      routes,
    };
  } catch (err) {
    console.warn("[MapData] buildMapData failed:", err);
    return null;
  }
}
```

- [ ] **Step 3: Attach mapData to artifact in publishFinalPlan**

In `publishFinalPlan()` (line 724), modify the method signature to accept `mapData`:

Change the method signature from:
```typescript
private async publishFinalPlan(
  taskId: string,
  contextId: string,
  finalText: string,
  tokenUsage: { inputTokens: number; outputTokens: number; breakdown: any[] },
  history: Message[],
  eventBus: ExecutionEventBus
): Promise<void> {
```
to:
```typescript
private async publishFinalPlan(
  taskId: string,
  contextId: string,
  finalText: string,
  tokenUsage: { inputTokens: number; outputTokens: number; breakdown: any[] },
  history: Message[],
  eventBus: ExecutionEventBus,
  mapData?: MapData | null
): Promise<void> {
```

Change the artifact metadata (line 737) from:
```typescript
metadata: { tokenUsage },
```
to:
```typescript
metadata: { tokenUsage, ...(mapData ? { mapData } : {}) },
```

- [ ] **Step 4: Call buildMapData in processCoordination**

In `processCoordination()`, between the budget calculation (line 221) and the publishFinalPlan call (line 224), add:

```typescript
// Build map data from structured results (Phase 16) — non-blocking on failure
const mapData = this.buildMapData(loopResult.structuredResults);
```

And update the publishFinalPlan call to pass mapData:

Change from:
```typescript
await this.publishFinalPlan(taskId, contextId, finalText, loopResult.tokenUsage, history, eventBus);
```
to:
```typescript
await this.publishFinalPlan(taskId, contextId, finalText, loopResult.tokenUsage, history, eventBus, mapData);
```

- [ ] **Step 5: Commit**

```bash
git add src/agents/orchestratorExecutor.ts
git commit -m "feat(phase16): build MapData from structured agent results"
```

---

### Task 4: Install Frontend Dependencies

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install leaflet + react-leaflet**

```bash
cd web && npm install leaflet react-leaflet && npm install -D @types/leaflet && cd ..
```

- [ ] **Step 2: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "feat(phase16): add leaflet and react-leaflet dependencies"
```

---

### Task 5: Create MapPanel Component

**Files:**
- Create: `web/src/components/MapPanel.tsx`

- [ ] **Step 1: Create MapPanel.tsx**

Create `web/src/components/MapPanel.tsx`:

```tsx
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  type: "attraction" | "accommodation";
  label: string;
  day?: number;
  popup: {
    title: string;
    description: string;
    cost?: string;
  };
}

interface MapRoute {
  from: string;
  to: string;
  method: string;
  duration_min: number;
}

export interface MapData {
  center: { lat: number; lng: number };
  zoom: number;
  markers: MapMarker[];
  routes: MapRoute[];
}

const ATTRACTION_COLOR = "#3b82f6"; // blue-500
const ACCOMMODATION_COLOR = "#f97316"; // orange-500

function createMarkerIcon(type: "attraction" | "accommodation"): L.DivIcon {
  const color = type === "attraction" ? ATTRACTION_COLOR : ACCOMMODATION_COLOR;
  const emoji = type === "attraction" ? "📍" : "🏨";
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="background:${color};color:white;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 6px rgba(0,0,0,0.3);border:2px solid white;">${emoji}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  });
}

export default function MapPanel({ mapData }: { mapData: MapData }) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up previous map instance
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(containerRef.current).setView(
      [mapData.center.lat, mapData.center.lng],
      mapData.zoom
    );
    mapRef.current = map;

    // OpenStreetMap tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    // Add markers
    const bounds: L.LatLngExpression[] = [];

    for (const marker of mapData.markers) {
      const icon = createMarkerIcon(marker.type);
      const popupContent = [
        `<strong>${marker.popup.title}</strong>`,
        marker.popup.description,
        marker.popup.cost ? `<em>${marker.popup.cost}</em>` : "",
        marker.day ? `<span style="color:#6b7280;">Day ${marker.day}</span>` : "",
      ]
        .filter(Boolean)
        .join("<br/>");

      L.marker([marker.lat, marker.lng], { icon })
        .bindPopup(popupContent)
        .addTo(map);

      bounds.push([marker.lat, marker.lng]);
    }

    // Draw route lines (match from/to by marker label)
    const markerLookup = new Map(
      mapData.markers.map((m) => [m.label.toLowerCase(), { lat: m.lat, lng: m.lng }])
    );

    for (const route of mapData.routes) {
      const fromPos = markerLookup.get(route.from.toLowerCase());
      const toPos = markerLookup.get(route.to.toLowerCase());
      if (fromPos && toPos) {
        L.polyline(
          [
            [fromPos.lat, fromPos.lng],
            [toPos.lat, toPos.lng],
          ],
          { color: "#6b7280", weight: 2, dashArray: "6 4", opacity: 0.7 }
        )
          .bindPopup(`${route.method} · ${route.duration_min} min`)
          .addTo(map);
      }
    }

    // Fit bounds if we have markers
    if (bounds.length > 1) {
      map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [40, 40] });
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapData]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full rounded-lg overflow-hidden"
      style={{ minHeight: "300px" }}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/MapPanel.tsx
git commit -m "feat(phase16): add MapPanel component with Leaflet + OpenStreetMap"
```

---

### Task 6: Create ExportMenu Component

**Files:**
- Create: `web/src/components/ExportMenu.tsx`

- [ ] **Step 1: Create ExportMenu.tsx**

Create `web/src/components/ExportMenu.tsx`:

```tsx
import { useState } from "react";

interface ExportMenuProps {
  structuredData: any;
  planText: string;
}

function generateICS(structuredData: any, startDate: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TravelAgent//EN",
    "CALSCALE:GREGORIAN",
  ];

  const attractions = structuredData?.attractions;
  const dayGroupings = attractions?.suggested_day_groupings ?? [];

  for (const group of dayGroupings) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + (group.day - 1));
    const dateStr = date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDateStr = nextDay.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    const names = (group.attraction_names ?? []).join(", ");
    lines.push(
      "BEGIN:VEVENT",
      `DTSTART:${dateStr}`,
      `DTEND:${nextDateStr}`,
      `SUMMARY:Day ${group.day}: ${group.area}`,
      `DESCRIPTION:${names}`,
      `UID:travel-day-${group.day}-${Date.now()}@travelagent`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportMenu({ structuredData, planText }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [copied, setCopied] = useState(false);

  function handleICSExport() {
    if (!startDate) {
      setShowDatePicker(true);
      setOpen(false);
      return;
    }
    const ics = generateICS(structuredData, startDate);
    downloadFile(ics, "travel-itinerary.ics", "text/calendar");
    setOpen(false);
  }

  function confirmDateAndExport() {
    if (!startDate) return;
    const ics = generateICS(structuredData, startDate);
    downloadFile(ics, "travel-itinerary.ics", "text/calendar");
    setShowDatePicker(false);
  }

  async function handleJSONCopy() {
    try {
      const data = structuredData ?? { planText };
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Export
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[180px]">
          <button
            onClick={handleICSExport}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 rounded-t-lg"
          >
            📅 Export to Calendar
          </button>
          <button
            onClick={handleJSONCopy}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 rounded-b-lg border-t"
          >
            {copied ? "✅ Copied!" : "📋 Copy as JSON"}
          </button>
        </div>
      )}

      {/* Date picker modal for .ics export */}
      {showDatePicker && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 shadow-xl max-w-xs w-full mx-4">
            <h3 className="font-semibold text-gray-800 mb-2">When does your trip start?</h3>
            <p className="text-sm text-gray-500 mb-4">This date will be used for calendar events.</p>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowDatePicker(false)}
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDateAndExport}
                disabled={!startDate}
                className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300"
              >
                Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/ExportMenu.tsx
git commit -m "feat(phase16): add ExportMenu component with .ics and JSON export"
```

---

### Task 7: Update ChatPage with Split Layout

**Files:**
- Modify: `web/src/pages/ChatPage.tsx`

- [ ] **Step 1: Add imports and MapData state**

At the top of `web/src/pages/ChatPage.tsx`, add new imports after the existing ones (line 2):

```typescript
import MapPanel, { MapData } from "../components/MapPanel";
import ExportMenu from "../components/ExportMenu";
```

In the `Message` interface (line 4), add:
```typescript
mapData?: MapData | null;
structuredData?: any;
```

- [ ] **Step 2: Add map-related state to ChatPage component**

Inside the `ChatPage` component function, after the existing useState declarations (around line 126), add:

```typescript
const [activeMapData, setActiveMapData] = useState<MapData | null>(null);
const [activeStructuredData, setActiveStructuredData] = useState<any>(null);
const [activePlanText, setActivePlanText] = useState("");
const [mobileView, setMobileView] = useState<"chat" | "map">("chat");
```

- [ ] **Step 3: Parse mapData from SSE artifact-update events**

In the SSE parsing block inside `send()`, in the `artifact-update` handler (around line 241), after extracting `tokenUsage`, add mapData extraction:

Replace the existing `artifact-update` block:
```typescript
} else if (kind === "artifact-update") {
  const txt: string | undefined = event.artifact?.parts?.[0]?.text;
  if (txt) finalText = txt;
  const usage = event.artifact?.metadata?.tokenUsage;
  if (usage) {
    tokenUsage = { input: usage.inputTokens, output: usage.outputTokens };
    setSessionTokens((prev) => prev + usage.inputTokens + usage.outputTokens);
  }
}
```

With:
```typescript
} else if (kind === "artifact-update") {
  const txt: string | undefined = event.artifact?.parts?.[0]?.text;
  if (txt) finalText = txt;
  const meta = event.artifact?.metadata;
  if (meta?.tokenUsage) {
    tokenUsage = { input: meta.tokenUsage.inputTokens, output: meta.tokenUsage.outputTokens };
    setSessionTokens((prev) => prev + meta.tokenUsage.inputTokens + meta.tokenUsage.outputTokens);
  }
  // Extract map data if present
  if (meta?.mapData) {
    receivedMapData = meta.mapData as MapData;
  }
}
```

Also declare `receivedMapData` at the top of the SSE block (around line 209, alongside `finalText`):
```typescript
let receivedMapData: MapData | null = null;
```

- [ ] **Step 4: Update message state with mapData after SSE completes**

After the SSE reading loop, when creating the agent message (around line 265), update the active map state and include mapData:

Add before the `setMessages` call:
```typescript
if (receivedMapData) {
  setActiveMapData(receivedMapData);
  setActivePlanText(finalText);
}
```

Update the message object to include mapData:
```typescript
setMessages((prev) => [
  ...prev,
  {
    id: crypto.randomUUID(),
    role: "agent",
    text: finalText || "(No response received)",
    timestamp: new Date().toISOString(),
    tokenUsage,
    durationMs,
    mapData: receivedMapData,
  },
]);
```

- [ ] **Step 5: Rewrite ChatPage return JSX for split layout**

Replace the entire `return (...)` block in the ChatPage component with the following. The key change: the outermost `div` now conditionally renders a side panel for the map when `activeMapData` is present.

```tsx
return (
  <div className="flex flex-col h-full">
    {/* Header */}
    <div className="px-4 sm:px-6 py-3 border-b bg-white flex items-center justify-between">
      <div>
        <h2 className="font-semibold text-gray-700">Travel Planner</h2>
        <p className="text-xs text-gray-400 hidden sm:block">Agentic Orchestrator · Attractions + Accommodation + Transportation</p>
      </div>
      <div className="flex items-center gap-3">
        {sessionTokens > 0 && (
          <span className="text-xs text-gray-400 hidden sm:inline">
            Session: {sessionTokens.toLocaleString()} tokens
          </span>
        )}
        <button
          onClick={clearConversation}
          disabled={loading}
          className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-40 transition-colors"
        >
          Clear
        </button>
      </div>
    </div>

    {/* Mobile tab toggle (only shown when map data exists) */}
    {activeMapData && (
      <div className="md:hidden flex border-b bg-white">
        <button
          onClick={() => setMobileView("chat")}
          className={`flex-1 py-2 text-sm font-medium text-center ${mobileView === "chat" ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-500"}`}
        >
          💬 Chat
        </button>
        <button
          onClick={() => setMobileView("map")}
          className={`flex-1 py-2 text-sm font-medium text-center ${mobileView === "map" ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-500"}`}
        >
          🗺 Map
        </button>
      </div>
    )}

    {/* Main content area */}
    <div className="flex-1 flex overflow-hidden">
      {/* Chat column */}
      <div className={`flex flex-col ${activeMapData ? "md:w-[60%]" : "w-full"} ${activeMapData && mobileView === "map" ? "hidden md:flex" : "flex"} w-full`}>
        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {(msg.role === "agent" || msg.role === "error") && (
                <div className={`w-7 h-7 rounded-full text-white text-xs flex items-center justify-center mr-2 mt-1 shrink-0 ${
                  msg.role === "error" ? "bg-red-500" : "bg-blue-600"
                }`}>
                  {msg.role === "error" ? "!" : "AI"}
                </div>
              )}
              <div className="flex flex-col max-w-[85%] sm:max-w-[75%]">
                <div
                  className={`rounded-2xl px-4 py-3 text-sm ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white rounded-tr-sm"
                      : msg.role === "error"
                      ? "bg-red-50 border border-red-200 text-red-700 rounded-tl-sm"
                      : "bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm"
                  }`}
                >
                  {msg.role === "agent" ? (
                    <div className="prose prose-sm max-w-none prose-headings:text-gray-800 prose-headings:font-semibold prose-h2:text-base prose-h3:text-sm">
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  ) : msg.role === "error" ? (
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                      {msg.text}
                    </div>
                  ) : (
                    msg.text
                  )}
                </div>
                {msg.role === "agent" && (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[11px] text-gray-400 mt-1 ml-1">
                      {msg.durationMs != null && `${(msg.durationMs / 1000).toFixed(1)}s`}
                      {msg.durationMs != null && msg.tokenUsage && " · "}
                      {msg.tokenUsage && `Input ${msg.tokenUsage.input.toLocaleString()} · Output ${msg.tokenUsage.output.toLocaleString()} tokens`}
                    </span>
                    <CopyButton text={msg.text} />
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Single-line progress indicator while loading */}
          {loading && <ProgressIndicator status={currentStatus} />}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 sm:px-6 py-4 border-t bg-white">
          <div className="flex gap-2 sm:gap-3">
            <input
              className="flex-1 min-w-0 border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Describe your trip..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              disabled={loading}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-4 sm:px-5 py-2 rounded-xl text-sm font-medium transition-colors shrink-0"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Map panel (right side on desktop, full screen on mobile "map" tab) */}
      {activeMapData && (
        <div className={`${mobileView === "chat" ? "hidden md:flex" : "flex"} md:w-[40%] w-full flex-col border-l bg-gray-50`}>
          <div className="px-4 py-2 border-b bg-white flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">🗺 Trip Map</span>
            <ExportMenu structuredData={activeStructuredData} planText={activePlanText} />
          </div>
          <div className="flex-1 p-2">
            <MapPanel mapData={activeMapData} />
          </div>
        </div>
      )}
    </div>
  </div>
);
```

- [ ] **Step 6: Reset map state on clearConversation**

In the `clearConversation()` function (around line 137), add:

```typescript
setActiveMapData(null);
setActiveStructuredData(null);
setActivePlanText("");
setMobileView("chat");
```

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/ChatPage.tsx
git commit -m "feat(phase16): split layout with map panel and export menu integration"
```

---

### Task 8: End-to-End Verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev:all
```

- [ ] **Step 2: Test the full flow**

Open http://localhost:5173 and send:

> "Plan me a 4-day Tokyo trip, budget $1000, 2 people, interested in temples and food"

Verify:
1. Agent responses contain lat/lng in structured data (check browser Network tab for SSE events)
2. Map panel appears on the right side after the final plan is delivered
3. Blue markers for attractions, orange markers for accommodation
4. Click a marker → popup shows name, description, cost
5. Dashed route lines appear between connected locations
6. Export menu works: .ics download + JSON copy to clipboard

- [ ] **Step 3: Test mobile layout**

Resize browser to < 768px width:
1. Tab toggle (💬 Chat / 🗺 Map) appears
2. Switching tabs shows the correct view
3. Map fills the available space

- [ ] **Step 4: Test backward compatibility**

Verify old conversations without mapData still display full-width chat without errors.

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(phase16): end-to-end verification fixes"
```
