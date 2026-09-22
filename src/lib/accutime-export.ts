import type { RunRow } from "./db";
import type { AccuTimeSession } from "./accutime";
import {
  buildEdataExport,
  buildQdatFile,
  buildTechIndex,
  classCodeForCategory,
  findTechCard,
  fmtRt,
  fmtEt,
  fmtMph,
  bodyString,
  cityState,
  engineString,
  fullName,
  type EdataTechCard,
  type EdataExportFile,
  type QdatEntry,
} from "./edata-export";
import {
  buildRacedataPdf,
  buildQualifyingPdf,
  type PdfCategory,
  type PdfEvent,
  type PdfLogos,
  type PdfRoundRow,
  type QualPdfCategory,
} from "./racedata-pdf";
import {
  PRO_CLASS_CODES,
  buildIdxFile,
  compulinkClassNumber,
  scoreAccuTimeSession,
  type AccuPointsCategory,
  type AccuPointsSkipped,
  type IdxEntry,
  type ProEventScale,
} from "./accutime-points";

/**
 * Turns parsed AccuTime sessions plus the shared tech-card store into the one
 * export package Mark asked for: Compulink *QDAT.TXT (qualifying), *EDAT.TXT
 * (eliminations), a StarTrak qualifying PDF and the Final Round Results PDF —
 * all from AccuTime data, entry fields merged from tech cards.
 */

export interface AccuTimeTextFile {
  filename: string;
  category: string;
  content: string;
}

export interface AccuTimeArtifacts {
  edat: EdataExportFile[];
  qdat: AccuTimeTextFile[];
  finalsPdf: Uint8Array | null;
  qualifyingPdf: Uint8Array | null;
  warnings: string[];
  /** Per-class coverage: how many elim runs matched a tech card. */
  coverage: { category: string; enriched: number; runs: number }[];
  /** NHRA points: sportsman/alcohol brackets plus the pro Mission Foods structure. */
  points: AccuPointsCategory[];
  pointsSkipped: AccuPointsSkipped[];
  /** IDX class table for the RACEDATA.zip (golden-sample layout), null with no sessions. */
  idx: AccuTimeTextFile | null;
}

/** Trim the fixed-width EDAT numeric strings for PDF cells (right-aligned by jsPDF). */
function trimNum(s: string): string {
  return s.trim();
}

function toEdataCard(tc: EdataTechCard): EdataTechCard {
  return tc;
}

export function buildAccuTimeArtifacts(
  sessions: AccuTimeSession[],
  storedTechCards: EdataTechCard[],
  opts: {
    eventName?: string;
    seriesHeader?: string;
    logos?: PdfLogos;
    /** Score points. Defaults on. */
    calcPoints?: boolean;
    /**
     * Award guaranteed next-round loss points to racers whose race never
     * finished (sportsman/alcohol only — NHRA publishes no pro equivalent).
     */
    incompleteRace?: boolean;
    /** Race code in the points filename: "16" → C10A16DP.TXT. */
    pointsRaceCode?: string;
    /** Event scale for pro (Mission Foods) classes. Defaults to regular. */
    proScale?: ProEventScale;
  } = {},
): AccuTimeArtifacts {
  const warnings: string[] = [];

  // Order sessions the same way buildEdataExport orders categories, so
  // C#EDAT and C#QDAT line up for the same class.
  const ordered = [...sessions].sort((a, b) => {
    const ca = classCodeForCategory(a.className);
    const cb = classCodeForCategory(b.className);
    return ca.order - cb.order || a.className.localeCompare(b.className);
  });

  // Merge source: the session's own Drivers.dbf entries (always trusted) plus
  // the shared tech_cards store. Session drivers carry event_name "" so they
  // read as current-event; stored cards get the normal local/foreign ranking.
  const eventNameNorm = (opts.eventName || "").trim().toUpperCase();
  const isLocal = (tc: EdataTechCard) => {
    const tag = (tc.event_name || "").trim().toUpperCase();
    return !tag || !eventNameNorm || tag === eventNameNorm;
  };

  // Compulink class numbers name every class's files (C10QDAT / C10EDAT /
  // C10A16DP are all Super Street, per the golden RACEDATA sample). Classes
  // without a fixed number take the lowest unused one.
  const usedNums = new Set<number>();
  let nextSeq = 1;
  const classNums = ordered.map((s) => {
    let n = compulinkClassNumber(s.className, s.classCode);
    if (n === null || usedNums.has(n)) {
      while (usedNums.has(nextSeq)) nextSeq++;
      n = nextSeq;
    }
    usedNums.add(n);
    return n;
  });
  const numByCategory = new Map(ordered.map((s, i) => [s.className.toUpperCase(), classNums[i]]));

  // ---------- EDAT (all sessions' elim runs together) ----------
  const allRuns: RunRow[] = ordered.flatMap((s) => s.runs as RunRow[]);
  const allDriverCards = ordered.flatMap((s) => s.drivers.map(toEdataCard));
  const mergedCards = [...allDriverCards, ...storedTechCards];
  const edatResult = buildEdataExport(allRuns, mergedCards);
  warnings.push(...edatResult.warnings);
  const edatFiles = edatResult.files.map((f) => {
    const n = numByCategory.get(f.category.toUpperCase());
    return n !== undefined ? { ...f, filename: `C${n}EDAT.TXT` } : f;
  });

  const coverage = edatResult.files.map((f) => ({
    category: f.category,
    enriched: f.enriched,
    runs: f.runs,
  }));

  // ---------- QDAT + PDFs + points, per session ----------
  const qdat: AccuTimeTextFile[] = [];
  const finalsCats: PdfCategory[] = [];
  const qualCats: QualPdfCategory[] = [];
  const points: AccuPointsCategory[] = [];
  const pointsSkipped: AccuPointsSkipped[] = [];
  const idxEntries: IdxEntry[] = [];
  const calcPoints = opts.calcPoints !== false;
  const raceCode = (opts.pointsRaceCode || "").trim().replace(/-/g, "");

  let anyElim = false;

  ordered.forEach((session, i) => {
    const cards = [...session.drivers.map(toEdataCard), ...storedTechCards];
    const idx = buildTechIndex(session.className, session.classCode, cards, isLocal);
    const cardFor = (car: string | null, name: string | null) => findTechCard(car, name, idx);
    const classNum = classNums[i];

    // ----- IDX class-table row: the champ and runner-up once the final ran -----
    {
      const finals = session.elimRounds.find((r) => r.round === "F");
      let winnerMember = "0";
      let winnerName = "";
      let runnerUpName = "";
      if (finals && finals.pairs.length === 1) {
        const [w, l] = finals.pairs[0].runs;
        if (w) {
          const tc = cardFor(w.car_number, w.name);
          winnerName = (tc ? fullName(tc) : "") || w.name || "";
          winnerMember = w.member_number || tc?.member_number || "0";
        }
        if (l) {
          const tc = cardFor(l.car_number, l.name);
          runnerUpName = (tc ? fullName(tc) : "") || l.name || "";
        }
      }
      idxEntries.push({ num: classNum, classCode: session.classCode || "?", winnerMember, winnerName, runnerUpName });
    }

    // ----- Points: sportsman/alcohol brackets, pro Mission Foods structure -----
    if (calcPoints) {
      if (!session.elimRounds.length) {
        pointsSkipped.push({ category: session.className, classCode: session.classCode, reason: "no_elims" });
      } else {
        const isPro = PRO_CLASS_CODES.has(session.classCode);
        const proScale: ProEventScale = opts.proScale || "regular";
        const scored = scoreAccuTimeSession(session, cardFor, {
          incompleteRace: opts.incompleteRace,
          proScale,
        });
        points.push({
          category: session.className,
          classCode: session.classCode,
          // Same C# prefix as the class's EDAT/QDAT files: C10A16DP.TXT.
          filename: `C${classNum}A${raceCode}DP.TXT`,
          alcohol: session.classCode === "TAD" || session.classCode === "TAFC",
          pro: isPro,
          proScale: isPro ? proScale : undefined,
          fieldSize: new Set(
            session.elimRounds.flatMap((r) =>
              r.pairs.flatMap((p) => p.runs.map((run) => (run.car_number || run.name || "?").trim().toUpperCase())),
            ),
          ).size,
          rows: scored.rows,
          notes: scored.notes,
        });
      }
    }

    // ----- QDAT text -----
    const qEntries: QdatEntry[] = session.qualifying.map((q) => {
      const tc = cardFor(q.car_number, q.name);
      return {
        car: q.car_number,
        member: tc?.member_number || "",
        classOrIndex: (tc && tc.category) || session.classCode,
        body: tc ? bodyString(tc) : "",
        bodyYear: bodyYearFull(tc),
        engine: tc ? engineString(tc) : "",
        hp: tc?.hp || "",
        factoredHp: tc?.factored_hp || "",
        name: (tc ? fullName(tc) : "") || q.name,
        cityState: tc ? cityState(tc) : "",
        et: q.et,
        index: null,
        mph: q.mph,
      };
    });
    if (qEntries.length) {
      qdat.push({
        filename: `C${classNum}QDAT.TXT`,
        category: session.className,
        content: buildQdatFile(session.className, qEntries, session.lowEt, session.topSpeed),
      });
    }

    // ----- Qualifying PDF page -----
    if (qEntries.length) {
      qualCats.push({
        name: session.className,
        brand: "AccuTime",
        lowEt: session.lowEt ? `${session.lowEt.et.toFixed(3)}  ${session.lowEt.car} ${session.lowEt.name}` : "",
        topSpeed: session.topSpeed
          ? `${session.topSpeed.mph.toFixed(2)}  ${session.topSpeed.car} ${session.topSpeed.name}`
          : "",
        entries: session.qualifying.map((q, qi) => {
          const tc = cardFor(q.car_number, q.name);
          return {
            pos: String(qi + 1),
            num: q.car_number,
            cls: (tc && tc.category) || session.classCode,
            driver: (tc ? fullName(tc) : "") || q.name,
            hometown: tc ? cityState(tc) : "",
            car: tc ? bodyString(tc) : "",
            motor: tc ? engineString(tc) : "",
            et: q.et !== null ? q.et.toFixed(3) : "",
            index: "",
            diff: "",
          };
        }),
      });
    }

    // ----- Finals + round-by-round PDF category -----
    if (session.elimRounds.length) {
      anyElim = true;
      const hasDI = session.elimRounds.some((r) => r.pairs.some((p) => p.runs.some((run) => (run.dial_in ?? 0) > 0)));

      const rounds = session.elimRounds.map((rd) => ({
        name: rd.label,
        pairs: rd.pairs.map((p) => ({
          single: p.single,
          rows: p.runs.map((run): PdfRoundRow => {
            const tc = cardFor(run.car_number, run.name);
            return {
              num: run.car_number || "",
              cls: (tc && tc.category) || "",
              qfy: run.qual_pos != null ? String(run.qual_pos) : "",
              driver: (tc ? fullName(tc) : "") || run.name || "",
              home: tc ? cityState(tc) : "",
              car: tc ? bodyString(tc) : "",
              motor: tc ? engineString(tc) : "",
              reaction: trimNum(fmtRt(run.rt)),
              di: hasDI && run.dial_in ? run.dial_in.toFixed(2) : "",
              et: trimNum(fmtEt(run.ft1320 ?? run.ft660)),
              mph: trimNum(fmtMph(run.mph_1320 ?? run.mph_660)),
            };
          }),
        })),
      }));

      // Summary rows: Champion/R-U from the finals pairing, then the
      // qualifying honours.
      const rows: PdfCategory["rows"] = [];
      const finals = session.elimRounds.find((r) => r.round === "F") || session.elimRounds[session.elimRounds.length - 1];
      const fp = finals?.pairs[0]?.runs;
      if (fp && fp[0]) {
        const tc = cardFor(fp[0].car_number, fp[0].name);
        rows.push({
          label: "Champion",
          num: fp[0].car_number || "",
          driver: (tc ? fullName(tc) : "") || fp[0].name || "",
          hometown: tc ? cityState(tc) : "",
          car: tc ? bodyString(tc) : "",
          qfy: fp[0].qual_pos != null ? String(fp[0].qual_pos) : "",
          reaction: trimNum(fmtRt(fp[0].rt)),
          et: trimNum(fmtEt(fp[0].ft1320 ?? fp[0].ft660)),
          mph: trimNum(fmtMph(fp[0].mph_1320 ?? fp[0].mph_660)),
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
          qfy: fp[1].qual_pos != null ? String(fp[1].qual_pos) : "",
          reaction: trimNum(fmtRt(fp[1].rt)),
          et: trimNum(fmtEt(fp[1].ft1320 ?? fp[1].ft660)),
          mph: trimNum(fmtMph(fp[1].mph_1320 ?? fp[1].mph_660)),
        });
      }
      const q1 = session.qualifying[0];
      if (q1) {
        const tc = cardFor(q1.car_number, q1.name);
        rows.push({
          label: "#1 Qualifier",
          num: q1.car_number,
          driver: (tc ? fullName(tc) : "") || q1.name,
          hometown: tc ? cityState(tc) : "",
          car: tc ? bodyString(tc) : "",
          et: q1.et !== null ? q1.et.toFixed(3) : "",
          mph: q1.mph !== null && q1.mph > 30 ? q1.mph.toFixed(2) : "",
        });
      }
      if (session.lowEt) {
        const tc = cardFor(session.lowEt.car, session.lowEt.name);
        rows.push({
          label: "Low E.T.",
          num: session.lowEt.car,
          driver: (tc ? fullName(tc) : "") || session.lowEt.name,
          hometown: tc ? cityState(tc) : "",
          car: tc ? bodyString(tc) : "",
          et: session.lowEt.et.toFixed(3),
        });
      }
      if (session.topSpeed) {
        const tc = cardFor(session.topSpeed.car, session.topSpeed.name);
        rows.push({
          label: "Top Speed",
          num: session.topSpeed.car,
          driver: (tc ? fullName(tc) : "") || session.topSpeed.name,
          hometown: tc ? cityState(tc) : "",
          car: tc ? bodyString(tc) : "",
          mph: session.topSpeed.mph.toFixed(2),
        });
      }

      finalsCats.push({ name: session.className, brand: "AccuTime", hasDI, rows, rounds });
    }
  });

  const first = ordered[0];
  // The series banner changes per event (Lucas Oil / Mission Foods / …): the
  // page's header field wins, then the session's own Class.ini title. Never a
  // hardcoded default.
  const pdfEvent: PdfEvent = {
    series: (opts.seriesHeader || "").trim() || first?.seriesName || undefined,
    track: undefined,
    dates: first?.raceDate ? prettyDate(first.raceDate) : undefined,
    roundDate: first?.raceDate ? shortDate(first.raceDate) : undefined,
    brand: "AccuTime",
    logos: opts.logos,
  };

  const finalsPdf = finalsCats.length ? buildRacedataPdf(pdfEvent, finalsCats) : null;
  const qualifyingPdf = qualCats.length ? buildQualifyingPdf(pdfEvent, qualCats) : null;

  if (!anyElim) warnings.push("No elimination rounds were found in the AccuTime data — EDAT and the finals PDF are empty.");

  const idxFile: AccuTimeTextFile | null = idxEntries.length
    ? { filename: "IDX14.TXT", category: "", content: buildIdxFile(idxEntries) }
    : null;

  return {
    edat: edatFiles,
    qdat,
    finalsPdf,
    qualifyingPdf,
    warnings,
    coverage,
    points,
    pointsSkipped,
    idx: idxFile,
  };
}

function bodyYearFull(tc: EdataTechCard | null): string {
  if (!tc) return "";
  const digits = (tc.body_year || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 4) return digits;
  const two = digits.slice(-2);
  return `${parseInt(two, 10) < 50 ? "20" : "19"}${two}`;
}

function prettyDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}, ${m[1]}`;
}

function shortDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const mAbbr = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${m[3]}/${mAbbr[parseInt(m[2], 10) - 1]}/${m[1]}`;
}
