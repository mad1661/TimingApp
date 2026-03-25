import Papa from "papaparse";
import type { RunRow } from "./db";

interface CsvRow {
  [key: string]: string;
}

const COLUMN_MAP: Record<string, keyof Omit<RunRow, "id" | "created_at" | "is_winner" | "is_dq">> = {
  timestamp: "timestamp",
  round: "round",
  qualpos: "qual_pos",
  qual_pos: "qual_pos",
  carnumber: "car_number",
  car_number: "car_number",
  name: "name",
  classindex: "class_index",
  class_index: "class_index",
  rt: "rt",
  ft60: "ft60",
  ft330: "ft330",
  ft660: "ft660",
  "660mph": "mph_660",
  mph_660: "mph_660",
  ft1000: "ft1000",
  "1000mph": "mph_1000",
  mph_1000: "mph_1000",
  ft1320: "ft1320",
  "1320mph": "mph_1320",
  mph_1320: "mph_1320",
  mov: "mov",
  iswiner: "place",
  iswinner: "place",
  isdq: "place",
  place: "place",
  category: "category",
  lane: "lane",
  dialin: "dial_in",
  dial_in: "dial_in",
  event_code: "event_code",
  event_name: "event_name",
  event_type: "event_type",
  season: "season",
  start_date: "start_date",
};

function parseNum(val: string | undefined): number | null {
  if (!val || val.trim() === "" || val === "\u00a0") return null;
  const n = parseFloat(val.trim());
  return isNaN(n) ? null : n;
}

function cleanText(val: string | undefined): string | null {
  if (!val || val.trim() === "") return null;
  return val.trim();
}

export function parseCsvToRuns(
  csvText: string,
  defaults?: { event_code?: string; event_name?: string; event_type?: string; season?: string; start_date?: string }
): Omit<RunRow, "id" | "created_at">[] {
  const result = Papa.parse<CsvRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, ""),
  });

  const runs: Omit<RunRow, "id" | "created_at">[] = [];

  for (const row of result.data) {
    const mapped: Record<string, unknown> = {};

    for (const [csvCol, value] of Object.entries(row)) {
      const normalizedCol = csvCol.toLowerCase().replace(/\s+/g, "");
      const dbCol = COLUMN_MAP[normalizedCol];
      if (dbCol) {
        if (["rt", "ft60", "ft330", "ft660", "mph_660", "ft1000", "mph_1000", "ft1320", "mph_1320", "mov", "dial_in"].includes(dbCol)) {
          mapped[dbCol] = parseNum(value);
        } else if (dbCol === "qual_pos") {
          mapped[dbCol] = parseNum(value);
        } else {
          mapped[dbCol] = cleanText(value);
        }
      }
    }

    const isWinnerCol = row["iswiner"] || row["IsWiner"] || row["iswinner"] || row["IsWinner"] || "";
    const isDqCol = row["isdq"] || row["IsDQ"] || "";

    const run: Omit<RunRow, "id" | "created_at"> = {
      timestamp: (mapped.timestamp as string) || null,
      round: (mapped.round as string) || null,
      qual_pos: (mapped.qual_pos as number) ?? null,
      car_number: (mapped.car_number as string) || null,
      name: (mapped.name as string) || null,
      class_index: (mapped.class_index as string) || null,
      rt: (mapped.rt as number) ?? null,
      ft60: (mapped.ft60 as number) ?? null,
      ft330: (mapped.ft330 as number) ?? null,
      ft660: (mapped.ft660 as number) ?? null,
      mph_660: (mapped.mph_660 as number) ?? null,
      ft1000: (mapped.ft1000 as number) ?? null,
      mph_1000: (mapped.mph_1000 as number) ?? null,
      ft1320: (mapped.ft1320 as number) ?? null,
      mph_1320: (mapped.mph_1320 as number) ?? null,
      mov: (mapped.mov as number) ?? null,
      is_winner: isWinnerCol.trim() === "W" ? 1 : 0,
      is_dq: isDqCol.trim() !== "" ? 1 : 0,
      result: isWinnerCol.trim() || null,
      place: (mapped.place as string) || null,
      category: (mapped.category as string) || null,
      lane: (mapped.lane as string) || null,
      dial_in: (mapped.dial_in as number) ?? null,
      event_code: (mapped.event_code as string) || defaults?.event_code || null,
      event_name: (mapped.event_name as string) || defaults?.event_name || null,
      event_type: (mapped.event_type as string) || defaults?.event_type || null,
      season: (mapped.season as string) || defaults?.season || null,
      start_date: (mapped.start_date as string) || defaults?.start_date || null,
    };

    if (run.name) {
      runs.push(run);
    }
  }

  return runs;
}
