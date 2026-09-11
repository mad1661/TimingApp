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

// Column aliases. The 2026 combined template is only one of the layouts these
// rosters arrive in — 2025 filed the E.T. team as its own workbook with the
// juniors kept separately — so columns are found by meaning rather than by the
// exact wording one template happened to use.
const NAME_COLS = ["driver name", "driver", "racer name", "racer", "name"];
const FIRST_NAME_COLS = ["first name", "firstname", "first"];
const LAST_NAME_COLS = ["last name", "lastname", "last"];
const VEHICLE_COLS = ["vehicle number", "vehicle", "car number", "car", "veh", "number"];
const MEMBER_COLS = ["member number", "member", "membership", "nhra member"];
const CATEGORY_COLS = ["class age group", "age group", "category", "class", "bracket", "eliminator"];
const SLOT_COLS = ["slot", "roster row", "row", "position", "pos"];
const STATUS_COLS = ["points status", "roster role", "status", "role"];
const TRACK_COLS = ["track code", "track", "code"];
// Columns that only ever appear on a junior roster.
const JR_SIGNAL_COLS = ["dob", "date of birth", "age group", "jr license", "js license", "parent", "guardian", "age"];
// Sheets that are prose, not data.
const NON_ROSTER_SHEET_RE = /instruction|note|readme|help|compliance|summary|cover|rules|about/i;
// Distinct column meanings; a header row must hit several to count as a table.
const ROSTER_COL_GROUPS: string[][] = [
  NAME_COLS,
  FIRST_NAME_COLS,
  LAST_NAME_COLS,
  VEHICLE_COLS,
  MEMBER_COLS,
  CATEGORY_COLS,
  SLOT_COLS,
  STATUS_COLS,
  TRACK_COLS,
  ["city"],
  ["state"],
  ["phone"],
  ["email"],
  ["license"],
];

function headerHas(cols: Map<string, number>, names: string[]): boolean {
  return names.some((n) => {
    const t = norm(n);
    for (const header of cols.keys()) if (header === t || header.includes(t)) return true;
    return false;
  });
}

interface SheetPlan {
  sheetName: string;
  grid: Grid;
  headerRow: number;
  cols: Map<string, number>;
  division: EtDivision;
}

/**
 * Find every sheet in the workbook that looks like a roster, and decide whether
 * each holds big cars or juniors. A sheet qualifies when it has a name column
 * plus at least one of a vehicle number, a member number or a class — enough to
 * be a roster and not, say, the instructions tab. Juniors are recognised from
 * the sheet's own name or from columns that only a junior roster carries (date
 * of birth, age group, a JR/JS licence, a parent or guardian).
 */
function findRosterSheets(workbook: XLSX.WorkBook): SheetPlan[] {
  const plans: SheetPlan[] = [];
  for (const sheetName of workbook.SheetNames) {
    // Prose sheets carry roster-sounding words in their rules text; reading one
    // as data turns instructions into racers.
    if (NON_ROSTER_SHEET_RE.test(sheetName)) continue;
    const grid = readGrid(workbook, sheetName);
    if (grid.length === 0) continue;

    let found: { row: number; cols: Map<string, number> } | null = null;
    for (let i = 0; i < Math.min(grid.length, 60); i++) {
      const row = grid[i] || [];
      const normed = row.map(norm);
      const cols = new Map<string, number>();
      normed.forEach((c, idx) => {
        if (c && !cols.has(c)) cols.set(c, idx);
      });
      const hasName =
        headerHas(cols, NAME_COLS) ||
        (headerHas(cols, FIRST_NAME_COLS) && headerHas(cols, LAST_NAME_COLS));
      if (!hasName) continue;
      if (
        !headerHas(cols, VEHICLE_COLS) &&
        !headerHas(cols, MEMBER_COLS) &&
        !headerHas(cols, CATEGORY_COLS)
      ) {
        continue;
      }
      // A real header row names many columns at once. A label/value sheet can
      // stumble into one or two roster words in a sentence, so require enough
      // of them together to be a table rather than prose.
      const matched = ROSTER_COL_GROUPS.filter((g) => headerHas(cols, g)).length;
      if (matched < 4) continue;
      found = { row: i, cols };
      break;
    }
    if (!found) continue;

    const nameSaysJr = /\b(jdrl|jr|junior)\b/i.test(sheetName.replace(/[^a-z0-9]+/gi, " "));
    const colsSayJr = headerHas(found.cols, JR_SIGNAL_COLS);
    plans.push({
      sheetName,
      grid,
      headerRow: found.row,
      cols: found.cols,
      division: nameSaysJr || colsSayJr ? "jr" : "big",
    });
  }
  return plans;
}

// A junior class is written as an age bracket, "Jr. Dragster", "Jr Street" or
// "Junior ..." — how a junior row is recognised on a sheet that mixes both.
const JR_CATEGORY_RE = /^(\d{1,2}\s*-\s*\d{1,2}|jr\b\.?|junior)/i;

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

// ── Divisional flat roster (one sheet, every team) ──────────────────────────
//
// Division 4 files its ET Finals rosters the other way round: instead of one
// workbook per track, the division keeps ONE sheet ("Main Event") listing every
// racer in the division, with a TEAM CODE column saying which team each entry
// belongs to. A track can field several teams (Ardmore is A1 and A2, Concho C1
// and C2), and the same racer is routinely on two of them in two different
// classes — Pro ET on A1, Super Pro on A2 — so the team code, not the track, is
// the team identity and the class rides along on each entry.
//
// The workbook also carries a printable per-track tab (with a copy of the same
// rows), an Index tab, a Race of Champions tab and a Jr Street / High School /
// Managers tab. None of those are team rosters: reading them as well would
// triple-count every racer, which is exactly what the per-workbook path did
// when this layout first arrived.

const TEAM_CODE_COLS = ["team code", "team"];

/**
 * Column lookup by meaning with an exclusion, for headers where the loose
 * substring match misfires: "car" lands on "Tech Card", "member" on the
 * membership expiration date.
 */
function findCol(cols: Map<string, number>, needles: string[], exclude?: RegExp): number | undefined {
  for (const needle of needles) {
    const target = norm(needle);
    for (const [header, idx] of cols) {
      if (exclude && exclude.test(header)) continue;
      if (header === target || header.includes(target)) return idx;
    }
  }
  return undefined;
}

/** "Logan (2)" / "Dillon(2)" / "Mclearen (2)" — Excel's mark on a racer's second entry, not a second person. */
function stripEntryOrdinal(s: string): string {
  return (s || "").replace(/\s*\(\s*\d+\s*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

/** Cells the template's fillers use for "nothing here". */
const PLACEHOLDER_RE = /^(n\/?a|none|open|tbd|no\s+et|pending|-+|\?+)$/i;
function cleanValue(v: string): string {
  const t = (v || "").trim();
  return PLACEHOLDER_RE.test(t) ? "" : t;
}

interface DivisionalPlan extends SheetPlan {
  teamCol: number;
  dataRows: number;
}

/**
 * Find the divisional flat sheet, if the workbook has one: a roster-shaped
 * header that also names a TEAM CODE column, taking the one with the most
 * racers under it. The per-track tabs carry the same header in their "TRACK
 * TEAM LIST" blocks, so several sheets qualify — the division-wide one is the
 * one with hundreds of rows rather than thirty.
 */
function findDivisionalSheet(workbook: XLSX.WorkBook): DivisionalPlan | null {
  let best: DivisionalPlan | null = null;
  for (const plan of findRosterSheets(workbook)) {
    let teamCol: number | undefined;
    for (const [header, idx] of plan.cols) {
      if (TEAM_CODE_COLS.some((t) => header === norm(t) || header.includes(norm(t)))) {
        // "team captain" / "team name" are label columns, not the code.
        if (/captain|name|manager/.test(header)) continue;
        teamCol = idx;
        break;
      }
    }
    if (teamCol === undefined) continue;
    let dataRows = 0;
    for (let i = plan.headerRow + 1; i < plan.grid.length; i++) {
      const row = plan.grid[i] || [];
      if ((row[teamCol] || "").trim() && (row.some((c, j) => j !== teamCol && c.trim()))) dataRows++;
    }
    if (dataRows === 0) continue;
    if (!best || dataRows > best.dataRows) best = { ...plan, teamCol, dataRows };
  }
  return best;
}

/**
 * The printable per-track tab for a track, found by its "TRACK:" label. Only
 * the header block is read from it (manager, captain, event title).
 */
function findTrackInfoSheet(workbook: XLSX.WorkBook, trackName: string, exclude: string): Grid | null {
  const want = norm(trackName);
  if (!want) return null;
  for (const sheetName of workbook.SheetNames) {
    if (sheetName === exclude) continue;
    const grid = readGrid(workbook, sheetName);
    for (const row of grid.slice(0, 15)) {
      for (let c = 0; c < row.length - 1; c++) {
        if (norm(row[c]) !== "track") continue;
        for (let n = c + 1; n < Math.min(row.length, c + 4); n++) {
          if (norm(row[n]) === want) return grid;
        }
      }
    }
  }
  return null;
}

/** "2026 Texas Motorplex ET Finals Rosters" — the title the per-track tabs open with. */
function findEventTitle(workbook: XLSX.WorkBook): string {
  for (const sheetName of workbook.SheetNames) {
    const grid = readGrid(workbook, sheetName);
    for (const row of grid.slice(0, 8)) {
      for (const cell of row) {
        if (/\b20\d{2}\b/.test(cell) && /finals|roster/i.test(cell) && cell.length < 80) return cell.trim();
      }
    }
  }
  return "";
}

function parseDivisionalWorkbook(
  workbook: XLSX.WorkBook,
  plan: DivisionalPlan,
  opts: ParseOptions,
): EtFinalsRoster[] {
  const eventName = findEventTitle(workbook);
  const fileLabel = baseName(opts.fileName || "");
  const season =
    (opts.season || "").trim() ||
    (eventName.match(/\b(20\d{2})\b/)?.[1] ?? fileLabel.match(/\b(20\d{2})\b/)?.[1] ?? String(new Date().getFullYear()));
  const uploadedAt = new Date().toISOString();

  interface TeamAcc {
    code: string;
    entries: EtRosterEntry[];
    trackNames: Map<string, number>;
    /** The track each row named, by entry, for the mis-coded-row warning. */
    rowTrack: Map<EtRosterEntry, string>;
    warnings: string[];
  }
  const teams = new Map<string, TeamAcc>();
  const sheetWarnings: string[] = [];
  let skippedNoTeam = 0;
  let skippedPlaceholder = 0;

  const carCol = findCol(plan.cols, ["competition", ...VEHICLE_COLS], /card|tech|check/);
  const memberCol = findCol(plan.cols, MEMBER_COLS, /expir|date/);
  const trackNameCol = findCol(plan.cols, ["track name", "track"], /code|team/);
  const cell = (row: string[], idx: number | undefined): string =>
    idx === undefined ? "" : (row[idx] || "").trim();

  for (let i = plan.headerRow + 1; i < plan.grid.length; i++) {
    const row = plan.grid[i] || [];
    const get = colGetter(row, plan.cols);

    const rawLast = get(...LAST_NAME_COLS);
    const rawFirst = get(...FIRST_NAME_COLS);
    let name: string;
    if (rawLast || rawFirst) {
      const last = stripEntryOrdinal(cleanValue(rawLast));
      const first = stripEntryOrdinal(cleanValue(rawFirst));
      name = [last, first].filter(Boolean).join(", ");
    } else {
      name = stripEntryOrdinal(cleanValue(get(...NAME_COLS)));
    }
    // A row that is only a track name or a numbered blank is template padding;
    // an "Open"/"N/A" name is a slot nobody filled.
    if (!name) {
      if ((rawLast || rawFirst) && !cleanValue(rawLast) && !cleanValue(rawFirst)) skippedPlaceholder++;
      continue;
    }

    const code = (row[plan.teamCol] || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
    if (!code) {
      skippedNoTeam++;
      continue;
    }

    const rawCategory = get(...CATEGORY_COLS);
    const category = repairAgeGroup(cleanValue(rawCategory));
    const division: EtDivision = JR_CATEGORY_RE.test(category) ? "jr" : "big";
    const trackName = cleanValue(cell(row, trackNameCol));
    const car = cleanValue(cell(row, carCol)).toUpperCase().replace(/\s+/g, "");
    const member = cleanValue(cell(row, memberCol)).replace(/\s+/g, "");

    let team = teams.get(code);
    if (!team) {
      teams.set(code, (team = { code, entries: [], trackNames: new Map(), rowTrack: new Map(), warnings: [] }));
    }
    if (trackName) team.trackNames.set(trackName, (team.trackNames.get(trackName) || 0) + 1);

    const slot = team.entries.length + 1;
    const entry: EtRosterEntry = {
      division,
      slot,
      roster_role: "",
      // Every divisional entry earns; the sheet has no non-points rows.
      points_eligible: true,
      category,
      // Divisional car numbers are the racer's real competition number, not a
      // vehicle number that takes a track suffix.
      vehicle_number: car,
      track_code: code,
      car_number: car,
      name,
      city: get("city"),
      state: get("state"),
      member_number: member,
      license_number: get("nhra et license", "license"),
      phone: get("phone"),
      email: get("email"),
    };
    team.entries.push(entry);
    team.rowTrack.set(entry, trackName);
    if (!car) team.warnings.push(`${name} (${category || "no class"}) has no car number — matches by name only`);
  }

  if (skippedNoTeam) sheetWarnings.push(`${skippedNoTeam} row(s) skipped: no team code`);
  if (skippedPlaceholder) sheetWarnings.push(`${skippedPlaceholder} placeholder row(s) skipped`);

  // How many teams each track fields decides how a team is named: a lone team
  // is just the track; a track with two is "Ardmore Dragway A1" / "... A2".
  const teamsPerTrack = new Map<string, number>();
  const trackOf = new Map<string, string>();
  for (const team of teams.values()) {
    let trackName = "";
    let top = 0;
    for (const [t, n] of team.trackNames) {
      if (n > top) [trackName, top] = [t, n];
    }
    trackOf.set(team.code, trackName);
    if (trackName) teamsPerTrack.set(trackName, (teamsPerTrack.get(trackName) || 0) + 1);
    // A row whose track disagrees with the rest of its team code is most
    // likely a mis-typed code. Flag it; the code still decides.
    for (const [entry, t] of team.rowTrack) {
      if (t && trackName && t !== trackName) {
        team.warnings.push(
          `${entry.name} (${entry.category || "no class"}) is coded ${team.code} but listed under "${t}" — the rest of ${team.code} is "${trackName}"; check the team code`,
        );
      }
    }
  }

  const rosters: EtFinalsRoster[] = [];
  for (const team of Array.from(teams.values()).sort((a, b) => a.code.localeCompare(b.code))) {
    const trackName = trackOf.get(team.code) || "";
    const multi = (teamsPerTrack.get(trackName) || 0) > 1;
    const info = trackName ? findTrackInfoSheet(workbook, trackName, plan.sheetName) : null;
    rosters.push({
      id: `${season}_${team.code}`,
      track_code: team.code,
      track_name: trackName || team.code,
      team_name: trackName ? (multi ? `${trackName} ${team.code}` : trackName) : team.code,
      captain: info ? labelValue(info, "team captain", "captain") : "",
      captain_phone: "",
      captain_email: "",
      event_name: eventName,
      season,
      entries: team.entries,
      source_file: opts.fileName || "",
      uploaded_at: uploadedAt,
      sheets_used: [`${plan.sheetName} (divisional, ${teams.size} teams)`],
      sheets_seen: workbook.SheetNames,
      warnings: [...sheetWarnings, ...team.warnings],
    });
  }
  return rosters;
}

/**
 * Parse an uploaded roster workbook into one roster per team. A per-track
 * template yields one; the divisional flat sheet yields one per team code.
 */
export function parseEtFinalsRosterWorkbooks(buffer: Buffer, opts: ParseOptions = {}): EtFinalsRoster[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const divisional = findDivisionalSheet(workbook);
  if (divisional) return parseDivisionalWorkbook(workbook, divisional, opts);
  return [parseEtFinalsRosterWorkbook(buffer, opts)];
}

export function parseEtFinalsRosterWorkbook(buffer: Buffer, opts: ParseOptions = {}): EtFinalsRoster {
  const workbook = XLSX.read(buffer, { type: "buffer" });

  const infoGrid = readGrid(workbook, findSheet(workbook, "team") || workbook.SheetNames[0]);

  const entries: EtRosterEntry[] = [];
  let etTrackCode = "";

  // Walk every roster-shaped sheet. The 2026 combined template gives one big-car
  // sheet and one junior sheet; earlier years filed the E.T. team on its own,
  // and a sheet can mix both — all three fall out of the same walk.
  const plans = findRosterSheets(workbook);
  const sheetsUsed: string[] = [];

  for (const plan of plans) {
    sheetsUsed.push(`${plan.sheetName} (${plan.division === "jr" ? "juniors" : "big cars"})`);
    // Juniors are numbered by their position on the sheet, not by a slot column
    // that older layouts may not have.
    let jrSeen = 0;

    for (let i = plan.headerRow + 1; i < plan.grid.length; i++) {
      const row = plan.grid[i] || [];
      const get = colGetter(row, plan.cols);

      let name = get(...NAME_COLS);
      if (!name) {
        const first = get(...FIRST_NAME_COLS);
        const last = get(...LAST_NAME_COLS);
        name = [last, first].filter(Boolean).join(", ");
      }
      if (!name) continue;

      const rawCategory = get(...CATEGORY_COLS);
      const category = repairAgeGroup(rawCategory);
      // A junior row on a mixed sheet gives itself away by its class.
      const division: EtDivision =
        plan.division === "jr" || JR_CATEGORY_RE.test(category) ? "jr" : "big";

      const trackCode = get(...TRACK_COLS).toUpperCase();
      if (trackCode && !etTrackCode) etTrackCode = trackCode;
      const vehicle = get(...VEHICLE_COLS);
      const status = norm(get(...STATUS_COLS));
      const slotRaw = parseInt(get(...SLOT_COLS), 10);

      let slot: number;
      let pointsEligible: boolean;
      if (division === "jr") {
        jrSeen++;
        slot = Number.isFinite(slotRaw) && slotRaw > 0 ? slotRaw : jrSeen;
        // The sheet's own points-status column is authoritative where it exists;
        // otherwise the rule it encodes applies — only the first ten score.
        pointsEligible = status
          ? !status.startsWith("non") && !status.includes("non points")
          : slot <= 10;
      } else {
        slot = Number.isFinite(slotRaw) && slotRaw > 0 ? slotRaw : i - plan.headerRow;
        // Every big-car entry earns, floaters included.
        pointsEligible = true;
      }

      entries.push({
        division,
        slot,
        roster_role:
          get(...STATUS_COLS) || (division === "jr" ? (pointsEligible ? "Team Points" : "Non-Points") : ""),
        points_eligible: pointsEligible,
        category,
        vehicle_number: vehicle,
        track_code: trackCode,
        car_number: combineCarNumber(vehicle, trackCode),
        name,
        city: get("city"),
        state: get("state"),
        member_number: get(...MEMBER_COLS),
        license_number: get("nhra et license", "jr license", "js license", "license"),
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
    sheets_used: sheetsUsed,
    sheets_seen: workbook.SheetNames,
  };
}
