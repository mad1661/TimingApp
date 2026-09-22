import {
  EdataTechCard,
  bodyString,
  cityState,
  csvSafe,
  engineString,
  fullName,
  indexTechCards,
  norm,
  techCardMatchesCategory,
} from "./edata-export";
import type { QlyEntry } from "./accutime-parse";

/**
 * Builder for CompuLink StarTrak "QDAT" qualifying files (C##QDAT.TXT), the
 * qualifying sibling of edata-export.ts. Layout copied byte-for-byte from real
 * Compulink files (C12QDAT/C13QDAT Super Stock + Stock, C3QDAT a no-index
 * junior class):
 *
 *   Compulink StarTrak SUPER STOCK Qualifying for 27 entries
 *   Low ET 9.548 1986 Shane Oakes
 *   Top Speed 155.27 101N Anthony Jarvis
 *   1986,359497,SS/IA,'98 Formula Ws6,1998,CHEV  350,285,279,Shane Oakes,Ottsville PA,9.548,10.70,-1.152
 *   ...
 *   End of File
 *
 * Thirteen comma-separated fields: car number, member number, class, body
 * ('YY Make Model), engine year, engine (MAKE  CID), advertised HP, factored
 * HP, driver (full name), city + state, ET (3 decimals), index (2 decimals,
 * four spaces when the class has none), over/under (ET − index, 3 decimals).
 * A car with no clean ET prints "  DQ  " in the ET column with over/under
 * computed from a 32-second ET, exactly as the samples do, and doesn't count
 * toward the header's entry count. Everything except car/driver/ET/MPH comes
 * from the event's tech cards, matched by car number first, name second.
 */

export interface QdatListingRow {
  position: number | null;
  car: string;
  classCode: string;
  driver: string;
  hometown: string;
  body: string;
  motor: string;
  et: number | null;
  mph: number | null;
  index: number | null;
  ovUn: number | null;
  dq: boolean;
  enriched: boolean;
}

export interface QdatBest {
  value: number;
  car: string;
  driver: string;
}

export interface QdatFile {
  /** CompuLink-style name: C{channel}QDAT.TXT. */
  filename: string;
  category: string;
  classCode: string;
  rows: QdatListingRow[];
  /** Rows with a clean ET — the header's "for N entries" count. */
  qualified: number;
  lowEt: QdatBest | null;
  topSpeed: QdatBest | null;
  hasIndex: boolean;
  enriched: number;
  content: string;
}

const EOL = "\r\n";
/** The samples' DQ sentinel: over/under is computed from a 32-second pass. */
const DQ_ET = 32;

export interface BuildQdatOptions {
  /** Class name for the header (e.g. "FUNNY CAR"). */
  category: string;
  /** Fallback per-row class code when no tech card carries one (e.g. "FC"). */
  classCode: string;
  /** CompuLink channel number → C{n}QDAT.TXT. */
  channel: number;
  /** Per-car index/dial (upper-cased car number → index), for index classes. */
  indexByCar?: Map<string, number>;
}

function digits(s: string | undefined): string {
  return ((s || "").match(/\d+/) || [""])[0];
}

export function buildQdatFile(
  entries: QlyEntry[],
  techCards: EdataTechCard[],
  opts: BuildQdatOptions,
): QdatFile {
  const category = opts.category.trim().toUpperCase();
  const tech = indexTechCards(
    techCards.filter((tc) => techCardMatchesCategory(tc, category, opts.classCode)),
  );

  const rows: QdatListingRow[] = [];
  const lines: string[] = [];
  let enriched = 0;

  // DQ rows (no clean ET) sink to the bottom, like the samples.
  const ordered = [...entries].sort((a, b) => {
    if ((a.et === null) !== (b.et === null)) return a.et === null ? 1 : -1;
    return a.position - b.position;
  });

  for (const e of ordered) {
    const tc = tech.byCar.get(norm(e.car)) || tech.byName.get(norm(e.driver)) || null;
    if (tc) enriched++;
    const index = opts.indexByCar?.get(e.car.trim().toUpperCase()) ?? null;
    const ovUn = e.et !== null ? e.et - (index ?? 0) : DQ_ET - (index ?? 0);

    rows.push({
      position: e.et !== null ? rows.filter((r) => !r.dq).length + 1 : null,
      car: csvSafe(e.car),
      classCode: csvSafe(tc?.category || "") || opts.classCode,
      driver: (tc ? fullName(tc) : "") || csvSafe(e.driver),
      hometown: tc ? cityState(tc) : "",
      body: tc ? bodyString(tc) : "",
      motor: tc ? engineString(tc) : "",
      et: e.et,
      mph: e.mph,
      index,
      ovUn,
      dq: e.et === null,
      enriched: !!tc,
    });
  }

  const qualified = rows.filter((r) => !r.dq);
  const lowEtRow = qualified.reduce<QdatListingRow | null>(
    (best, r) => (r.et !== null && (best === null || r.et < best.et!) ? r : best),
    null,
  );
  const topSpeedRow = rows.reduce<QdatListingRow | null>(
    (best, r) => (r.mph !== null && (best === null || r.mph > best.mph!) ? r : best),
    null,
  );

  lines.push(`Compulink StarTrak ${category} Qualifying for ${qualified.length} entries`);
  if (lowEtRow) lines.push(`Low ET ${lowEtRow.et!.toFixed(3)} ${lowEtRow.car} ${lowEtRow.driver}`);
  if (topSpeedRow) lines.push(`Top Speed ${topSpeedRow.mph!.toFixed(2)} ${topSpeedRow.car} ${topSpeedRow.driver}`);

  for (const r of rows) {
    const tc = tech.byCar.get(norm(r.car)) || tech.byName.get(norm(r.driver)) || null;
    const fields = [
      r.car,
      (tc ? csvSafe(tc.member_number || "") : "") || "0",
      r.classCode,
      r.body,
      tc ? digits(tc.engine_year) : "",
      r.motor,
      tc ? digits(tc.hp) || "0" : "",
      tc ? digits(tc.factored_hp) || "0" : "",
      r.driver,
      r.hometown,
      r.dq ? "  DQ  " : r.et!.toFixed(3),
      r.index !== null ? r.index.toFixed(2) : "    ",
      r.ovUn !== null ? r.ovUn.toFixed(3) : "",
    ];
    lines.push(fields.join(","));
  }

  lines.push("End of File");

  return {
    filename: `C${opts.channel}QDAT.TXT`,
    category,
    classCode: opts.classCode,
    rows,
    qualified: qualified.length,
    lowEt: lowEtRow ? { value: lowEtRow.et!, car: lowEtRow.car, driver: lowEtRow.driver } : null,
    topSpeed: topSpeedRow ? { value: topSpeedRow.mph!, car: topSpeedRow.car, driver: topSpeedRow.driver } : null,
    hasIndex: rows.some((r) => r.index !== null),
    enriched,
    content: lines.join(EOL) + EOL,
  };
}

/**
 * Real Compulink disk files are 0x1A-padded to a 128-byte block boundary
 * (both attached QDAT samples are). Reproduced so a byte-compare against a
 * real file lines up; harmless to every parser (0x1A is the DOS EOF mark).
 */
export function padToCompulinkBlock(bytes: Uint8Array): Uint8Array {
  const rem = bytes.length % 128;
  if (rem === 0) return bytes;
  const out = new Uint8Array(bytes.length + (128 - rem));
  out.set(bytes);
  out.fill(0x1a, bytes.length);
  return out;
}
