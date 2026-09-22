import { jsPDF } from "jspdf";

/**
 * "Final Round Results" PDF — a faithful port of the racedata-zip-to-pdf
 * builder (markdawson-playground.web.app/racedata-zip-to-pdf): page one is the
 * ***** FINAL ROUND RESULTS ***** summary (Champion / R/U / #1 Qualifier /
 * Low E.T. / Top Speed per category), then each category's round-by-round
 * elimination sheet on its own page(s). Input is the same thing that tool
 * eats: CxxEDAT/CxxQDAT text contents keyed by channel number — here fed with
 * the files this app just generated, so the PDF always matches the downloads.
 * Layout coordinates are copied from that tool so the output is identical.
 */

export interface FinalRoundChannel {
  EDAT?: string;
  QDAT?: string;
}

export interface FinalRoundEvent {
  /** "September 18-21, 2026" — top left of the summary page. */
  dates: string;
  track: string;
  /** "City, State" — top right. */
  location: string;
  /** Series title over each round sheet, e.g. "NHRA MISSION FOODS DRAG RACING SERIES". */
  series: string;
  /** "21/SEP/2026" — right of each round sheet's title. */
  roundDate: string;
}

interface SummaryRow {
  label: string;
  num: string;
  driver: string;
  hometown: string;
  car: string;
  qfy: string;
  reaction: string;
  et: string;
  mph: string;
}

interface RoundRow {
  num: string;
  cls: string;
  qfy: string;
  driver: string;
  home: string;
  car: string;
  motor: string;
  reaction: string;
  di: string;
  et: string;
  mph: string;
}

interface Pair {
  rows: RoundRow[];
  single: boolean;
}

interface Round {
  name: string;
  pairs: Pair[];
}

interface Category {
  name: string;
  rows: SummaryRow[];
  rounds: Round[];
  hasDI: boolean;
}

const BRAND = "CompuLink StarTrak";

function spaceOut(s: string): string {
  return s.split("").join(" ");
}
function fmtReaction(r: string): string {
  if (!r) return "";
  return /^-/.test(r) ? `foul ${r}` : r;
}
function fmtET(v: string): string {
  if (!v) return "";
  return /^[A-Za-z]+$/.test(v) ? spaceOut(v.toUpperCase()) : v;
}
function stripEofJunk(s: string): string {
  return String(s || "").replace(/\u001a/g, "").trim();
}
function edatFields(line: string): string[] {
  return line.split(",").map((s) => s.trim());
}

function headerCategoryName(line: string): string | null {
  const t = stripEofJunk(line);
  const m =
    t.match(/(?:Compulink\s+)?StarTrak\s+(.+?)\s+Elimination Results/i) ||
    t.match(/(?:Compulink\s+)?StarTrak\s+(.+?)\s+Qualifying/i);
  return m ? m[1].replace(/\s+/g, " ").trim().toUpperCase() : null;
}

function roundRowFrom(f: string[]): RoundRow {
  return {
    num: f[0] || "",
    cls: f[2] || "",
    qfy: f[3] && f[3] !== "0" ? f[3] : "",
    driver: f[4] || "",
    home: f[5] || "",
    car: f[6] || "",
    motor: (f[7] || "").replace(/\s+/g, " ").trim(),
    reaction: fmtReaction(f[8] || ""),
    di: f[9] || "",
    et: fmtET(f[10] || ""),
    mph: f[11] || "",
  };
}

export function parseEdatRounds(text: string): { rounds: Round[]; hasDI: boolean } {
  const lines = text.split(/\r?\n/);
  const rounds: Round[] = [];
  let cur: Round | null = null;
  let openPair: Pair | null = null;
  let hasDI = false;

  const ensureRound = (name: string) => {
    cur = { name, pairs: [] };
    rounds.push(cur);
    openPair = null;
  };

  for (let i = 1; i < lines.length; i++) {
    const t = stripEofJunk(lines[i]);
    if (!t || /^End of File/i.test(t)) continue;
    const mR = t.match(/^(ROUND\s+\d+|SEMI\s*FINALS?|QUARTER\s*FINALS?|FINALS)$/i);
    if (mR) {
      ensureRound(mR[1].toUpperCase().replace(/\s+/g, " "));
      continue;
    }
    if (/^SINGLE,/i.test(t)) {
      if (cur && (cur as Round).pairs.length) {
        (cur as Round).pairs[(cur as Round).pairs.length - 1].single = true;
      }
      openPair = null;
      continue;
    }
    const f = edatFields(t);
    if (f.length < 11) continue;
    if (!cur) ensureRound("ROUND 1");
    const r = roundRowFrom(f);
    if (r.di && parseFloat(r.di) !== 0) hasDI = true;
    if (!openPair) {
      openPair = { rows: [r], single: false };
      (cur as unknown as Round).pairs.push(openPair);
    } else {
      openPair.rows.push(r);
      openPair = null;
    }
  }
  return { rounds, hasDI };
}

function pickFinals(rounds: Round[]): Round | null {
  return rounds.find((r) => /^FINALS$/i.test(r.name)) || null;
}

/** Same summary extraction as the playground: finals pair + QDAT callouts. */
export function categoriesFromChannels(channels: Record<number, FinalRoundChannel>): Category[] {
  const keys = Object.keys(channels)
    .map(Number)
    .sort((a, b) => a - b);
  const cats: Category[] = [];

  for (const ch of keys) {
    const files = channels[ch];
    if (!files.EDAT && !files.QDAT) continue;

    let name: string | null = null;
    let rounds: Round[] = [];
    let hasDI = false;
    if (files.EDAT) {
      name = headerCategoryName(files.EDAT.split(/\r?\n/)[0]);
      const rr = parseEdatRounds(files.EDAT);
      rounds = rr.rounds;
      hasDI = rr.hasDI;
    }
    if (!name && files.QDAT) name = headerCategoryName(files.QDAT.split(/\r?\n/)[0]);
    if (!name) name = `CATEGORY ${ch}`;

    const rows: SummaryRow[] = [];
    const finals = pickFinals(rounds);
    if (finals && finals.pairs.length) {
      const fp = finals.pairs[0].rows;
      const asSummary = (label: string, r: RoundRow): SummaryRow => ({
        label,
        num: r.num,
        driver: r.driver,
        hometown: r.home,
        car: r.car,
        qfy: r.qfy,
        reaction: r.reaction,
        et: r.et,
        mph: r.mph,
      });
      if (fp[0]) rows.push(asSummary("Champion", fp[0]));
      if (fp[1]) rows.push(asSummary("R/U", fp[1]));
    }

    if (files.QDAT) {
      const qlines = files.QDAT.split(/\r?\n/);
      let lowET: { val: string; num: string; name: string } | null = null;
      let topSpd: { val: string; num: string; name: string } | null = null;
      const dataRows: string[][] = [];
      for (const l of qlines.slice(1)) {
        const t = stripEofJunk(l);
        if (!t || /^End of File/i.test(t)) continue;
        let m = t.match(/^Low ET\s+([\d.]+)\s+(\S+)\s*(.*)$/i);
        if (m) {
          lowET = { val: m[1], num: m[2], name: m[3].trim() };
          continue;
        }
        m = t.match(/^Top Speed\s+([\d.]+)\s+(\S+)\s*(.*)$/i);
        if (m) {
          topSpd = { val: m[1], num: m[2], name: m[3].trim() };
          continue;
        }
        if (t.split(",").length >= 10) dataRows.push(t.split(",").map((s) => s.trim()));
      }
      const lookup: Record<string, { car: string; hometown: string; driver: string }> = {};
      for (const f of dataRows) {
        if (!lookup[f[0]]) lookup[f[0]] = { car: f[3] || "", hometown: f[9] || "", driver: f[8] || "" };
      }
      if (dataRows[0]) {
        const f0 = dataRows[0];
        const mphv = parseFloat(f0[11]);
        rows.push({
          label: "#1 Qualifier",
          num: f0[0] || "",
          driver: f0[8] || "",
          hometown: f0[9] || "",
          car: f0[3] || "",
          qfy: "",
          reaction: "",
          et: f0[10] || "",
          mph: mphv > 30 ? f0[11] : "",
        });
      }
      if (lowET && parseFloat(lowET.val) > 0) {
        const lk = lookup[lowET.num] || { car: "", hometown: "", driver: "" };
        rows.push({
          label: "Low E.T.",
          num: lowET.num,
          driver: lowET.name || lk.driver,
          hometown: lk.hometown,
          car: lk.car,
          qfy: "",
          reaction: "",
          et: lowET.val,
          mph: "",
        });
      }
      if (topSpd && parseFloat(topSpd.val) > 0) {
        const lk = lookup[topSpd.num] || { car: "", hometown: "", driver: "" };
        rows.push({
          label: "Top Speed",
          num: topSpd.num,
          driver: topSpd.name || lk.driver,
          hometown: lk.hometown,
          car: lk.car,
          qfy: "",
          reaction: "",
          et: "",
          mph: topSpd.val,
        });
      }
    }

    if (rows.length || rounds.length) cats.push({ name, rows, rounds, hasDI });
  }
  return cats;
}

const W = 612;
const H = 792;

function labelWithDots(label: string): string {
  const pad: Record<string, string> = {
    "Champion": "Champion ......",
    "R/U": "R/U ..................",
    "#1 Qualifier": "#1 Qualifier ......",
    "Low E.T.": "Low  E.T. ........",
    "Top Speed": "Top Speed ......",
  };
  return pad[label] || `${label} ......`;
}

function fitText(doc: jsPDF, txt: string, maxW: number): string {
  let t = String(txt || "");
  if (doc.getTextWidth(t) <= maxW) return t;
  while (t.length > 1 && doc.getTextWidth(t) > maxW) t = t.slice(0, -1);
  return t;
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

export function buildFinalRoundPdf(
  channels: Record<number, FinalRoundChannel>,
  ev: FinalRoundEvent,
): jsPDF {
  const cats = categoriesFromChannels(channels);
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  /* ---------- Summary page(s) ---------- */
  let y = 64;
  doc.setFont("times", "bold");
  doc.setFontSize(10.5);
  doc.text(ev.dates, 36, y);
  doc.text(ev.track, W / 2, y, { align: "center" });
  doc.text(ev.location, W - 36, y, { align: "right" });
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
  doc.text(BRAND, W - 36, y, { align: "right" });
  doc.setTextColor(0);
  y += 14;

  const SX = { lbl: 48, num: 118, drv: 160, home: 256, car: 348, qfyR: 422, rtR: 498, etR: 534, mphR: 564 };
  const rowH = 11;
  const headH = 15;
  const catGap = 9;
  const bottom = H - 34;

  for (const cat of cats) {
    if (y + Math.min(headH + cat.rows.length * rowH + catGap, headH + 2 * rowH) > bottom) {
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
      if (r.num) doc.text(`# ${r.num}`, SX.num, y);
      doc.text(fitText(doc, r.driver, SX.home - SX.drv - 6), SX.drv, y);
      doc.text(fitText(doc, r.hometown, SX.car - SX.home - 6), SX.home, y);
      doc.text(fitText(doc, r.car, SX.qfyR - 22 - SX.car), SX.car, y);
      if (r.qfy) doc.text(r.qfy, SX.qfyR, y, { align: "right" });
      if (r.reaction) doc.text(r.reaction, SX.rtR, y, { align: "right" });
      if (r.et) doc.text(r.et, SX.etR, y, { align: "right" });
      if (r.mph) doc.text(fitText(doc, r.mph, 32), SX.mphR, y, { align: "right" });
      y += rowH;
    }
    y += catGap;
  }

  /* ---------- Round-by-round pages ---------- */
  const RX = { numR: 74, cls: 82, qfyR: 126, drv: 142, home: 240, car: 324, motor: 386, rtR: 486, diR: 514, etR: 540, mphR: 566 };
  const rRowH = 12;
  const rBottom = H - 44;
  const rRight = 568;

  const drawPageBorder = () => {
    doc.setLineWidth(0.9);
    doc.rect(30, 30, W - 60, H - 60);
    doc.setLineWidth(0.5);
    doc.rect(34, 34, W - 68, H - 68);
  };
  const banner = (docY: number, name: string): number => {
    dottedRule(doc, 44, 100, docY - 3);
    doc.setFont("times", "bold");
    doc.setFontSize(11);
    doc.text(name, 106, docY);
    const nw = doc.getTextWidth(name);
    dottedRule(doc, 106 + nw + 6, rRight, docY - 3);
    return docY + 15;
  };

  for (const cat of cats) {
    if (!cat.rounds.length) continue;
    doc.addPage();
    drawPageBorder();
    let ry = 62;
    doc.setFont("times", "bold");
    doc.setFontSize(14);
    doc.text(ev.series, W / 2, ry, { align: "center" });
    ry += 22;
    doc.setFontSize(12);
    doc.text(cat.name.toUpperCase(), 44, ry);
    const cw = doc.getTextWidth(cat.name.toUpperCase());
    doc.setFont("times", "italic");
    doc.setFontSize(10.5);
    doc.text("Elimination Results", 44 + cw + 10, ry);
    doc.setFont("times", "bold");
    doc.setFontSize(9.5);
    doc.text(ev.roundDate, rRight, ry, { align: "right" });
    ry += 8;
    doc.setFont("times", "normal");
    doc.setFontSize(8.5);
    const clW = doc.getTextWidth(BRAND);
    dottedRule(doc, 44, rRight - clW - 8, ry - 2);
    doc.text(BRAND, rRight, ry, { align: "right" });
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
    if (cat.hasDI) doc.text("D/I", RX.diR, hy, { align: "right" });
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
          doc.text(r.num, RX.numR, ry, { align: "right" });
          doc.text(fitText(doc, r.cls, RX.qfyR - 10 - RX.cls), RX.cls, ry);
          if (r.qfy) doc.text(r.qfy, RX.qfyR, ry, { align: "right" });
          doc.text(fitText(doc, r.driver, RX.home - RX.drv - 8), RX.drv, ry);
          doc.text(fitText(doc, r.home, RX.car - RX.home - 8), RX.home, ry);
          doc.text(fitText(doc, r.car, RX.motor - RX.car - 8), RX.car, ry);
          doc.setFontSize(7.3);
          doc.text(fitText(doc, r.motor, Math.max(24, RX.rtR - RX.motor - 58)), RX.motor, ry);
          doc.setFontSize(7.8);
          if (r.reaction) doc.text(r.reaction, RX.rtR, ry, { align: "right" });
          if (r.di && cat.hasDI) doc.text(r.di, RX.diR, ry, { align: "right" });
          if (r.et) doc.text(r.et, RX.etR, ry, { align: "right" });
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

  return doc;
}
