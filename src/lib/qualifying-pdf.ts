import { jsPDF } from "jspdf";
import type { QdatFile } from "./qdat-export";

/**
 * CompuLink StarTrak "Qualifying Listing" PDF — the dot-matrix sheet the tower
 * prints (see the Maryland International Raceway reference sheets): serif
 * event header, decorative rule with the StarTrak mark, Low E.T. / Top Speed
 * callouts beside the big class title, boxed column header, then monospace
 * rows. One class per page-run; the header and column rule repeat on every
 * page. Index classes print ET / INDEX / Ov/Un (most-under first, the order
 * the QDAT rows already carry); no-index classes print ET / MPH. A dotted
 * bump line is drawn under the last qualified spot when the field size is set.
 */

export interface QualifyingPdfHeader {
  track: string;
  city: string;
  /** "NHRA" line under the city; blank to omit. */
  sanction: string;
  /** "DIVISION 1" line; blank to omit. */
  division: string;
  /** Centered above the rows, e.g. "NHRA D1 DIVISIONAL DOUBLE HEADER 2". */
  eventName: string;
  /** "20/JUN/2026" — see formatListingDate. */
  dateStr: string;
  /** "10:04 AM". */
  timeStr: string;
}

export interface QualifyingPdfClass {
  qdat: QdatFile;
  /** Session label in the top-right corner: "Q1", "Q4"… */
  sessionLabel: string;
  /** Dotted bump line under this position; null for no line. */
  fieldSize: number | null;
}

/** "2026-09-18" → "18/SEP/2026". */
export function formatListingDate(isoDate: string): string {
  const m = (isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return isoDate || "";
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${m[3]}/${months[parseInt(m[2], 10) - 1]}/${m[1]}`;
}

const W = 612;
const H = 792;
const LEFT = 36;
const RIGHT = W - 36;

function fitText(doc: jsPDF, txt: string, maxW: number): string {
  let t = String(txt || "");
  if (doc.getTextWidth(t) <= maxW) return t;
  while (t.length > 1 && doc.getTextWidth(t) > maxW) t = t.slice(0, -1);
  return t;
}

function fmtSigned(n: number): string {
  // The samples print "-1.152" but positive "0.080" with no sign.
  return n.toFixed(3);
}

export function buildQualifyingPdf(
  classes: QualifyingPdfClass[],
  header: QualifyingPdfHeader,
): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let first = true;

  for (const cls of classes) {
    if (!first) doc.addPage();
    first = false;
    drawClass(doc, cls, header);
  }
  return doc;
}

function drawClass(doc: jsPDF, cls: QualifyingPdfClass, header: QualifyingPdfHeader) {
  const { qdat } = cls;
  const hasIndex = qdat.hasIndex;

  // Column x-positions (right-aligned columns carry an R suffix).
  const CX = hasIndex
    ? { posR: 56, carR: 98, clsR: 146, drv: 156, home: 272, body: 374, motor: 452, etR: 518, idxR: 549, ovR: RIGHT }
    : { posR: 56, carR: 98, clsR: 146, drv: 156, home: 272, body: 374, motor: 452, etR: 526, idxR: 0, ovR: RIGHT };

  const rowH = 12.5;
  const bottom = H - 40;

  const pageHeader = (withEventName: boolean): number => {
    let y = 46;
    // Session label, top right.
    doc.setFont("courier", "bold");
    doc.setFontSize(10);
    if (cls.sessionLabel) doc.text(cls.sessionLabel, RIGHT - 8, y);

    // Track / city / sanction / division — centered serif italic.
    doc.setFont("times", "bolditalic");
    doc.setFontSize(13);
    if (header.track) {
      doc.text(header.track, W / 2, y + 14, { align: "center" });
    }
    doc.setFontSize(12);
    let cy = y + 28;
    for (const line of [header.city, header.sanction, header.division]) {
      if (!line) continue;
      doc.text(line, W / 2, cy, { align: "center" });
      cy += 13;
    }
    y = cy + 4;

    // Decorative band with the StarTrak mark on the right.
    doc.setDrawColor(120);
    doc.setLineWidth(3);
    doc.line(LEFT, y, RIGHT - 118, y);
    doc.setDrawColor(0);
    doc.setFont("times", "bolditalic");
    doc.setFontSize(10);
    doc.text("CompuLink  StarTrak", RIGHT, y + 3, { align: "right" });
    y += 18;

    // Low E.T. / Top Speed block, class title, time + date.
    doc.setFont("times", "bold");
    doc.setFontSize(9);
    doc.text("Qualified Positions for ....", LEFT + 8, y);
    doc.setFont("courier", "normal");
    doc.setFontSize(8.5);
    if (qdat.lowEt) {
      doc.text(
        `Low E.T. .......  ${qdat.lowEt.value.toFixed(3)} Sec    ${qdat.lowEt.car}  ${qdat.lowEt.driver}`,
        LEFT + 8,
        y + 12,
      );
    }
    if (qdat.topSpeed) {
      doc.text(
        `Top Speed ...  ${qdat.topSpeed.value.toFixed(2)} MPH    ${qdat.topSpeed.car}  ${qdat.topSpeed.driver}`,
        LEFT + 8,
        y + 23,
      );
    }
    doc.setFont("times", "bold");
    doc.setFontSize(17);
    doc.text(qdat.category, W / 2 + 30, y + 12, { align: "center" });
    doc.setFontSize(9);
    doc.text(header.timeStr, RIGHT - 62, y + 14, { align: "right" });
    doc.text(header.dateStr, RIGHT, y + 14, { align: "right" });
    y += 34;

    // Boxed column header between double rules.
    doc.setLineWidth(1.6);
    doc.line(LEFT, y, RIGHT, y);
    doc.setLineWidth(0.6);
    doc.line(LEFT, y + 2.5, RIGHT, y + 2.5);
    y += 15;
    doc.setFont("times", "bold");
    doc.setFontSize(9);
    doc.text("#", CX.carR, y, { align: "right" });
    doc.text("CLASS", CX.clsR, y, { align: "right" });
    doc.text("DRIVER", CX.drv, y);
    doc.text("HOMETOWN", CX.home, y);
    doc.text("CAR", CX.body, y);
    doc.text("MOTOR", CX.motor, y);
    doc.text("ET", CX.etR, y, { align: "right" });
    if (hasIndex) {
      doc.text("INDEX", CX.idxR + 8, y, { align: "right" });
      doc.text("Ov/Un", CX.ovR, y, { align: "right" });
    } else {
      doc.text("MPH", CX.ovR, y, { align: "right" });
    }
    y += 6;
    doc.setLineWidth(0.6);
    doc.line(LEFT, y, RIGHT, y);
    doc.setLineWidth(1.6);
    doc.line(LEFT, y + 2.5, RIGHT, y + 2.5);
    y += 20;

    if (withEventName && header.eventName) {
      doc.setFont("times", "bold");
      doc.setFontSize(12.5);
      doc.text(header.eventName.toUpperCase(), W / 2, y + 4, { align: "center" });
      y += 22;
    }
    return y;
  };

  let y = pageHeader(true);

  const bumpLine = (yy: number) => {
    doc.setLineDashPattern([1, 2], 0);
    doc.setLineWidth(0.9);
    doc.line(LEFT, yy, RIGHT, yy);
    doc.setLineDashPattern([], 0);
    doc.setFont("times", "italic");
    doc.setFontSize(7);
    doc.text(`field of ${cls.fieldSize}`, RIGHT, yy - 2, { align: "right" });
  };

  doc.setFont("courier", "normal");
  doc.setFontSize(8.5);
  let printed = 0;
  for (const r of qdat.rows) {
    if (y > bottom) {
      doc.addPage();
      y = pageHeader(false);
      doc.setFont("courier", "normal");
      doc.setFontSize(8.5);
    }
    if (r.position !== null) doc.text(`${r.position}.`, CX.posR, y, { align: "right" });
    doc.text(r.car, CX.carR, y, { align: "right" });
    doc.text(r.classCode, CX.clsR, y, { align: "right" });
    doc.text(fitText(doc, r.driver, CX.home - CX.drv - 8), CX.drv, y);
    doc.text(fitText(doc, r.hometown, CX.body - CX.home - 8), CX.home, y);
    doc.text(fitText(doc, r.body, CX.motor - CX.body - 8), CX.body, y);
    doc.text(fitText(doc, r.motor, CX.etR - 40 - CX.motor), CX.motor, y);
    doc.text(r.dq ? "DQ" : r.et!.toFixed(3), CX.etR, y, { align: "right" });
    if (hasIndex) {
      if (r.index !== null) doc.text(r.index.toFixed(2), CX.idxR + 8, y, { align: "right" });
      if (r.ovUn !== null) doc.text(fmtSigned(r.ovUn), CX.ovR, y, { align: "right" });
    } else if (r.mph !== null) {
      doc.text(r.mph.toFixed(2), CX.ovR, y, { align: "right" });
    }
    y += rowH;
    printed++;
    if (cls.fieldSize && printed === cls.fieldSize && printed < qdat.rows.length) {
      bumpLine(y - rowH / 2 + 2);
      y += 4;
    }
  }

  if (!hasIndex) {
    doc.setFont("times", "italic");
    doc.setFontSize(7.5);
    doc.text(
      "Heads-up class — no index on file; ordered by E.T.",
      LEFT,
      Math.min(y + 10, H - 24),
    );
  }
}
