import type { RunRow } from "./db";

/**
 * Parser for CompuLink StarTrak "EData" elimination files (C##EDAT.TXT) — the
 * timing system's own export, used when getresults.nhradata.com is down or
 * lagging behind the tower.
 *
 * Shape (CRLF line endings, trailing DOS end-of-file padding):
 *
 *   Compulink StarTrak TOP SPORTSMAN Elimination Results
 *   ROUND 1
 *   175W,935755,TS,19,Stan Wadoski,Union ME,'63 Nova,CHEV  765,  .018,7.45, 7.456,176.72
 *   115,945840,TS,8,Rick Homan,Allentown PA,'08 Colbalt,CHEV  540,,,,
 *   ...
 *   ROUND 2
 *   123,931327,TS,12,Billy Destefano,Warren RI,'02 Camaro,CHEV  655,  .021,7.00, 7.225,191.38
 *   SINGLE,931327,,0,,,,,,,,
 *   FINALS
 *   ...
 *   End of File
 *
 * Twelve comma-separated fields: car number, member number, class, qualifying
 * position, driver, city/state, vehicle, engine, reaction time, dial-in/index,
 * ET, MPH. A car that didn't run leaves the last four blank.
 *
 * **Winners are implicit in the ordering**: within a round the rows are
 * consecutive pairs and the winner is the first row of each pair. A bye is a
 * lone row followed by a `SINGLE,<member number>,...` marker. Verified against
 * every round of the sample files by re-deriving each winner from the timing
 * data — breakouts, red lights and no-shows all agree with the ordering.
 */

export interface EdataParseResult {
  category: string;
  rounds: string[];
  runs: Omit<RunRow, "id" | "created_at">[];
  /** Anything that didn't fit the expected shape, surfaced rather than swallowed. */
  warnings: string[];
}

export interface EdataParseOptions {
  eventCode: string;
  season: string;
  eventName?: string;
  eventType?: string;
  /** Date the rounds ran, "YYYY-MM-DD". Anchors the synthesized timestamps. */
  raceDate?: string;
  /** Overrides the category read from the file's header line. */
  category?: string;
  /** Shown in warnings so a bad file is identifiable in a bulk upload. */
  fileName?: string;
}

const HEADER_RE = /^Compulink\s+StarTrak\s+(.*?)\s+Elimination\s+Results\s*$/i;
const ROUND_RE = /^ROUND\s+(\d+)$/i;
const FINALS_RE = /^(FINALS?|FINAL\s+ROUND)$/i;
// DOS end-of-file padding (0x1A), which trails every EData file.
const DOS_EOF = /\x1A+/g;

function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function text(v: string | undefined): string | null {
  const t = (v || "").trim();
  return t || null;
}

/**
 * Stable small offset per category, so two categories' synthesized timestamps
 * never land on the same second. Pairs are spaced wider than this, so the
 * offset can't bleed into a neighbouring pair.
 */
function categorySlot(category: string): number {
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return h % 19;
}

const PAIR_SPACING_SECONDS = 20;
const ROUND_SPACING_SECONDS = 2 * 60 * 60;
const FIRST_ROUND_HOUR = 8;

/**
 * EData carries no clock time, but the rest of the app identifies a pass by its
 * timestamp — it is how runs dedupe, how the two cars in a pair are grouped,
 * and how everything orders. So each pass gets a synthesized timestamp built
 * only from what is already in the file: the round, the pair's position within
 * it, and the category. Both cars in a pair share one timestamp (that is what
 * makes them a pair), and re-importing the same file reproduces the same
 * timestamps exactly, so a re-import dedupes instead of doubling up.
 *
 * These order the runs; they are not wall-clock times, and the upload page
 * says so.
 */
function synthTimestamp(
  raceDate: string | undefined,
  category: string,
  roundIndex: number,
  pairIndex: number,
): string {
  const base = raceDate && /^\d{4}-\d{2}-\d{2}$/.test(raceDate) ? raceDate : null;
  const [y, m, d] = base
    ? base.split("-").map((n) => parseInt(n, 10))
    : (() => {
        const now = new Date();
        return [now.getFullYear(), now.getMonth() + 1, now.getDate()];
      })();

  const offset =
    roundIndex * ROUND_SPACING_SECONDS + pairIndex * PAIR_SPACING_SECONDS + categorySlot(category);
  const when = new Date(y, m - 1, d, FIRST_ROUND_HOUR, 0, offset);

  let hour = when.getHours();
  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${when.getMonth() + 1}/${when.getDate()}/${when.getFullYear()} ${hour}:${p(
    when.getMinutes(),
  )}:${p(when.getSeconds())} ${ampm}`;
}

interface DataLine {
  fields: string[];
  lineNo: number;
}

function isSingleMarker(fields: string[]): boolean {
  return (fields[0] || "").trim().toUpperCase() === "SINGLE";
}

export function parseEdataFile(raw: string, opts: EdataParseOptions): EdataParseResult {
  const label = opts.fileName ? `${opts.fileName}: ` : "";
  const warnings: string[] = [];

  const lines = raw
    // Strip the DOS padding first, or the tail parses as one garbage line.
    .replace(DOS_EOF, "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd());

  let category = (opts.category || "").trim();
  let fileCategory = "";
  for (const line of lines) {
    const m = line.trim().match(HEADER_RE);
    if (m) {
      fileCategory = m[1].trim();
      break;
    }
  }
  if (!category) category = fileCategory;
  if (!category) {
    warnings.push(
      `${label}no "Compulink StarTrak ... Elimination Results" header line — set the class by hand.`,
    );
  }

  // Group data lines by round, in file order.
  const roundBuckets: { round: string; lines: DataLine[] }[] = [];
  let current: { round: string; lines: DataLine[] } | null = null;

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (!trimmed) return;
    if (HEADER_RE.test(trimmed)) return;
    if (/^End of File$/i.test(trimmed)) return;

    const roundMatch = trimmed.match(ROUND_RE);
    if (roundMatch) {
      current = { round: `E${parseInt(roundMatch[1], 10)}`, lines: [] };
      roundBuckets.push(current);
      return;
    }
    if (FINALS_RE.test(trimmed)) {
      current = { round: "F", lines: [] };
      roundBuckets.push(current);
      return;
    }

    if (!trimmed.includes(",")) {
      warnings.push(`${label}line ${lineNo}: unrecognized line "${trimmed.slice(0, 60)}"`);
      return;
    }
    if (!current) {
      warnings.push(`${label}line ${lineNo}: data before any round heading — skipped.`);
      return;
    }
    current.lines.push({ fields: line.split(","), lineNo });
  });

  const runs: Omit<RunRow, "id" | "created_at">[] = [];
  const rounds: string[] = [];

  roundBuckets.forEach((bucket, roundIndex) => {
    if (bucket.lines.length === 0) return;
    rounds.push(bucket.round);
    let pairIndex = 0;
    let pending: DataLine | null = null;

    const emit = (dl: DataLine, isWinner: boolean, ts: string) => {
      const f = dl.fields;
      runs.push({
        timestamp: ts,
        round: bucket.round,
        qual_pos: num(f[3]),
        car_number: text(f[0]),
        name: text(f[4]),
        member_number: text(f[1]),
        class_index: text(f[2]),
        rt: num(f[8]),
        ft60: null,
        ft330: null,
        ft660: null,
        mph_660: null,
        ft1000: null,
        mph_1000: null,
        ft1320: num(f[10]),
        mph_1320: num(f[11]),
        mov: null,
        is_winner: isWinner ? 1 : 0,
        is_dq: 0,
        // EData states the outcome through the ordering, so record it
        // explicitly and nothing downstream has to re-derive it.
        result: isWinner ? "W" : "L",
        place: null,
        category: category || null,
        lane: null, // EData doesn't record which lane a car ran in.
        dial_in: num(f[9]),
        event_code: opts.eventCode,
        event_name: opts.eventName || null,
        event_type: opts.eventType || null,
        season: opts.season,
        start_date: opts.raceDate || null,
        _ts_exact: true,
      } as Omit<RunRow, "id" | "created_at">);
    };

    for (let i = 0; i < bucket.lines.length; i++) {
      const dl = bucket.lines[i];
      if (isSingleMarker(dl.fields)) {
        if (!pending) {
          // Markers always follow their car, so one arriving with nothing
          // pending means the pairing above it was already consumed.
          warnings.push(
            `${label}line ${dl.lineNo}: SINGLE marker with no preceding car in ${bucket.round}.`,
          );
        }
        continue;
      }

      const next = bucket.lines[i + 1];
      if (next && isSingleMarker(next.fields)) {
        if (pending) {
          // An odd row still waiting means a pairing was lost upstream. Emit it
          // as a winner rather than dropping the run, and say so.
          warnings.push(
            `${label}line ${pending.lineNo}: unpaired car "${pending.fields[0]}" in ${bucket.round} — recorded as a win.`,
          );
          emit(pending, true, synthTimestamp(opts.raceDate, category, roundIndex, pairIndex++));
          pending = null;
        }
        emit(dl, true, synthTimestamp(opts.raceDate, category, roundIndex, pairIndex++));
        i++; // step over the marker we just consumed
        continue;
      }

      if (!pending) {
        pending = dl;
      } else {
        const ts = synthTimestamp(opts.raceDate, category, roundIndex, pairIndex++);
        emit(pending, true, ts);
        emit(dl, false, ts);
        pending = null;
      }
    }

    if (pending) {
      warnings.push(
        `${label}line ${pending.lineNo}: car "${pending.fields[0]}" left unpaired at the end of ${bucket.round} — recorded as a win.`,
      );
      emit(pending, true, synthTimestamp(opts.raceDate, category, roundIndex, pairIndex++));
    }
  });

  if (runs.length === 0) warnings.push(`${label}no round results found.`);

  return { category: category || "", rounds, runs, warnings };
}
