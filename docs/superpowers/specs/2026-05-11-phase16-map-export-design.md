# Phase 16: Map Visualization + Itinerary Export — Design Spec

**Date**: 2026-05-11
**Status**: Approved
**Depends on**: Phase 14 (structured output), Phase 19 (3-turn confirmation flow)

---

## Goal

Add an interactive map showing attractions and accommodation locations, plus export functionality (.ics calendar, JSON copy). The map appears as a side panel on desktop and a tab view on mobile, only when structured map data is available.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Map library | Leaflet + OpenStreetMap | Zero API key, zero cost, sufficient for demo |
| Geocoding | LLM-generated lat/lng | Zero extra API calls; accuracy sufficient for city-level mapping |
| Export formats | .ics + JSON copy | PDF deferred to Phase 20; keeps scope small |
| Layout | Right panel (desktop) / tab toggle (mobile) | Clean separation; no layout change when no map data |

---

## 1. Backend: Schema Changes

### 1.1 Prompt updates

**`docs/prompts/attractions.md`** — Add `lat` and `lng` as required fields in each attraction item:

```json
{
  "name": "Senso-ji Temple",
  "lat": 35.7148,
  "lng": 139.7967,
  "area": "Asakusa",
  "category": "temple",
  "recommended_duration_hours": 1.5,
  "estimated_cost_usd": 0,
  "best_time": "morning",
  "notes": "..."
}
```

**`docs/prompts/accommodation.md`** — Add `lat` and `lng` as required fields in each recommendation:

```json
{
  "name": "Hotel Gracery Shinjuku",
  "lat": 35.6938,
  "lng": 139.7010,
  "area": "Shinjuku",
  "price_range_usd_per_night": { "min": 80, "max": 150 },
  ...
}
```

### 1.2 Schema Validator updates

**`src/services/schemaValidator.ts`** — Add `lat` (number, -90~90) and `lng` (number, -180~180) to required fields for both `validateAttractions()` and `validateAccommodation()`. Validation failure triggers the existing retry-once mechanism.

---

## 2. Backend: MapData Generation

### 2.1 MapData types

```typescript
interface MapData {
  center: { lat: number; lng: number };
  zoom: number;
  markers: MapMarker[];
  routes: MapRoute[];
}

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
```

### 2.2 buildMapData() in orchestratorExecutor.ts

New private method `buildMapData(structuredResults: Map<string, any>): MapData | null`:

1. Extract attractions from `structuredResults.get("attractions")`:
   - For each attraction with valid lat/lng → create marker (type: "attraction")
   - Skip entries with out-of-range coordinates (lat not in -90~90, lng not in -180~180), log warning
2. Extract accommodation from `structuredResults.get("accommodation")`:
   - For each recommendation with valid lat/lng → create marker (type: "accommodation")
3. Extract routes from `structuredResults.get("transportation")`:
   - Map `key_routes[]` to `MapRoute[]`
4. Calculate center: average of all valid marker lat/lng
5. Calculate zoom: ~12 for single-city (default), adjustable based on marker spread
6. Return null if no valid markers exist

### 2.3 Integration point

In `publishFinalPlan()`, after `calculateAndAppendBudget()`:

```typescript
const mapData = this.buildMapData(structuredResults);
// Add to artifact metadata
metadata: { tokenUsage, mapData }  // mapData can be null
```

---

## 3. Frontend: New Components

### 3.1 MapPanel.tsx

**Location**: `web/src/components/MapPanel.tsx`

**Props**:
```typescript
interface MapPanelProps {
  mapData: MapData;
}
```

**Behavior**:
- Renders a Leaflet map with OpenStreetMap tiles
- Attraction markers: blue pins with 📍
- Accommodation markers: orange pins with 🏨
- Click marker → popup showing title, description, cost
- Routes rendered as dashed polylines between markers (matched by label/from/to)
- Map auto-fits bounds to show all markers

### 3.2 ExportMenu.tsx

**Location**: `web/src/components/ExportMenu.tsx`

**Props**:
```typescript
interface ExportMenuProps {
  structuredData: any;  // The full structured results
  mapData: MapData;
}
```

**Features**:
- Dropdown button with two options:
  - **📅 Export to Calendar** → generates `.ics` file with one VEVENT per day. If no `start_date` available, shows a date picker dialog first. Download via blob URL.
  - **📋 Copy as JSON** → `navigator.clipboard.writeText()` with success toast "Copied!"

### 3.3 ChatPage.tsx Layout Changes

**Condition**: Only activate split layout when `mapData` is present in artifact metadata.

**Desktop (≥768px)**:
- Chat area takes ~60% width (left)
- MapPanel takes ~40% width (right), sticky positioning
- ExportMenu sits above the map panel

**Mobile (<768px)**:
- Top tab bar: [💬 Chat] [🗺 Map]
- Only one view visible at a time
- ExportMenu inside map view

**No mapData**: Layout unchanged from current (full-width chat).

---

## 4. Safety Sensors

| Check | Location | Behavior |
|-------|----------|----------|
| lat/lng range validation | `buildMapData()` + `MapPanel.tsx` | Skip invalid markers, console.warn |
| Null mapData | `ChatPage.tsx` | Fallback to full-width text-only (backward compatible) |
| Empty markers array | `MapPanel.tsx` | Don't render map, show nothing |
| Missing start_date for .ics | `ExportMenu.tsx` | Show date picker before generating |

---

## 5. Dependencies

**New npm packages** (web/ only):
```
leaflet
react-leaflet
@types/leaflet
```

**No new environment variables needed.** (Mapbox token removed from design.)

---

## 6. Files to Create/Modify

### New files:
- `web/src/components/MapPanel.tsx`
- `web/src/components/ExportMenu.tsx`

### Modified files:
- `docs/prompts/attractions.md` — add lat/lng to schema
- `docs/prompts/accommodation.md` — add lat/lng to schema
- `src/services/schemaValidator.ts` — validate lat/lng fields
- `src/agents/orchestratorExecutor.ts` — buildMapData() + attach to artifact metadata
- `web/src/pages/ChatPage.tsx` — split layout, parse mapData, render MapPanel + ExportMenu
- `web/package.json` — add leaflet dependencies

---

## 7. Verification Plan

1. **Backend**: Send a travel planning request → verify `artifact.metadata.mapData` contains valid markers in SSE response
2. **Map rendering**: Markers appear at correct locations; popups show correct info; routes drawn between points
3. **Export .ics**: Download file → import to Google Calendar → verify events match itinerary days
4. **Export JSON**: Click copy → paste in editor → verify valid JSON with structured data
5. **Mobile**: Resize browser → tab toggle works; map fills viewport
6. **Backward compatibility**: Old conversations without mapData → full-width chat, no errors
7. **Invalid coordinates**: Manually inject bad lat/lng → verify graceful skip with console warning
