// Class Eliminations (Stock / Super Stock) — shared, client-safe logic.
//
// Implements the NHRA "Super Stock and Stock Class Elimination Guide":
//   - Any individual class (designation like "SS/BA", "A/SA", "FS/A") with
//     2+ qualified cars races its own class ladder.
//   - Single-car classes are folded into transmission combos:
//       Stock:       Stick Combo / Auto Combo / FS Combo (trans irrelevant)
//       Super Stock: Stick Combo / Auto Combo (SS & GT together) /
//                    FSS+FGT Combo (trans irrelevant)
//   - Ladders are seeded quickest-to-slowest against individual class index
//     (most under first) and paired on NHRA sportsman ladder charts.
//
// This file must stay importable from client components — no firebase here.

// ─── Sportsman ladder charts ───────────────────────────────────────────────
//
// Each chart is the bracket's first-round slot list, top to bottom, exactly
// as printed on NHRA/FIA sportsman ladder sheets. Numbers are qualifying
// positions; null is an empty slot. Consecutive slot pairs form a
// first-round cell: (seed, seed) = pair, (seed, null) = first-round bye,
// (null, null) = structural hole (its round-2 opponent gets a bye).
//
// First-round pairings follow the verified NHRA rule (odd field: #1 bye and
// remainder paired top-half vs bottom-half; even field: 1 v N/2+1, etc.) —
// cross-checked against a published NHRA national-event 19-car ladder.
export const SPORTSMAN_LADDER_CHARTS: Record<number, (number | null)[]> = {
  2: [1, 2],
  3: [1, null, 2, 3],
  4: [1, 3, 2, 4],
  5: [1, null, 3, 5, 2, 4, null, null],
  6: [1, 4, null, null, 2, 5, 3, 6],
  7: [1, null, 3, 6, 2, 5, 4, 7],
  8: [1, 5, 3, 7, 2, 6, 4, 8],
  9: [1, null, 4, 8, 2, 6, null, null, 3, 7, 5, 9, null, null, null, null],
  10: [1, 6, null, null, 3, 8, 5, 10, 2, 7, 4, 9, null, null, null, null],
  11: [1, null, 4, 9, 3, 8, 6, 11, 2, 7, 5, 10, null, null, null, null],
  12: [1, 7, 4, 10, null, null, null, null, 2, 8, 5, 11, 3, 9, 6, 12],
  13: [1, null, 5, 11, 3, 9, 6, 12, 2, 8, null, null, 4, 10, 7, 13],
  14: [1, 8, null, null, 3, 10, 6, 13, 2, 9, 5, 12, 4, 11, 7, 14],
  15: [1, null, 5, 12, 3, 10, 7, 14, 2, 9, 6, 13, 4, 11, 8, 15],
  16: [1, 9, 5, 13, 7, 15, 3, 11, 2, 10, 6, 14, 8, 16, 4, 12],
  17: [1, null, 6, 14, 4, 12, 8, 16, null, null, null, null, null, null, null, null,
      2, 10, null, null, 5, 13, 9, 17, 3, 11, 7, 15, null, null, null, null],
  18: [1, 10, null, null, 4, 13, 8, 17, 2, 11, 6, 15, null, null, null, null,
      3, 12, 7, 16, 5, 14, 9, 18, null, null, null, null, null, null, null, null],
  19: [1, null, 6, 15, 4, 13, 9, 18, 2, 11, 7, 16, null, null, null, null,
      3, 12, 8, 17, 5, 14, 10, 19, null, null, null, null, null, null, null, null],
  20: [1, 11, 6, 16, null, null, null, null, 3, 13, 8, 18, 5, 15, 10, 20,
      2, 12, 7, 17, 4, 14, 9, 19, null, null, null, null, null, null, null, null],
  21: [1, null, 7, 17, 4, 14, 9, 19, 2, 12, null, null, 5, 15, 10, 20,
      3, 13, 8, 18, 6, 16, 11, 21, null, null, null, null, null, null, null, null],
  22: [1, 12, null, null, 4, 15, 9, 20, 3, 14, 8, 19, 6, 17, 11, 22,
      2, 13, 7, 18, 5, 16, 10, 21, null, null, null, null, null, null, null, null],
  23: [1, null, 7, 18, 4, 15, 10, 21, 3, 14, 9, 20, 6, 17, 12, 23,
      2, 13, 8, 19, 5, 16, 11, 22, null, null, null, null, null, null, null, null],
  24: [1, 13, 7, 19, 4, 16, 10, 22, null, null, null, null, null, null, null, null,
      2, 14, 8, 20, 5, 17, 11, 23, 3, 15, 9, 21, 6, 18, 12, 24],
  25: [1, null, 8, 20, 5, 17, 11, 23, 3, 15, 9, 21, null, null, null, null,
      2, 14, null, null, 6, 18, 12, 24, 4, 16, 10, 22, 7, 19, 13, 25],
  26: [1, 14, null, null, 5, 18, 11, 24, 3, 16, 9, 22, 6, 19, 12, 25,
      2, 15, 8, 21, null, null, null, null, 4, 17, 10, 23, 7, 20, 13, 26],
  27: [1, null, 8, 21, 5, 18, 12, 25, 3, 16, 10, 23, 6, 19, 13, 26,
      2, 15, 9, 22, null, null, null, null, 4, 17, 11, 24, 7, 20, 14, 27],
  28: [1, 15, 8, 22, null, null, null, null, 3, 17, 10, 24, 6, 20, 13, 27,
      2, 16, 9, 23, 5, 19, 12, 26, 4, 18, 11, 25, 7, 21, 14, 28],
  29: [1, null, 9, 23, 5, 19, 12, 26, 3, 17, 10, 24, 7, 21, 14, 28,
      2, 16, null, null, 6, 20, 13, 27, 4, 18, 11, 25, 8, 22, 15, 29],
  30: [1, 16, null, null, 5, 20, 12, 27, 3, 18, 10, 25, 7, 22, 14, 29,
      2, 17, 9, 24, 6, 21, 13, 28, 4, 19, 11, 26, 8, 23, 15, 30],
  31: [1, null, 9, 24, 5, 20, 13, 28, 3, 18, 11, 26, 7, 22, 15, 30,
      2, 17, 10, 25, 6, 21, 14, 29, 4, 19, 12, 27, 8, 23, 16, 31],
  32: [1, 17, 9, 25, 5, 21, 13, 29, 3, 19, 11, 27, 7, 23, 15, 31,
      2, 18, 10, 26, 6, 22, 14, 30, 4, 20, 12, 28, 8, 24, 16, 32],
};

// Fallback for oversized fields (>32, extremely rare for class racing):
// same NHRA first-round rule, cells laid out sequentially.
export function chartForSize(n: number): (number | null)[] {
  if (SPORTSMAN_LADDER_CHARTS[n]) return SPORTSMAN_LADDER_CHARTS[n];
  const slots: (number | null)[] = [];
  let pool: number[];
  if (n % 2 === 1) {
    slots.push(1, null);
    pool = [];
    for (let i = 2; i <= n; i++) pool.push(i);
  } else {
    pool = [];
    for (let i = 1; i <= n; i++) pool.push(i);
  }
  const half = pool.length / 2;
  for (let i = 0; i < half; i++) slots.push(pool[i], pool[i + half]);
  // pad to power of two slot count
  let size = 2;
  while (size < slots.length) size *= 2;
  while (slots.length < size) slots.push(null);
  return slots;
}

// ─── Category / transmission classification ───────────────────────────────

export type CategoryKind = "stock" | "super_stock" | "other";

export function categoryKindFor(category: string): CategoryKind {
  const c = (category || "").trim().toUpperCase();
  if (c.includes("SUPER STOCK")) return "super_stock";
  if (c.includes("STOCK")) return "stock"; // "STOCK", "STOCK ELIMINATOR"
  return "other";
}

// Super Stock classes whose designation does NOT encode the transmission
// (from the NHRA class elimination guide: SS/AH, SS/AS–GS, SS/TA–TD,
// SS/AM–GM, SS/AX–EX + SS/VX, and GT/TA–TD). These singles need a manual
// stick/auto call (tech card or Tech).
const SS_TRANS_AMBIGUOUS = /^(SS\/(AH|[A-G]S|[A-G]M|T[A-D]|[A-E]X|VX)|GT\/T[A-D])$/;

export type TransCall = "auto" | "stick" | "unknown";

export function normalizeDesignation(d: string | null | undefined): string {
  return (d || "").trim().toUpperCase().replace(/\s+/g, "");
}

/** Which combo a single-car class rolls into; null means trans must be resolved first. */
export interface ComboAssignment {
  key: string;
  label: string;
}

export const COMBOS: Record<CategoryKind, Record<string, string>> = {
  stock: {
    stick: "Stock Stick Combo",
    auto: "Stock Auto Combo",
    fs: "Stock FS Combo",
  },
  super_stock: {
    stick: "Super Stock Stick Combo",
    auto: "Super Stock Auto Combo",
    factory: "Super Stock FSS/FGT Combo",
  },
  other: {
    all: "Singles Combo",
  },
};

/** True when the combo bucket is decided by the class itself (no trans call needed). */
export function fixedComboFor(designation: string, kind: CategoryKind): ComboAssignment | null {
  const d = normalizeDesignation(designation);
  if (kind === "stock" && d.startsWith("FS")) {
    return { key: "fs", label: COMBOS.stock.fs };
  }
  if (kind === "super_stock" && (d.startsWith("FSS") || d.startsWith("FGT"))) {
    return { key: "factory", label: COMBOS.super_stock.factory };
  }
  if (kind === "other") {
    return { key: "all", label: COMBOS.other.all };
  }
  return null;
}

/** Infer stick/auto from the class designation, when it encodes one. */
export function transmissionFromDesignation(designation: string, kind: CategoryKind): TransCall {
  const d = normalizeDesignation(designation);
  if (!d) return "unknown";
  if (kind === "super_stock" && SS_TRANS_AMBIGUOUS.test(d)) return "unknown";
  const slash = d.indexOf("/");
  const suffix = slash >= 0 ? d.slice(slash + 1) : d;
  if (!suffix) return "unknown";
  // Stock "A/SA" vs "A/S"; Super Stock "SS/BA" vs "SS/B"; GT "GT/BA" vs "GT/B".
  return suffix.endsWith("A") && suffix.length > 1 ? "auto" : "stick";
}

export function comboForTrans(trans: TransCall, kind: CategoryKind): ComboAssignment | null {
  if (trans === "unknown") return null;
  const label = COMBOS[kind]?.[trans];
  return label ? { key: trans, label } : null;
}

// ─── Bracket construction ──────────────────────────────────────────────────

export interface LadderEntry {
  seed: number;
  car_number: string;
  name: string;
  designation: string;
  et: number | null;
  index: number | null;
  underOver: number | null;
}

export type Occupant =
  | { kind: "car"; entry: LadderEntry }
  | { kind: "bye" }
  | { kind: "tbd" }   // winner of an earlier pair — write-in slot
  | { kind: "none" }; // structurally empty

export interface LadderCell {
  top: Occupant;
  bottom: Occupant;
}

export interface BuiltLadder {
  size: number;
  rounds: LadderCell[][]; // rounds[0] = first round
}

function winnerOf(cell: LadderCell): Occupant {
  const cars = [cell.top, cell.bottom].filter((o) => o.kind === "car" || o.kind === "tbd");
  if (cars.length === 0) return { kind: "none" };
  if (cars.length === 2) return { kind: "tbd" };
  // Lone car (opponent bye/none) advances automatically.
  return cars[0];
}

export function buildLadder(entries: LadderEntry[]): BuiltLadder {
  const n = entries.length;
  const slots = chartForSize(n);
  const bySeed = new Map<number, LadderEntry>();
  for (const e of entries) bySeed.set(e.seed, e);

  const firstRound: LadderCell[] = [];
  for (let i = 0; i < slots.length; i += 2) {
    const a = slots[i];
    const b = slots[i + 1];
    const occ = (seed: number | null, partner: number | null): Occupant => {
      if (seed !== null && bySeed.has(seed)) return { kind: "car", entry: bySeed.get(seed)! };
      // Empty slot next to a real car = printed BYE; otherwise structural hole.
      if (partner !== null && bySeed.has(partner)) return { kind: "bye" };
      return { kind: "none" };
    };
    firstRound.push({ top: occ(a, b), bottom: occ(b, a) });
  }

  const rounds: LadderCell[][] = [firstRound];
  while (rounds[rounds.length - 1].length > 1) {
    const prev = rounds[rounds.length - 1];
    const next: LadderCell[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const top = winnerOf(prev[i]);
      const bottom = winnerOf(prev[i + 1]);
      // A live occupant meeting a structural hole shows as a bye on the sheet.
      next.push({
        top: top.kind === "none" && bottom.kind !== "none" ? { kind: "bye" } : top,
        bottom: bottom.kind === "none" && top.kind !== "none" ? { kind: "bye" } : bottom,
      });
    }
    rounds.push(next);
  }
  return { size: n, rounds };
}
