import type { RunRow } from "./db";
import {
  buildDataOutExport,
  buildTechIndex,
  classCodeForCategory,
  detectTimingSystem,
  elimRoundsForCategory,
  findTechCard,
  isQuarterMileClass,
  localCardTest,
  fmtRt,
  fmtEt,
  fmtMph,
  bodyString,
  cityState,
  engineString,
  fullName,
  type EdataTechCard,
  type EdataExportFile,
  type QdatExportFile,
  type QualRule,
  type TimingSystem,
} from "./edata-export";
import { selectDataOutRuns } from "./dataout-runs";
import {
  DEFAULT_POINTS_BRACKETS,
  PRO_CLASS_CODES,
  buildPointsFileContent,
  extractDivisionNumber,
  scoreAccuTimeSession,
  type AccuPointsRow,
  type ProEventScale,
  type ScoringSession,
} from "./accutime-points";
import {
  buildRacedataPdf,
  buildQualifyingPdf,
  type PdfCategory,
  type PdfEvent,
  type PdfLogos,
  type PdfRoundRow,
  type PdfSummaryRow,
  type QualPdfCategory,
} from "./racedata-pdf";
import { prettyDate, shortDate } from "./accutime-export";
import { parseTsToDate } from "./timestamp-utils";

/**
 * Data Out: the whole Compulink package from the event's STORED runs — what
 * getresults (or the API, or an EData import) put in Firestore — instead of
 * from AccuTime session files. Same sheets as the AccuTime export, same
 * builders: C#EDAT.TXT + C#QDAT.TXT per class, the StarTrak qualifying PDF
 * and the Final Round Results PDF with each class's round-by-round page.
 *
 * Entry fields (member number, full name, hometown, body, engine) merge from
 * the shared tech-card store exactly as the text files do, so the PDFs and
 * the text agree line for line. Pairs are winner-first on both, as the tower
 * files list them (the Champion row is the first line of the finals pairing).
 */

export interface DataOutPointsFile {
  /** C10A11DP.TXT — the class's C# and the points race code. */
  filename: string;
  category: string;
  classCode: string;
  /** Cars in round 1 — the field the points bracket is picked by. */
  fieldSize: number;
  rows: AccuPointsRow[];
  notes: string[];
  content: string;
}

export interface DataOutArtifacts {
  edat: EdataExportFile[];
  qdat: QdatExportFile[];
  /** CxAyyDP points files — built when a points race code is given. */
  points: DataOutPointsFile[];
  finalsPdf: Uint8Array | null;
  qualifyingPdf: Uint8Array | null;
  warnings: string[];
  /** The tower dialect the text files were written in. */
  timing: TimingSystem;
}

export interface DataOutBuildOptions {
  /** Event name off the loaded event — the sheet header when no series line is set. */
  eventName?: string;
  /** Series banner (Lucas Oil / Mission Foods / …) typed on the page. */
  seriesHeader?: string;
  logos?: PdfLogos;
  /** Only these categories (exact names) go into the files and PDFs; class numbers stay event-wide. */
  categories?: string[];
  /** Skip the PDFs (class list / text-only loads). Default on. */
  pdfs?: boolean;
  /** Timing-system brand printed on the sheets. Defaults to Compulink — getresults is Compulink's own data. */
  brand?: string;
  /** Per-class qualifying rule (normalized category → rule), from the event's qualifying setup. */
  qualRules?: Record<string, QualRule>;
  /** The event's start date (getresults' YYYYMMDD) — its date window; defaults to the runs' own. */
  eventStartDate?: string | null;
  /** The tower dialect to write; defaults to the one the stored rows show (detectTimingSystem). */
  timing?: TimingSystem;
  /** C# pinned per class (exact or normalized category name) — the tower's slot for a class it numbers its own way. */
  classNumbers?: Record<string, number>;
  /**
   * The race code in the points filenames ("11" → C10A11DP.TXT, the tower's
   * own event number — LO1-7 2026 is "17" though its getresults code is 18).
   * Points files are built only when it's given.
   */
  pointsRaceCode?: string;
  /** Pro points scale (Indy / Pomona 2 pay more). Defaults to the regular season. */
  proScale?: ProEventScale;
  /** Racers who won their last round of an unfinished race get the next round's loss points. */
  incompleteRace?: boolean;
}

/** getresults suffixes the event name with its date ("… Nationals 09/18/2026"); the sheets carry the date separately. */
export function stripEventDate(name: string): string {
  return name.replace(/\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/, "").trim();
}

function trimNum(s: string): string {
  return s.trim();
}

function isoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function norm(s: string | null | undefined): string {
  return (s || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function buildDataOutArtifacts(
  storedRuns: RunRow[],
  techCards: EdataTechCard[],
  opts: DataOutBuildOptions = {},
): DataOutArtifacts {
  const selection = selectDataOutRuns(storedRuns, { startDate: opts.eventStartDate });
  const runs = selection.runs;
  const timing = opts.timing || detectTimingSystem(runs);
  const brand = (opts.brand || "").trim() || (timing === "portatree" ? "Portatree" : "Compulink");
  const classNumberPresets = new Map<string, number>();
  for (const [category, n] of Object.entries(opts.classNumbers || {})) {
    if (Number.isInteger(n) && n > 0) classNumberPresets.set(norm(category), n);
  }
  const text = buildDataOutExport(runs, techCards, { qualRules: opts.qualRules, timing, classNumberPresets });
  const warnings = [...selection.warnings, ...text.warnings];

  const wanted = opts.categories && opts.categories.length > 0
    ? new Set(opts.categories.map(norm))
    : null;
  const keep = (category: string) => !wanted || wanted.has(norm(category));

  const edat = text.edat.filter((f) => keep(f.category));
  const qdat = text.qdat.filter((f) => keep(f.category));
  const raceCode = (opts.pointsRaceCode || "").trim().replace(/-/g, "");
  const points = raceCode
    ? buildDataOutPoints(runs, edat, qdat, techCards, {
        raceCode,
        timing,
        proScale: opts.proScale,
        incompleteRace: opts.incompleteRace,
        warnings,
      })
    : [];

  if (opts.pdfs === false) {
    return { edat, qdat, points, finalsPdf: null, qualifyingPdf: null, warnings, timing };
  }

  // Every class with either file, in the same class order the text uses.
  const categories = [...new Set([...edat, ...qdat].map((f) => f.category))].sort((a, b) => {
    const ca = classCodeForCategory(a);
    const cb = classCodeForCategory(b);
    return ca.order - cb.order || a.localeCompare(b);
  });

  const isLocal = localCardTest(runs);
  const qualCats: QualPdfCategory[] = [];
  const finalsCats: PdfCategory[] = [];
  let latestElim: Date | null = null;

  for (const category of categories) {
    const catRuns = runs.filter((r) => (r.category || "").trim() === category);
    const q = qdat.find((f) => f.category === category);
    const e = edat.find((f) => f.category === category);
    const code = (e || q)?.classCode || classCodeForCategory(category).code;
    const idx = buildTechIndex(category, code, techCards, isLocal);
    const cardFor = (car: string | null, name: string | null) => findTechCard(car, name, idx);
    const quarterMile = e ? isQuarterMileClass(catRuns) : true;
    const rounds = e ? elimRoundsForCategory(catRuns, category) : [];

    // The field is round one: everyone below that line on the qualifying
    // sheet didn't make the ladder.
    const fieldSize = rounds.length
      ? rounds[0].pairs.reduce((n, p) => n + p.runs.length, 0)
      : undefined;

    // ----- Qualifying sheet -----
    if (q && q.qualifiers.length) {
      qualCats.push({
        name: category,
        brand,
        lowEt: q.lowEt ? `${q.lowEt.et.toFixed(3)}  ${q.lowEt.car} ${q.lowEt.name}` : "",
        topSpeed: q.topSpeed ? `${q.topSpeed.mph.toFixed(2)}  ${q.topSpeed.car} ${q.topSpeed.name}` : "",
        fieldSize,
        hasIndex: q.hasIndex,
        entries: q.qualifiers.map((entry, qi) => {
          const diff =
            entry.et !== null && entry.index !== null ? (entry.et - entry.index).toFixed(3) : "";
          // A class that qualifies on the tree prints its reaction time where the ET goes.
          const shown = q.style === "rt" ? entry.rt ?? null : entry.et;
          return {
            pos: String(q.positions[qi] ?? qi + 1),
            num: entry.car,
            cls: entry.classOrIndex,
            driver: entry.name,
            hometown: entry.cityState,
            car: entry.body,
            motor: entry.engine,
            et: shown !== null ? shown.toFixed(3) : "",
            index: entry.index !== null ? entry.index.toFixed(2) : "",
            diff,
          };
        }),
      });
    }

    // ----- Finals + round-by-round page -----
    if (rounds.length) {
      const hasDI = rounds.some((r) => r.pairs.some((p) => p.runs.some((run) => (run.dial_in ?? 0) > 0)));
      // QFY: the position on the run row when getresults filled it in, else
      // the racer's line on the qualifying sheet (which is the same ladder
      // when getresults placed them, and the computed order when it didn't).
      const sheetPos = new Map<string, string>();
      q?.qualifiers.forEach((entry, qi) => {
        if (entry.car) sheetPos.set(norm(entry.car), String(q.positions[qi] ?? qi + 1));
      });
      const qfy = (run: RunRow) =>
        run.qual_pos != null && run.qual_pos > 0
          ? String(run.qual_pos)
          : sheetPos.get(norm(run.car_number)) || "";
      const et = (run: RunRow) =>
        trimNum(fmtEt(quarterMile ? run.ft1320 ?? run.ft660 : run.ft660 ?? run.ft1320));
      const mph = (run: RunRow) =>
        trimNum(fmtMph(quarterMile ? run.mph_1320 ?? run.mph_660 : run.mph_660 ?? run.mph_1320));

      for (const rd of rounds) {
        for (const p of rd.pairs) {
          for (const run of p.runs) {
            const d = run.timestamp ? parseTsToDate(run.timestamp) : null;
            if (d && (!latestElim || d > latestElim)) latestElim = d;
          }
        }
      }

      const pdfRounds = rounds.map((rd) => ({
        name: rd.label,
        pairs: rd.pairs.map((p) => ({
          single: p.single,
          rows: p.runs.map((run): PdfRoundRow => {
            const tc = cardFor(run.car_number, run.name);
            return {
              num: run.car_number || "",
              cls: (run.class_index || "").trim() || (tc && tc.category) || "",
              qfy: qfy(run),
              driver: (tc ? fullName(tc) : "") || run.name || "",
              home: tc ? cityState(tc) : "",
              car: tc ? bodyString(tc) : "",
              motor: tc ? engineString(tc) : "",
              reaction: trimNum(fmtRt(run.rt)),
              di: hasDI && run.dial_in ? run.dial_in.toFixed(2) : "",
              et: et(run),
              mph: mph(run),
            };
          }),
        })),
      }));

      const rows: PdfSummaryRow[] = [];
      const finals = rounds.find((r) => r.isFinal) || rounds[rounds.length - 1];
      const fp = finals?.pairs.length === 1 ? finals.pairs[0].runs : null;
      if (fp && fp[0]) {
        const tc = cardFor(fp[0].car_number, fp[0].name);
        rows.push({
          label: finals.isFinal ? "Champion" : `${finals.label} winner`,
          num: fp[0].car_number || "",
          driver: (tc ? fullName(tc) : "") || fp[0].name || "",
          hometown: tc ? cityState(tc) : "",
          car: tc ? bodyString(tc) : "",
          qfy: qfy(fp[0]),
          reaction: trimNum(fmtRt(fp[0].rt)),
          et: et(fp[0]),
          mph: mph(fp[0]),
        });
      }
      if (fp && fp[1]) {
        const tc = cardFor(fp[1].car_number, fp[1].name);
        rows.push({
          label: "R/U",
          num: fp[1].car_number || "",
          driver: (tc ? fullName(tc) : "") || fp[1].name || "",
          hometown: tc ? cityState(tc) : "",
          car: tc ? bodyString(tc) : "",
          qfy: qfy(fp[1]),
          reaction: trimNum(fmtRt(fp[1].rt)),
          et: et(fp[1]),
          mph: mph(fp[1]),
        });
      }
      if (finals && finals.pairs.length !== 1) {
        warnings.push(
          `${category}: ${finals.label} has ${finals.pairs.length} pairings on file — no Champion / R-U line on the finals sheet.`,
        );
      }
      const q1 = q?.qualifiers[0];
      if (q1) {
        rows.push({
          label: "#1 Qualifier",
          num: q1.car,
          driver: q1.name,
          hometown: q1.cityState,
          car: q1.body,
          et: q1.et !== null ? q1.et.toFixed(3) : "",
          mph: q1.mph !== null && q1.mph > 30 ? q1.mph.toFixed(2) : "",
        });
      }
      if (q?.lowEt) {
        const tc = cardFor(q.lowEt.car, q.lowEt.name);
        rows.push({
          label: "Low E.T.",
          num: q.lowEt.car,
          driver: (tc ? fullName(tc) : "") || q.lowEt.name,
          hometown: tc ? cityState(tc) : "",
          car: tc ? bodyString(tc) : "",
          et: q.lowEt.et.toFixed(3),
        });
      }
      if (q?.topSpeed) {
        const tc = cardFor(q.topSpeed.car, q.topSpeed.name);
        rows.push({
          label: "Top Speed",
          num: q.topSpeed.car,
          driver: (tc ? fullName(tc) : "") || q.topSpeed.name,
          hometown: tc ? cityState(tc) : "",
          car: tc ? bodyString(tc) : "",
          mph: q.topSpeed.mph.toFixed(2),
        });
      }

      finalsCats.push({ name: category, brand, hasDI, rows, rounds: pdfRounds });
    }
  }

  // Event dates: the stored start date for the banner, the eliminations day
  // (off the runs' own timestamps) for the round sheets.
  const startDate = (runs.find((r) => r.start_date)?.start_date || "").slice(0, 10);
  const eventName = stripEventDate(
    (opts.eventName || "").trim() || (runs.find((r) => r.event_name)?.event_name || "").trim(),
  );
  const pdfEvent: PdfEvent = {
    series: (opts.seriesHeader || "").trim() || undefined,
    track: eventName || undefined,
    dates: startDate ? prettyDate(startDate) : undefined,
    roundDate: latestElim ? shortDate(isoDate(latestElim)) : startDate ? shortDate(startDate) : undefined,
    brand,
    logos: opts.logos,
  };

  return {
    edat,
    qdat,
    points,
    finalsPdf: finalsCats.length ? buildRacedataPdf(pdfEvent, finalsCats) : null,
    qualifyingPdf: qualCats.length ? buildQualifyingPdf(pdfEvent, qualCats) : null,
    warnings,
    timing,
  };
}

/**
 * CxAyyDP points files from the same rounds the EDAT prints: winner,
 * runner-up and round losers by the NHRA bracket for the round-1 field (the
 * alcohol table plus qualifying and attempt points for TAD / TAFC, the pro
 * national structure for the pros — the scoring the AccuTime export uses),
 * then 10 points for every entrant who ran the class but not its
 * eliminations. Rows run highest points first, ties in round-1 order, as the
 * tower lists them. A class whose final isn't on file gets no points file.
 *
 * The division column is the racer's home division off the tech card; the
 * timing data doesn't carry it, so a racer with no card on file prints 0.
 */
function buildDataOutPoints(
  runs: RunRow[],
  edat: EdataExportFile[],
  qdat: QdatExportFile[],
  techCards: EdataTechCard[],
  opts: {
    raceCode: string;
    timing: TimingSystem;
    proScale?: ProEventScale;
    incompleteRace?: boolean;
    warnings: string[];
  },
): DataOutPointsFile[] {
  const isLocal = localCardTest(runs);
  const files: DataOutPointsFile[] = [];
  const noFinal: string[] = [];
  let noDivision = 0;
  for (const f of edat) {
    const catRuns = runs.filter((r) => (r.category || "").trim() === f.category);
    const rounds = elimRoundsForCategory(catRuns, f.category, [], { timing: opts.timing });
    if (!rounds.length) continue;
    if (!rounds[rounds.length - 1].isFinal) {
      noFinal.push(f.category);
      continue;
    }
    const idx = buildTechIndex(f.category, f.classCode, techCards, isLocal);
    const cardFor = (car: string | null, name: string | null) => findTechCard(car, name, idx);
    const q = qdat.find((x) => x.category === f.category);
    const qualifying = (q?.qualifiers || []).map((e, i) => ({
      pos: q!.positions[i] ?? i + 1,
      car_number: e.car,
      name: e.name,
      rt: e.rt ?? null,
      et: e.et,
      mph: e.mph,
      bestSession: null,
    }));
    // The pro and alcohol structures by class name: a junior class's rows can
    // carry the tower slot's code (LO2-4 2026 Advanced JR shows PSM).
    const scoringCode = classCodeForCategory(f.category).code;
    const session: ScoringSession = {
      classCode: scoringCode,
      elimRounds: rounds,
      qualifying,
      qualSessionPasses: qualifyingSessions(catRuns),
    };
    const fieldSize = new Set(rounds[0].pairs.flatMap((p) => p.runs.map((r) => norm(r.car_number)))).size;
    const scored = scoreAccuTimeSession(session, cardFor, {
      proScale: opts.proScale,
      incompleteRace: opts.incompleteRace,
      fieldSize,
    });
    const rows = [...scored.rows];

    // Everyone who ran the class but never its eliminations takes the 10
    // entry points — the sportsman rule; a qualifier the sheet puts inside
    // the round-1 field who then didn't race it takes the round-1 loss points.
    // Alcohol and pro attempts are scored off the qualifying sheet above.
    const alcohol = scoringCode === "TAD" || scoringCode === "TAFC";
    if (!alcohol && !PRO_CLASS_CODES.has(scoringCode)) {
      const scoredCars = new Set(rows.map((r) => norm(r.car_number)));
      const sheetPos = new Map<string, number>();
      if (q && q.style !== "super") q.qualifiers.forEach((e, i) => sheetPos.set(norm(e.car), q.positions[i] ?? i + 1));
      const roundOneLoss = DEFAULT_POINTS_BRACKETS.find((b) => fieldSize >= b.minSize && fieldSize <= b.maxSize)?.rounds[1] ?? 10;
      const entrants = new Map<string, RunRow>();
      for (const r of catRuns) {
        const car = norm(r.car_number);
        if (!car || car === "BYE" || scoredCars.has(car) || entrants.has(car)) continue;
        if (!(r.name || "").trim() && !(r.class_index || "").trim()) continue;
        entrants.set(car, r);
      }
      for (const r of entrants.values()) {
        const tc = cardFor(r.car_number, r.name);
        const pos = sheetPos.get(norm(r.car_number));
        const inField = pos !== undefined && pos <= fieldSize;
        rows.push({
          car_number: (r.car_number || "").trim(),
          member_number: (r.member_number || "").trim() || tc?.member_number || "",
          name: (tc ? fullName(tc) : "") || (r.name || "").trim(),
          division: extractDivisionNumber(tc?.home_division),
          points: inField ? roundOneLoss : 10,
          status: inField ? `Qualified #${pos} — did not race round 1` : "Participated",
          isWinner: false,
          isRunnerUp: false,
        });
      }
      rows.sort((a, b) => b.points - a.points);
    }
    for (const r of rows) {
      if (!r.division) noDivision++;
      // The card's full name, as the EDAT prints it, over the timing system's.
      const tc = cardFor(r.car_number || null, r.name || null);
      if (tc && fullName(tc)) r.name = fullName(tc);
    }

    const classNumber = f.filename.match(/^C(\d+)EDAT\.TXT$/)?.[1] || "";
    files.push({
      filename: `C${classNumber}A${opts.raceCode}DP.TXT`,
      category: f.category,
      classCode: f.classCode,
      fieldSize,
      rows,
      notes: scored.notes,
      content: buildPointsFileContent(f.category, rows, { portatree: opts.timing === "portatree" }),
    });
  }
  if (noFinal.length) {
    opts.warnings.push(`No final on file yet for ${noFinal.join(", ")} — no points file for ${noFinal.length === 1 ? "it" : "them"}.`);
  }
  if (noDivision) {
    opts.warnings.push(
      `${noDivision} points row${noDivision === 1 ? "" : "s"} print division 0 — the timing data has no home division, and no tech card with one matched. Import the event's tech cards to fill it.`,
    );
  }
  return files;
}

/** Each qualifying session's best ET per car, in session order — the pro low-ET bonuses read these. */
function qualifyingSessions(catRuns: RunRow[]): ScoringSession["qualSessionPasses"] {
  const bySession = new Map<string, Map<string, { car_number: string; name: string; et: number | null }>>();
  for (const r of catRuns) {
    const round = norm(r.round);
    if (!/^Q\d+$/.test(round)) continue;
    const car = norm(r.car_number);
    if (!car || car === "BYE") continue;
    const et = r.ft1320 && r.ft1320 > 0 && r.ft1320 < 64.99 ? r.ft1320 : null;
    const passes = bySession.get(round) || new Map();
    const cur = passes.get(car);
    if (!cur || (et !== null && (cur.et === null || et < cur.et))) {
      passes.set(car, { car_number: (r.car_number || "").trim(), name: (r.name || "").trim(), et });
    }
    bySession.set(round, passes);
  }
  return [...bySession.entries()]
    .sort(([a], [b]) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10))
    .map(([round, passes]) => ({ session: parseInt(round.slice(1), 10), passes: [...passes.values()] }));
}
