import * as XLSX from "xlsx";
import type { RunRow } from "./db";

// getresults category name -> tech card category code (TCND export).
// Order matters: first match wins (e.g. SUPER STOCK before STOCK).
const CAT_RULES: [string, string][] = [
  ["HEMI", "SS"],
  ["SUPER STOCK", "SS"],
  ["STOCK", "STK"],
  ["SUPER COMP", "SC"],
  ["SUPER GAS", "SG"],
  ["SUPER STREET", "SST"],
  ["COMP", "COMP"],
  ["TOP DRAGSTER", "TD"],
  ["TOP SPORTSMAN", "TS"],
  ["TOP ALCOHOL DRAGSTER", "TAD"],
  ["TOP ALCOHOL FUNNY", "TAFC"],
  ["TOP FUEL", "TF"],
  ["FUNNY CAR", "FC"],
  ["PRO STOCK MOTORCYCLE", "PSM"],
  ["PRO STOCK", "PS"],
  ["PRO MOD", "PM"],
  ["FACTORY STOCK", "FSS"],
  ["FACTORY X", "FX"],
];

export function mapCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const u = raw.toUpperCase();
  for (const [needle, code] of CAT_RULES) if (u.includes(needle)) return code;
  return null;
}

function normNum(n: string | number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  const s = String(n).trim().toUpperCase().replace(/^0+/, "");
  return s || "0";
}

const isTT = (round: string | null) => /^[TQR]/.test(round || "");

export interface TechCard {
  cat: string;
  num: string;
  name: string;
  cls: string;
  member: string;
  phone: string;
  email: string;
}

export function parseTechCards(buffer: Buffer): TechCard[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, raw: false });
  const hdr = (rows[0] || []).map((h) => String(h ?? "").trim());
  const col = (name: string) => hdr.indexOf(name);
  const iCat = col("Category"), iNum = col("CarBike_Num"),
        iFn = col("First_Name"), iLn = col("Last_Name"),
        iCls = col("Class"), iMem = col("MEMBER_NUM"),
        iPh = col("Phone_Number"), iEm = col("EMAIL_ADDRESS");
  if (iCat < 0 || iNum < 0) {
    throw new Error("Missing Category / CarBike_Num columns — is this a TCND tech card export?");
  }
  const cards: TechCard[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const cat = String(row[iCat] ?? "").trim();
    const num = row[iNum];
    if (!cat || num === undefined || num === null || num === "") continue;
    cards.push({
      cat,
      num: String(num).trim(),
      name: [row[iFn], row[iLn]].filter(Boolean).join(" ").trim(),
      cls: String(row[iCls] ?? "").trim(),
      member: String(row[iMem] ?? "").trim(),
      phone: String(row[iPh] ?? "").trim(),
      email: String(row[iEm] ?? "").trim(),
    });
  }
  return cards;
}

export interface TechNoShowRow {
  category: string;
  car_number: string;
  name: string;
  cls: string;
  member: string;
  phone: string;
}

export interface TechNoShowReport {
  // Tech card holders with zero runs, per category present in timing data
  noRuns: TechNoShowRow[];
  // Ran a T/Q/R round but missing from E1 (only categories where E1 has run)
  missedE1: TechNoShowRow[];
  categoriesInTiming: string[];
  categoriesWithE1: string[];
  techCardCounts: Record<string, number>;
  runCount: number;
  techCardCount: number;
}

export function buildTechNoShowReport(cards: TechCard[], runs: RunRow[]): TechNoShowReport {
  const ranAny = new Map<string, Set<string>>();
  const ranTT = new Map<string, Set<string>>();
  const ranE1 = new Map<string, Set<string>>();
  const runName = new Map<string, string>();
  const catsInTiming = new Set<string>();
  const catsWithE1 = new Set<string>();

  for (const r of runs) {
    const code = mapCategory(r.category);
    if (!code || !r.car_number) continue;
    const n = normNum(r.car_number);
    if (n === null) continue;
    catsInTiming.add(code);
    if (!ranAny.has(code)) ranAny.set(code, new Set());
    ranAny.get(code)!.add(n);
    if (isTT(r.round)) {
      if (!ranTT.has(code)) ranTT.set(code, new Set());
      ranTT.get(code)!.add(n);
    }
    if (r.round === "E1") {
      if (!ranE1.has(code)) ranE1.set(code, new Set());
      ranE1.get(code)!.add(n);
      catsWithE1.add(code);
    }
    if (r.name && !runName.has(`${code}|${n}`)) runName.set(`${code}|${n}`, r.name);
  }

  const techByKey = new Map<string, TechCard>();
  const techCardCounts: Record<string, number> = {};
  for (const c of cards) {
    techByKey.set(`${c.cat}|${normNum(c.num)}`, c);
    techCardCounts[c.cat] = (techCardCounts[c.cat] || 0) + 1;
  }

  const noRuns: TechNoShowRow[] = [];
  for (const cat of [...catsInTiming].sort()) {
    const ran = ranAny.get(cat) || new Set();
    for (const c of cards) {
      if (c.cat !== cat) continue;
      if (!ran.has(normNum(c.num)!)) {
        noRuns.push({ category: cat, car_number: c.num, name: c.name, cls: c.cls, member: c.member, phone: c.phone });
      }
    }
  }
  noRuns.sort((a, b) => a.category.localeCompare(b.category) || a.car_number.localeCompare(b.car_number, undefined, { numeric: true }));

  const missedE1: TechNoShowRow[] = [];
  for (const cat of [...catsWithE1].sort()) {
    const tt = ranTT.get(cat) || new Set();
    const e1 = ranE1.get(cat) || new Set();
    for (const n of [...tt].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      if (e1.has(n)) continue;
      const tc = techByKey.get(`${cat}|${n}`);
      missedE1.push({
        category: cat,
        car_number: n,
        name: runName.get(`${cat}|${n}`) || tc?.name || "",
        cls: tc?.cls || "",
        member: tc?.member || "",
        phone: tc?.phone || "",
      });
    }
  }

  return {
    noRuns,
    missedE1,
    categoriesInTiming: [...catsInTiming].sort(),
    categoriesWithE1: [...catsWithE1].sort(),
    techCardCounts,
    runCount: runs.length,
    techCardCount: cards.length,
  };
}
