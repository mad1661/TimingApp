import { jsPDF } from "jspdf";

/**
 * Final Round Results + per-class round-by-round elimination PDF, ported from
 * Mark's racedata-zip-to-pdf playground (public/racedata-zip-to-pdf/index.html)
 * so AccuTime sessions produce the same sheets without the separate tool hop.
 * The vector-text jsPDF layout — coordinates, fonts, dotted rules, the
 * "WINNERS of each pair appear First" note — mirrors that page's buildPDF().
 */

export interface PdfSummaryRow {
  label: string;
  num?: string;
  driver?: string;
  hometown?: string;
  car?: string;
  qfy?: string;
  reaction?: string;
  et?: string;
  mph?: string;
}

export interface PdfRoundRow {
  num?: string;
  cls?: string;
  qfy?: string;
  driver?: string;
  home?: string;
  car?: string;
  motor?: string;
  reaction?: string;
  di?: string;
  et?: string;
  mph?: string;
}

export interface PdfRound {
  name: string;
  pairs: { rows: PdfRoundRow[]; single?: boolean }[];
}

export interface PdfCategory {
  name: string;
  brand?: string;
  hasDI?: boolean;
  rows: PdfSummaryRow[];
  rounds: PdfRound[];
}

/** Header logos (PNG/JPEG data URLs), the racedata-zip-to-pdf three-slot row. */
export interface PdfLogos {
  left?: string;
  center?: string;
  right?: string;
}

export interface PdfEvent {
  dates?: string;
  track?: string;
  location?: string;
  roundDate?: string;
  series?: string;
  brand?: string;
  logos?: PdfLogos;
}

// The logo band mirrors the source app's .logo-row: three slots across the
// top (left / event / right aligned), image max-height ~105px ≈ 76pt.
const LOGO_BAND_H = 76;

/**
 * Draw the three-slot logo row at yTop and return the vertical space it used
 * (0 when no logos, so pages without them keep their original layout).
 */
function drawLogoRow(doc: jsPDF, event: PdfEvent, yTop: number, W: number, margin: number): number {
  const slots = [event.logos?.left, event.logos?.center, event.logos?.right];
  if (!slots.some(Boolean)) return 0;
  const slotW = (W - margin * 2) / 3 - 8;
  slots.forEach((dataUrl, i) => {
    if (!dataUrl) return;
    try {
      const props = doc.getImageProperties(dataUrl);
      // Fit inside the slot; don't blow small logos up past ~natural size.
      const scale = Math.min(slotW / props.width, LOGO_BAND_H / props.height, 1);
      const w = props.width * scale;
      const h = props.height * scale;
      const x = i === 0 ? margin : i === 1 ? (W - w) / 2 : W - margin - w;
      doc.addImage(dataUrl, x, yTop + (LOGO_BAND_H - h) / 2, w, h);
    } catch {
      // Unreadable image — the sheet still prints with text branding only.
    }
  });
  return LOGO_BAND_H + 10;
}

// The series banner changes event to event ("NHRA Lucas Oil…", "NHRA Mission
// Foods…"), so no default is invented: the caller passes the session's own
// series title (Class.ini [Reports] or the page's header field), and when
// there is none the line falls back to the track name or stays blank.
function seriesLine(event: PdfEvent): string {
  return event.series || event.track || "";
}

function fitText(doc: jsPDF, txt: string, maxW: number): string {
  txt = String(txt || "");
  if (doc.getTextWidth(txt) <= maxW) return txt;
  while (txt.length > 1 && doc.getTextWidth(txt) > maxW) txt = txt.slice(0, -1);
  return txt;
}

function fmtReaction(r: string | undefined): string {
  if (!r) return "";
  if (/^-/.test(r)) return "foul " + r;
  return r;
}

function spaceOut(s: string): string {
  return s.split("").join(" ");
}

function fmtET(v: string | undefined): string {
  if (!v) return "";
  if (/^[A-Za-z]+$/.test(v)) return spaceOut(v.toUpperCase());
  return v;
}

function dottedRule(doc: jsPDF, x1: number, x2: number, y: number) {
  doc.setLineDashPattern([0.7, 1.7], 0);
  doc.setLineWidth(0.7);
  doc.setDrawColor(60);
  doc.line(x1, y, x2, y);
  doc.line(x1, y + 2, x2, y + 2);
  doc.setLineDashPattern([], 0);
  doc.setDrawColor(0);
}

/** Build the multi-page PDF and return the raw bytes. */
export function buildRacedataPdf(event: PdfEvent, categories: PdfCategory[]): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = 612;
  const H = 792;

  // ---------- Summary page(s) ----------
  // The 76pt top band is the logo row's home; with no logos the gap stays, so
  // the layout matches the original sheets either way.
  drawLogoRow(doc, event, 40, W, 36);
  let y = 40 + LOGO_BAND_H + 16;

  doc.setFont("times", "bold");
  doc.setFontSize(10.5);
  doc.text(event.dates || "", 36, y);
  doc.text(event.track || "", W / 2, y, { align: "center" });
  doc.text(event.location || "", W - 36, y, { align: "right" });
  y += 20;

  doc.setFont("times", "bolditalic");
  doc.setFontSize(12);
  doc.text("*****    FINAL ROUND RESULTS    *****", W / 2, y, { align: "center" });
  y += 7;
  doc.setLineWidth(1.6);
  doc.line(36, y, W - 36, y);
  doc.setLineWidth(0.6);
  doc.line(36, y + 3, W - 36, y + 3);
  y += 12;
  doc.setFont("times", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(event.brand || "AccuTime", W - 36, y, { align: "right" });
  doc.setTextColor(0);
  y += 14;

  const SX = { lbl: 48, num: 118, drv: 160, home: 256, car: 348, qfyR: 422, rtR: 498, etR: 534, mphR: 564 };
  const rowH = 11;
  const headH = 15;
  const catGap = 9;
  const bottom = H - 34;

  for (const cat of categories) {
    const need = headH + cat.rows.length * rowH + catGap;
    if (y + Math.min(need, headH + 2 * rowH) > bottom) {
      doc.addPage();
      y = 44;
    }
    doc.setFont("times", "bold");
    doc.setFontSize(6);
    doc.text(":::", 38, y);
    doc.setFontSize(11);
    const nm = cat.name.toUpperCase();
    doc.text(nm, 52, y);
    const nmW = doc.getTextWidth(nm);
    doc.setFontSize(9);
    doc.text(" ..........", 52 + nmW + 2, y);
    doc.setFontSize(7.5);
    doc.text("QFY", SX.qfyR, y, { align: "right" });
    doc.text("REACTION", SX.rtR, y, { align: "right" });
    doc.text("ET", SX.etR, y, { align: "right" });
    doc.text("MPH", SX.mphR, y, { align: "right" });
    doc.setFontSize(5.5);
    doc.text("::::::", W - 36, y, { align: "right" });
    y += headH - 3;

    doc.setFont("times", "normal");
    doc.setFontSize(8.5);
    for (const r of cat.rows) {
      if (y > bottom) {
        doc.addPage();
        y = 44;
        doc.setFont("times", "normal");
        doc.setFontSize(8.5);
      }
      doc.text(labelWithDots(r.label), SX.lbl, y);
      if (r.num) doc.text("# " + r.num, SX.num, y);
      doc.text(fitText(doc, r.driver || "", SX.home - SX.drv - 6), SX.drv, y);
      doc.text(fitText(doc, r.hometown || "", SX.car - SX.home - 6), SX.home, y);
      doc.text(fitText(doc, r.car || "", SX.qfyR - 22 - SX.car), SX.car, y);
      if (r.qfy) doc.text(r.qfy, SX.qfyR, y, { align: "right" });
      const rt = fmtReaction(r.reaction);
      if (rt) doc.text(rt, SX.rtR, y, { align: "right" });
      if (r.et) doc.text(fmtET(r.et), SX.etR, y, { align: "right" });
      if (r.mph) doc.text(fitText(doc, r.mph, 32), SX.mphR, y, { align: "right" });
      y += rowH;
    }
    y += catGap;
  }

  // ---------- Round-by-round pages ----------
  const RX = { numR: 74, cls: 82, qfyR: 126, drv: 142, home: 240, car: 324, motor: 386, rtR: 486, diR: 514, etR: 540, mphR: 566 };
  const rRowH = 12;
  const rBottom = H - 44;
  const rRight = 568;

  function drawPageBorder() {
    doc.setLineWidth(0.9);
    doc.rect(30, 30, W - 60, H - 60);
    doc.setLineWidth(0.5);
    doc.rect(34, 34, W - 68, H - 68);
  }
  function banner(docY: number, name: string): number {
    dottedRule(doc, 44, 100, docY - 3);
    doc.setFont("times", "bold");
    doc.setFontSize(11);
    doc.text(name, 106, docY);
    const nw = doc.getTextWidth(name);
    dottedRule(doc, 106 + nw + 6, rRight, docY - 3);
    return docY + 15;
  }

  for (const cat of categories) {
    if (!cat.rounds.length) continue;
    doc.addPage();
    drawPageBorder();
    let ry = 62 + drawLogoRow(doc, event, 44, W, 44);
    doc.setFont("times", "bold");
    doc.setFontSize(14);
    doc.text(seriesLine(event), W / 2, ry, { align: "center" });
    ry += 22;
    doc.setFontSize(12);
    doc.text(cat.name.toUpperCase(), 44, ry);
    const cw = doc.getTextWidth(cat.name.toUpperCase());
    doc.setFont("times", "italic");
    doc.setFontSize(10.5);
    doc.text("Elimination Results", 44 + cw + 10, ry);
    doc.setFont("times", "bold");
    doc.setFontSize(9.5);
    doc.text(event.roundDate || "", rRight, ry, { align: "right" });
    ry += 8;
    doc.setFont("times", "normal");
    doc.setFontSize(8.5);
    const clLabel = cat.brand || event.brand || "AccuTime";
    const clW = doc.getTextWidth(clLabel);
    dottedRule(doc, 44, rRight - clW - 8, ry - 2);
    doc.text(clLabel, rRight, ry, { align: "right" });
    ry += 8;

    doc.setLineWidth(0.8);
    doc.rect(42, ry - 2, rRight - 38, 17);
    doc.setLineWidth(0.4);
    doc.rect(44.5, ry + 0.5, rRight - 43, 12);
    doc.setFont("times", "bold");
    doc.setFontSize(8.5);
    const hy = ry + 9.5;
    doc.text("#", RX.numR, hy, { align: "right" });
    doc.text("Class", RX.cls, hy);
    doc.text("Qfy", RX.qfyR, hy, { align: "right" });
    doc.text("DRIVER", RX.drv, hy);
    doc.text("HOMETOWN", RX.home, hy);
    doc.text("CAR", RX.car, hy);
    doc.text("MOTOR", RX.motor, hy);
    doc.text("REACTION", RX.rtR, hy, { align: "right" });
    doc.text("D/I", RX.diR, hy, { align: "right" });
    doc.text("E.T.", RX.etR, hy, { align: "right" });
    doc.text("MPH", RX.mphR, hy, { align: "right" });
    ry += 24;
    doc.setFont("times", "normal");
    doc.setFontSize(7);
    doc.text("* WINNERS of each pair appear First", 46, ry);
    ry += 12;

    const newPage = (): number => {
      doc.addPage();
      drawPageBorder();
      return 52;
    };

    for (const rd of cat.rounds) {
      if (ry + 13 + rRowH * 2 > rBottom) ry = newPage();
      ry = banner(ry, rd.name);
      for (const pair of rd.pairs) {
        const need = pair.rows.length * rRowH + (pair.single ? rRowH : 0) + 8;
        if (ry + need > rBottom) ry = newPage();
        doc.setFont("times", "normal");
        doc.setFontSize(7.8);
        for (const r of pair.rows) {
          doc.text(r.num || "", RX.numR, ry, { align: "right" });
          doc.text(fitText(doc, r.cls || "", RX.qfyR - 10 - RX.cls), RX.cls, ry);
          if (r.qfy) doc.text(r.qfy, RX.qfyR, ry, { align: "right" });
          doc.text(fitText(doc, r.driver || "", RX.home - RX.drv - 8), RX.drv, ry);
          doc.text(fitText(doc, r.home || "", RX.car - RX.home - 8), RX.home, ry);
          doc.text(fitText(doc, r.car || "", RX.motor - RX.car - 8), RX.car, ry);
          doc.setFontSize(7.3);
          doc.text(fitText(doc, r.motor || "", Math.max(24, RX.rtR - RX.motor - 58)), RX.motor, ry);
          doc.setFontSize(7.8);
          const rt = fmtReaction(r.reaction);
          if (rt) doc.text(rt, RX.rtR, ry, { align: "right" });
          if (r.di) doc.text(r.di, RX.diR, ry, { align: "right" });
          if (r.et) doc.text(fmtET(r.et), RX.etR, ry, { align: "right" });
          if (r.mph) doc.text(fitText(doc, r.mph, 30), RX.mphR, ry, { align: "right" });
          ry += rRowH;
        }
        if (pair.single) {
          doc.setFontSize(8.5);
          doc.text("S i n g l e", RX.drv, ry);
          ry += rRowH;
        }
        ry += 7;
      }
    }
  }

  return new Uint8Array(doc.output("arraybuffer"));
}

// ——— StarTrak-style qualifying PDF ———

export interface QualPdfEntry {
  pos: string;
  num?: string;
  cls?: string;
  driver?: string;
  hometown?: string;
  car?: string;
  motor?: string;
  et?: string;
  index?: string;
  /** over/under the index (blank for heads-up). */
  diff?: string;
}

export interface QualPdfCategory {
  name: string;
  brand?: string;
  lowEt?: string;
  topSpeed?: string;
  /** Draw the dotted "field size" cut line after this many entries. */
  fieldSize?: number;
  hasIndex?: boolean;
  entries: QualPdfEntry[];
}

/**
 * Qualifying order sheet in the StarTrak layout:
 * Pos / # / Class / Driver / Hometown / Car / Motor / E.T. / Index / Ov-Un,
 * with the Low E.T. and Top Speed banner and a dotted cut line after the
 * field-size row when one is set.
 */
export function buildQualifyingPdf(event: PdfEvent, categories: QualPdfCategory[]): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = 612;
  const H = 792;
  const right = 568;
  const bottom = H - 44;

  const QX = { pos: 40, numR: 92, cls: 100, drv: 150, home: 262, car: 356, motor: 430, etR: 500, idxR: 536, ovR: 568 };

  function pageHeader(): number {
    drawBorder();
    let y = 58 + drawLogoRow(doc, event, 44, W, 44);
    doc.setFont("times", "bold");
    doc.setFontSize(14);
    doc.text(seriesLine(event), W / 2, y, { align: "center" });
    y += 18;
    doc.setFontSize(10.5);
    doc.text(event.track || "", W / 2, y, { align: "center" });
    y += 14;
    doc.setFont("times", "bolditalic");
    doc.setFontSize(12);
    doc.text("*****    QUALIFYING RESULTS    *****", W / 2, y, { align: "center" });
    y += 10;
    return y;
  }
  function drawBorder() {
    doc.setLineWidth(0.9);
    doc.rect(30, 30, W - 60, H - 60);
    doc.setLineWidth(0.5);
    doc.rect(34, 34, W - 68, H - 68);
  }

  let first = true;
  for (const cat of categories) {
    if (!first) doc.addPage();
    first = false;
    let y = pageHeader();

    doc.setFont("times", "bold");
    doc.setFontSize(12);
    doc.text(cat.name.toUpperCase(), 40, y);
    const cw = doc.getTextWidth(cat.name.toUpperCase());
    doc.setFont("times", "italic");
    doc.setFontSize(10);
    doc.text("Qualifying", 40 + cw + 10, y);
    doc.setFont("times", "normal");
    doc.setFontSize(8.5);
    doc.text(cat.brand || event.brand || "AccuTime", right, y, { align: "right" });
    y += 6;
    dottedRule(doc, 40, right, y);
    y += 10;

    if (cat.lowEt || cat.topSpeed) {
      doc.setFont("times", "bold");
      doc.setFontSize(9);
      if (cat.lowEt) doc.text("Low E.T.  " + cat.lowEt, 40, y);
      if (cat.topSpeed) doc.text("Top Speed  " + cat.topSpeed, W / 2, y);
      y += 12;
    }

    // Column header
    doc.setFont("times", "bold");
    doc.setFontSize(8.5);
    doc.text("Pos", QX.pos, y);
    doc.text("#", QX.numR, y, { align: "right" });
    doc.text("Class", QX.cls, y);
    doc.text("DRIVER", QX.drv, y);
    doc.text("HOMETOWN", QX.home, y);
    doc.text("CAR", QX.car, y);
    doc.text("MOTOR", QX.motor, y);
    doc.text("E.T.", QX.etR, y, { align: "right" });
    doc.text("Index", QX.idxR, y, { align: "right" });
    doc.text("Ov/Un", QX.ovR, y, { align: "right" });
    y += 4;
    doc.setLineWidth(0.6);
    doc.line(40, y, right, y);
    y += 12;

    doc.setFont("times", "normal");
    doc.setFontSize(8.2);
    let n = 0;
    for (const e of cat.entries) {
      if (y > bottom) {
        doc.addPage();
        y = pageHeader() + 8;
        doc.setFont("times", "normal");
        doc.setFontSize(8.2);
      }
      doc.text(e.pos || "", QX.pos, y);
      if (e.num) doc.text(e.num, QX.numR, y, { align: "right" });
      doc.text(fitText(doc, e.cls || "", QX.drv - QX.cls - 6), QX.cls, y);
      doc.text(fitText(doc, e.driver || "", QX.home - QX.drv - 6), QX.drv, y);
      doc.text(fitText(doc, e.hometown || "", QX.car - QX.home - 6), QX.home, y);
      doc.text(fitText(doc, e.car || "", QX.motor - QX.car - 6), QX.car, y);
      doc.text(fitText(doc, e.motor || "", QX.etR - QX.motor - 40), QX.motor, y);
      if (e.et) doc.text(e.et, QX.etR, y, { align: "right" });
      if (e.index) doc.text(e.index, QX.idxR, y, { align: "right" });
      if (e.diff) doc.text(e.diff, QX.ovR, y, { align: "right" });
      y += 11;
      n++;
      // Field-size cut line: everyone below this didn't make the field.
      if (cat.fieldSize && n === cat.fieldSize && n < cat.entries.length) {
        dottedRule(doc, 40, right, y - 2);
        y += 6;
      }
    }
  }

  return new Uint8Array(doc.output("arraybuffer"));
}

function labelWithDots(label: string): string {
  const pad: Record<string, string> = {
    Champion: "Champion ......",
    "R/U": "R/U ..................",
    "#1 Qualifier": "#1 Qualifier ......",
    "Low E.T.": "Low  E.T. ........",
    "Top Speed": "Top Speed ......",
  };
  return pad[label] || label + " ......";
}
