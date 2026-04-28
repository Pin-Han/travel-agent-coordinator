# Phase 11：地圖視覺化 + 行程匯出

## Context

Phase 10 完成結構化輸出後，attractions / accommodation / transportation 三個 agent 都會回傳有 `lat/lng`、`price_range`、`route` 的 JSON，而不是自由文字。Phase 11 把這份結構化資料渲染成互動地圖，並提供匯出成可用格式的功能。

**先決條件**：Phase 10（結構化輸出）必須先完成。

---

## 架構

### UI 佈局

```
桌面版（≥ 768px）：
┌──────────┬──────────────────────────────┐
│ Sidebar  │  Chat  │  Map Panel           │
│          │        │  [Google Maps]       │
│          │        │  📍 景點             │
│          │        │  🏨 住宿             │
│          │        │                      │
│          │        │  [匯出 ▼]            │
└──────────┴────────┴──────────────────────┘

手機版（< 768px）：
┌──────────────────────────────────────────┐
│  Chat                                    │
│  [查看地圖 🗺️]  ← 按鈕切換到地圖 view    │
└──────────────────────────────────────────┘
```

### 資料流

```
coordinator 輸出 artifact
    ↓
ChatPage 解析 artifact.metadata.mapData
    ↓
有 mapData → 顯示 MapPanel（右側 or 上方）
無 mapData → 純文字顯示（向後相容）
    ↓
MapPanel 接收 MapData 渲染地圖 + 標記
```

---

## MapData 結構（Phase 10 定義，Phase 11 消費）

```typescript
interface MapData {
  center: { lat: number; lng: number };
  zoom: number;
  markers: MapMarker[];
  routes?: MapRoute[];
}

interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  type: "attraction" | "accommodation" | "transit";
  label: string;
  day?: number;          // 屬於第幾天
  popup: {
    title: string;
    description: string;
    cost?: string;
    hours?: string;
  };
}

interface MapRoute {
  from_id: string;
  to_id: string;
  method: string;        // "Tokyo Metro", "Walk", etc.
  duration_min: number;
}
```

coordinator prompt 在 Phase 10 已要求輸出此結構，Phase 11 只需消費。

---

## 地圖實作選項

### Option A：Google Maps Embed API（建議）

```html
<!-- 免費，無需 JS SDK，iframe 嵌入 -->
<iframe
  src="https://www.google.com/maps/embed/v1/place?key=API_KEY&q=Senso-ji+Temple"
/>
```

**優點**：免費額度高（每月 $200 免費額度）、不需要 JS SDK、直接 iframe
**缺點**：Embed API 不支援多標記（需要 Maps JavaScript API 做多標記）

### Option B：Mapbox GL JS（推薦，功能完整）

```bash
npm install mapbox-gl
```

```typescript
import mapboxgl from 'mapbox-gl';
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [mapData.center.lng, mapData.center.lat],
  zoom: mapData.zoom,
});

mapData.markers.forEach(marker => {
  new mapboxgl.Marker({ color: markerColor(marker.type) })
    .setLngLat([marker.lng, marker.lat])
    .setPopup(new mapboxgl.Popup().setHTML(markerPopupHTML(marker)))
    .addTo(map);
});
```

**優點**：支援多標記、路線、自訂樣式；免費額度 50,000 map loads/月（demo 夠用）
**缺點**：需要 `VITE_MAPBOX_TOKEN` 環境變數

### Option C：Leaflet + OpenStreetMap（零成本）

```bash
npm install leaflet react-leaflet
```

**優點**：完全免費、開源、不需要 API key
**缺點**：地圖美觀度較低、需要多配置

**建議**：Demo 和展示用 Mapbox（好看），產品化後可換 Leaflet 省成本。

---

## 匯出功能

### 匯出選單 UI

```
[匯出 ▼]
  ├── 📅 新增到行事曆 (.ics)
  ├── 📄 下載 PDF
  └── 🔗 複製行程 JSON
```

### `.ics` 行事曆匯出

```typescript
function generateICS(plan: PlanState): string {
  const events = plan.days.flatMap(day =>
    day.attractions.map(attraction => ({
      summary: attraction.name,
      dtstart: formatICSDate(plan.start_date, day.day, 9),  // 假設 9am 開始
      dtend:   formatICSDate(plan.start_date, day.day, 9 + attraction.recommended_duration_hours),
      location: `${attraction.area}, ${plan.destination}`,
      description: attraction.notes,
    }))
  );

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Travel Agent Coordinator//EN',
    ...events.flatMap(e => [
      'BEGIN:VEVENT',
      `SUMMARY:${e.summary}`,
      `DTSTART:${e.dtstart}`,
      `DTEND:${e.dtend}`,
      `LOCATION:${e.location}`,
      `DESCRIPTION:${e.description}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ].join('\r\n');
}

// 觸發下載
function downloadICS(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}
```

**先決條件**：`plan.start_date` 需要用戶在規劃時提供出發日期（或在匯出前詢問）。

### PDF 匯出

```bash
npm install jspdf html2canvas
```

```typescript
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

async function downloadPDF() {
  const element = document.getElementById('travel-plan-content');
  const canvas = await html2canvas(element!);
  const pdf = new jsPDF();
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 10, 190, 0);
  pdf.save('travel-plan.pdf');
}
```

或者：後端用 Puppeteer 產生更精美的 PDF（需要額外 server endpoint）。

### JSON 匯出

```typescript
function copyPlanJSON(plan: PlanState) {
  const json = JSON.stringify(plan, null, 2);
  navigator.clipboard.writeText(json);
}
```

---

## 受影響的檔案

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `web/src/components/MapPanel.tsx` | 新建 | Mapbox 地圖元件，接收 MapData 渲染標記和路線 |
| `web/src/components/ExportMenu.tsx` | 新建 | 匯出下拉選單（.ics / PDF / JSON） |
| `web/src/pages/ChatPage.tsx` | 修改 | artifact 解析 mapData；桌面版顯示 MapPanel；手機版加切換按鈕 |
| `web/vite.config.ts` | 修改 | 確保 mapbox-gl 正確打包（可能需要 worker config） |
| `.env.example` | 修改 | 新增 `VITE_MAPBOX_TOKEN=` |

---

## 環境變數

```env
# Mapbox（選用，不設定則地圖功能不顯示）
VITE_MAPBOX_TOKEN=pk.eyJ1...
```

---

## Harness 視角

**Sensor 新增**：
- 地圖渲染前驗證 `lat/lng` 是否在合理範圍（日本的 lat 約 24-46，lng 約 122-153）
- 驗證失敗（座標不合理）→ 不顯示地圖，fallback 純文字，log warning
- 匯出前驗證 `PlanState` 完整性（至少有 destination + days）

---

## 實作順序

| 步驟 | 內容 |
|------|------|
| 1 | 安裝 `mapbox-gl`，建立 `MapPanel.tsx` 基礎版（只顯示中心點）|
| 2 | 加入 markers（景點 📍、住宿 🏨）+ popup |
| 3 | 加入 routes（景點間的連線）|
| 4 | ChatPage 整合：有 mapData 時顯示 MapPanel |
| 5 | 建立 `ExportMenu.tsx`：.ics 匯出 |
| 6 | 加入 PDF 匯出（jsPDF）|
| 7 | 加入 JSON 複製 |
| 8 | 手機版切換 UI |

---

## 驗證方式

1. **地圖顯示**：完整規劃回應後，右側顯示地圖；景點和住宿有對應標記；點擊標記顯示 popup
2. **路線連線**：標記之間有虛線或路線連接，顯示交通方式
3. **無 mapData fallback**：舊的純文字 artifact（無 mapData）不顯示地圖，純文字正常顯示
4. **.ics 匯出**：下載後可匯入 Google Calendar；事件時間、地點正確
5. **PDF 匯出**：PDF 包含行程文字和地圖截圖
6. **手機版**：375px 寬時地圖在獨立 view，不擠壓聊天視窗

---

## 邊界條件

| 情境 | 處理方式 |
|------|----------|
| `VITE_MAPBOX_TOKEN` 未設定 | 不顯示地圖，匯出選單只保留 PDF 和 JSON |
| 座標超出合理範圍 | Sensor 過濾，不渲染該標記，console.warn |
| 網路斷線（地圖 tile 載入失敗）| Mapbox 有 offline fallback，顯示空白底圖 |
| 出發日期未知（.ics 匯出）| 彈出 date picker 讓用戶輸入出發日期再下載 |
| 行程超過一頁（PDF）| jsPDF 自動分頁 |
