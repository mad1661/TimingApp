import type { RunRow } from "./db";
import {
  buildDataOutExport,
  buildTechIndex,
  classCodeForCategory,
  elimRoundsForCategory,
  findTechCard,
  isRunWinner,
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
} from "./edata-export";
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
 * the text agree line for line. Pairs on the PDF are winner-first (the
 * Champion row is the first line of the finals pairing); the EDAT text keeps
 * its own left-lane-first order.
 */

export interface DataOutArtifacts {
  edat: EdataExportFile[];
  qdat: QdatExportFile[];
  finalsPdf: Uint8Array | null;
  qualifyingPdf: Uint8Array | null;
  warnings: string[];
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
  runs: RunRow[],
  techCards: EdataTechCard[],
  opts: DataOutBuildOptions = {},
): DataOutArtifacts {
  const brand = (opts.brand || "").trim() || "Compulink";
  const text = buildDataOutExport(runs, techCards);
  const warnings = [...text.warnings];

  const wanted = opts.categories && opts.categories.length > 0
    ? new Set(opts.categories.map(norm))
    : null;
  const keep = (category: string) => !wanted || wanted.has(norm(category));

  const edat = text.edat.filter((f) => keep(f.category));
  const qdat = text.qdat.filter((f) => keep(f.category));

  if (opts.pdfs === false) {
    return { edat, qdat, finalsPdf: null, qualifyingPdf: null, warnings };
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
    const quarterMile = e ? catRuns.some((r) => r.ft1320 !== null || r.mph_1320 !== null) : true;
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
          return {
            pos: String(qi + 1),
            num: entry.car,
            cls: entry.classOrIndex,
            driver: entry.name,
            hometown: entry.cityState,
            car: entry.body,
            motor: entry.engine,
            et: entry.et !== null ? entry.et.toFixed(3) : "",
            index: entry.index !== null ? entry.index.toFixed(2) : "",
            diff,
          };
        }),
      });
    }

    // ----- Finals + round-by-round page -----
    if (rounds.length) {
      const hasDI = rounds.some((r) => r.pairs.some((p) => p.runs.some((run) => (run.dial_in ?? 0) > 0)));
      const winnerFirst = (pairRuns: RunRow[]) =>
        [...pairRuns].sort((a, b) => (isRunWinner(b) ? 1 : 0) - (isRunWinner(a) ? 1 : 0));
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
          rows: winnerFirst(p.runs).map((run): PdfRoundRow => {
            const tc = cardFor(run.car_number, run.name);
            return {
              num: run.car_number || "",
              cls: (run.class_index || "").trim() || (tc && tc.category) || "",
              qfy: run.qual_pos != null && run.qual_pos > 0 ? String(run.qual_pos) : "",
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
      const finals = rounds.find((r) => r.round === "F") || rounds[rounds.length - 1];
      const fp = finals?.pairs.length === 1 ? winnerFirst(finals.pairs[0].runs) : null;
      if (fp && fp[0]) {
        const tc = cardFor(fp[0].car_number, fp[0].name);
        rows.push({
          label: finals.round === "F" ? "Champion" : `${finals.label} winner`,
          num: fp[0].car_number || "",
          driver: (tc ? fullName(tc) : "") || fp[0].name || "",
          hometown: tc ? cityState(tc) : "",
          car: tc ? bodyString(tc) : "",
          qfy: fp[0].qual_pos != null && fp[0].qual_pos > 0 ? String(fp[0].qual_pos) : "",
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
          qfy: fp[1].qual_pos != null && fp[1].qual_pos > 0 ? String(fp[1].qual_pos) : "",
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
  const eventName = (opts.eventName || "").trim() || (runs.find((r) => r.event_name)?.event_name || "").trim();
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
    finalsPdf: finalsCats.length ? buildRacedataPdf(pdfEvent, finalsCats) : null,
    qualifyingPdf: qualCats.length ? buildQualifyingPdf(pdfEvent, qualCats) : null,
    warnings,
  };
}
