import MDBReader from "mdb-reader";
import type { AccutimeRun } from "./accutime-parse";

/**
 * race.dat reader — server-only (mdb-reader wants Node's Buffer). The file is
 * a "Standard Jet DB" (MS Access) with one table, `Logging`: a row per car per
 * pass. RaceType 0 rows are qualifying sessions, RaceType 1 eliminations;
 * RoundNumber counts within each. Both cars of a pairing share a RunNumber
 * and a TimeStamp. Zeroed timing fields mean "no data" (a BYE lane is a row
 * with CarNumber "BYE" and all zeros).
 */

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

export function parseAccutimeDat(buffer: Buffer): AccutimeRun[] {
  const reader = new MDBReader(buffer);
  const tableName = reader
    .getTableNames()
    .find((t) => t.toLowerCase() === "logging");
  if (!tableName) {
    throw new Error(
      `No Logging table found (tables: ${reader.getTableNames().join(", ") || "none"}) — is this an AccuTime race.dat?`,
    );
  }

  const rows = reader.getTable(tableName).getData();
  const runs: AccutimeRun[] = [];
  for (const r of rows) {
    const ts = r.TimeStamp;
    runs.push({
      runNumber: num(r.RunNumber) ?? 0,
      roundNumber: num(r.RoundNumber) ?? 0,
      raceType: num(r.RaceType) ?? 0,
      treeType: num(r.TreeType) ?? 0,
      winner: r.WinnerFlag === true || r.WinnerFlag === 1 || r.WinnerFlag === -1,
      lane: str(r.Lane).trim(),
      carNumber: str(r.CarNumber).trim(),
      name: str(r.LastName).trim(),
      dialIn: num(r.DialIn),
      rtRaw: num(r.ReactionTime),
      ft60: num(r.ft60),
      ft330: num(r.ft330),
      et18: num(r.et18),
      mph18: num(r.mph18),
      et1000: num(r.et1000),
      mph1000: num(r.mph1000),
      et14: num(r.et14),
      mph14: num(r.mph14),
      timestamp:
        ts instanceof Date ? ts.toISOString() : str(ts),
    });
  }
  // Chronological, so downstream pairing sees pairs in running order.
  runs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return runs;
}
