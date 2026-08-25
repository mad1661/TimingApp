import * as XLSX from "xlsx";
import type { EtDivision, EtFinalsRoster, EtRosterEntry } from "./et-finals";

/**
 * Parse a combined ET Finals / JDRL team roster workbook (the 2026 divisional
 * template with "Team & Instructions", "Summit ET Roster" and
 * "JDRL & Jr Street" sheets) into a roster record.
 *
 * The template is filled in by hand at each track, so nothing here is assumed
 * to be at a fixed cell: sheets and columns are found by their header text and
 * every field tolerates being blank.
 */

type Grid = string[][];

function readGrid(workbook: XLSX.WorkBook, sheetName: string | undefined): Grid {
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" }).map((row) =>
    (row || []).map((cell) => (cell === null || cell === undefined ? "" : String(cell).trim())),
  );
}

function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findSheet(workbook: XLSX.WorkBook, ...needles: string[]): string | undefined {
  return workbook.SheetNames.find((n) => {
    const nn = norm(n);
    return needles.every((needle) => nn.includes(norm(needle)));
  });
}

/** Find the header row by the columns it must contain, then map header -> index. */
function findHeader(grid: Grid, required: string[]): { row: number; cols: Map<string, number> } | null {
  for (let i = 0; i < Math.min(grid.length, 60); i++) {
    const row = grid[i] || [];
    const normed = row.map(norm);
    if (required.every((req) => normed.some((c) => c === norm(req) || c.includes(norm(req))))) {
      const cols = new Map<string, number>();
      normed.forEach((c, idx) => {
        if (c && !cols.has(c)) cols.set(c, idx);
      });
      return { row: i, cols };
    }
  }
  return null;
}

function colGetter(row: string[], cols: Map<string, number>) {
  return (...names: string[]): string => {
    for (const name of names) {
      const target = norm(name);
      let idx = cols.get(target);
      if (idx === undefined) {
        for (const [header, i] of cols) {
          if (header.includes(target)) {
            idx = i;
            break;
          }
        }
      }
      if (idx !== undefined) {
        const v = (row[idx] || "").trim();
        if (v) return v;
      }
    }
    return "";
  };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Undo Excel's date coercion of junior age brackets: typing "10-12" leaves the
 * cell reading "12-Oct" and "6-9" becomes "9-Jun". Anything that isn't an
 * age-group-shaped date is returned untouched.
 */
export function repairAgeGroup(raw: string): string {
  const v = (raw || "").trim();
  const m = v.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,})$/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month) return `${month}-${parseInt(m[1], 10)}`;
  }
  const m2 = v.match(/^([A-Za-z]{3,})[-/\s](\d{1,2})$/);
  if (m2) {
    const month = MONTHS[m2[1].slice(0, 3).toLowerCase()];
    if (month) return `${month}-${parseInt(m2[2], 10)}`;
  }
  return v;
}

/** Scan a label/value sheet for `label` in column N, taking column N+1. */
function labelValue(grid: Grid, ...labels: string[]): string {
  const wanted = labels.map(norm);
  for (const row of grid) {
    for (let c = 0; c < row.length - 1; c++) {
      const cell = norm(row[c]);
      if (!cell) continue;
      if (wanted.some((w) => cell === w || cell.startsWith(w))) {
        for (let n = c + 1; n < Math.min(row.length, c + 4); n++) {
          const v = (row[n] || "").trim();
          if (v) return v;
        }
      }
    }
  }
  return "";
}

function combineCarNumber(vehicle: string, trackCode: string): string {
  const v = (vehicle || "").trim();
  if (!v) return "";
  const t = (trackCode || "").trim().toUpperCase();
  return t ? `${v}${t}` : v;
}

interface ParseOptions {
  /** Original filename, used to name a roster whose team fields are blank. */
  fileName?: string;
  /** Overrides for a template that was submitted with the header left empty. */
  trackCode?: string;
  teamName?: string;
  season?: string;
}

function baseName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

export function parseEtFinalsRosterWorkbook(buffer: Buffer, opts: ParseOptions = {}): EtFinalsRoster {
  const workbook = XLSX.read(buffer, { type: "buffer" });

  const infoGrid = readGrid(workbook, findSheet(workbook, "team") || workbook.SheetNames[0]);
  const etGrid = readGrid(workbook, findSheet(workbook, "summit", "roster") || findSheet(workbook, "et roster"));
  const jrGrid = readGrid(workbook, findSheet(workbook, "jdrl") || findSheet(workbook, "jr"));

  const entries: EtRosterEntry[] = [];

  // ── Summit E.T. roster: every filled row earns team points ───────────────
  let etTrackCode = "";
  const etHeader = findHeader(etGrid, ["slot", "driver name"]);
  if (etHeader) {
    for (let i = etHeader.row + 1; i < etGrid.length; i++) {
      const row = etGrid[i] || [];
      const get = colGetter(row, etHeader.cols);
      const name = get("driver name");
      if (!name) continue;
      const trackCode = get("track code").toUpperCase();
      if (trackCode && !etTrackCode) etTrackCode = trackCode;
      const vehicle = get("vehicle");
      entries.push({
        division: "big",
        slot: parseInt(get("slot"), 10) || i - etHeader.row,
        roster_role: get("roster role"),
        points_eligible: true,
        category: get("category"),
        vehicle_number: vehicle,
        track_code: trackCode,
        car_number: combineCarNumber(vehicle, trackCode),
        name,
        city: get("city"),
        state: get("state"),
        member_number: get("member "),
        license_number: get("nhra et license", "license "),
        phone: get("phone"),
        email: get("email"),
      });
    }
  }

  // ── JDRL / Jr Street: rows 1-10 earn, rows 11+ enter but never score ─────
  const jrHeader = findHeader(jrGrid, ["roster row", "driver name"]);
  if (jrHeader) {
    for (let i = jrHeader.row + 1; i < jrGrid.length; i++) {
      const row = jrGrid[i] || [];
      const get = colGetter(row, jrHeader.cols);
      const name = get("driver name");
      if (!name) continue;
      const slot = parseInt(get("roster row"), 10) || i - jrHeader.row;
      const status = norm(get("points status"));
      // The sheet's own "Points Status" column is authoritative; a roster that
      // left it blank falls back to the rule it encodes — rows 1-10 only.
      const pointsEligible = status ? status.startsWith("team points") : slot <= 10;
      const trackCode = get("track code").toUpperCase();
      if (trackCode && !etTrackCode) etTrackCode = trackCode;
      const vehicle = get("vehicle");
      entries.push({
        division: "jr",
        slot,
        roster_role: get("points status") || (pointsEligible ? "Team Points" : "Non-Points"),
        points_eligible: pointsEligible,
        category: repairAgeGroup(get("class age group", "class")),
        vehicle_number: vehicle,
        track_code: trackCode,
        car_number: combineCarNumber(vehicle, trackCode),
        name,
        city: get("city"),
        state: get("state"),
        member_number: get("member "),
        license_number: get("jr license", "js license", "license "),
        phone: get("phone"),
        email: get("email"),
      });
    }
  }

  const fileLabel = baseName(opts.fileName || "");
  const trackName = labelValue(infoGrid, "nhra member track", "member track", "track");
  const trackCode =
    (opts.trackCode || "").trim().toUpperCase() ||
    labelValue(infoGrid, "track code").toUpperCase() ||
    etTrackCode ||
    fileLabel.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

  const eventName = labelValue(infoGrid, "event");
  const season =
    (opts.season || "").trim() ||
    (eventName.match(/\b(20\d{2})\b/)?.[1] ?? String(new Date().getFullYear()));

  // A roster submitted with the track-code cell blank leaves bare vehicle
  // numbers, which collide with every other team's. Stamp the resolved code
  // onto those rows so the car numbers match what runs down the track.
  for (const entry of entries) {
    if (!entry.track_code && trackCode) {
      entry.track_code = trackCode;
      entry.car_number = combineCarNumber(entry.vehicle_number, trackCode);
    }
  }

  return {
    id: `${season}_${trackCode}`,
    track_code: trackCode,
    track_name: trackName || fileLabel,
    team_name: (opts.teamName || "").trim() || labelValue(infoGrid, "team name") || trackName || fileLabel,
    captain: labelValue(infoGrid, "team captain", "captain"),
    captain_phone: labelValue(infoGrid, "captain phone"),
    captain_email: labelValue(infoGrid, "captain email"),
    event_name: eventName,
    season,
    entries,
    source_file: opts.fileName || "",
    uploaded_at: new Date().toISOString(),
  };
}
