# Phase 16：PDF 行程匯出

## Context

三輪對話結束後，用戶手上有一份完整行程規劃，但目前只能靠「複製文字」帶走。Phase 16 在最終回覆底部新增一個下載按鈕，讓用戶一鍵下載排版好的 PDF，方便離線查看或列印帶出門。

**先決條件**：Phase 15（三輪對話流程，確保最終輸出格式一致）。

---

## 功能範圍

- 最終回覆（Turn 3）底部出現「📄 下載 PDF」按鈕
- PDF 包含：行程表、住宿資訊、交通路線、預算明細、實用提示
- 封面顯示：目的地、天數、人數、下載日期
- 排版乾淨，適合手機和 A4 列印

---

## 技術設計

### 前端（`web/src/`）

**新建 `src/utils/pdfExport.ts`**：

```typescript
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export async function exportPDF(
  planHtml: HTMLElement,
  filename: string
): Promise<void> {
  const canvas = await html2canvas(planHtml, { scale: 2 });
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const imgHeight = (canvas.height * pageWidth) / canvas.width;
  pdf.addImage(imgData, "PNG", 0, 0, pageWidth, imgHeight);
  pdf.save(filename);
}
```

**修改 `web/src/pages/ChatPage.tsx`**：
- 最終 agent 回覆（Turn 3，含預算明細）底部加「📄 下載 PDF」按鈕
- 點擊後呼叫 `exportPDF(messageRef.current, "travel-plan.pdf")`
- 按鈕 hover 時提示：「包含行程、住宿、交通、預算」

### 套件

```bash
# 前端
cd web && npm install jspdf html2canvas
```

---

## PDF 頁面結構

```
封面
┌─────────────────────────┐
│  🗺 5天台北旅遊行程      │
│  2 人・預算 $1500        │
│  下載日期：2026-05-02    │
└─────────────────────────┘

第1頁：📅 行程概覽表格
第2頁：🏨 住宿資訊
第3頁：🚌 交通路線 + 💰 預算
第4頁：💡 實用提示
```

---

## 邊界條件

| 情境 | 處理方式 |
|------|----------|
| 行程文字過長，PDF 超出單頁 | `html2canvas` 自動分頁，jsPDF 支援多頁 |
| 中文字型顯示異常 | 使用 html2canvas 截圖模式，直接渲染瀏覽器字型，不需嵌入字型 |
| 用戶在 Turn 1/2 就想下載 | 按鈕只在 Turn 3（最終回覆）出現 |
| 手機螢幕寬度不足 | PDF 固定 A4 寬度，與螢幕尺寸無關 |

---

## 受影響的檔案

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `web/src/utils/pdfExport.ts` | 新建 | `exportPDF()` — html2canvas + jsPDF |
| `web/src/pages/ChatPage.tsx` | 修改 | Turn 3 回覆底部加下載按鈕 |
| `web/package.json` | 修改 | 新增 `jspdf`、`html2canvas` 依賴 |

---

## 驗證方式

1. 完成三輪對話取得完整行程
2. 點擊「📄 下載 PDF」，確認 PDF 下載正常
3. 開啟 PDF，確認行程表格、住宿、交通、預算都完整呈現
4. 在手機上確認按鈕可點擊、PDF 可正常下載
5. Turn 1 / Turn 2 回覆確認無下載按鈕
