/**
 * Offline replay of POST /api/dataout-export over the read-only snapshot
 * fetch_live.py saved ($DATAOUT_PARITY_DIR/live, default <repo>/.dataout-parity).
 *
 *   npx tsx scripts/dataout-parity/replay.ts <src dir> <out dir> [event ...]
 *
 * <src dir> is a src/ tree — this checkout's, or an older version's (git
 * archive <rev> src | tar x -C <dir>) for the before numbers. The output is
 * what the route returns, one JSON per event, for runall.py / points_cmp.py.
 */
import fs from "fs";
import path from "path";

const EVENTS = ["11", "12", "13", "14", "15", "16", "18", "24", "41", "42", "72", "73", "74", "BM1", "II1"];
// The tower's own race code in each pack's points filenames (what a user types on the page).
const RACE_CODE: Record<string, string> = {
  "11": "11", "12": "12", "13": "13", "14": "14", "15": "15", "16": "16", "18": "17", "24": "24",
  "41": "41", "42": "0", "72": "72", "73": "73", "74": "74", BM1: "13", II1: "14",
};

async function main() {
  const [srcRoot, outDir, ...only] = process.argv.slice(2);
  const events = only.length ? only : EVENTS;
  const root = process.env.DATAOUT_PARITY_DIR || path.resolve(__dirname, "../../.dataout-parity");
  const liveDir = path.join(root, "live");
  const techCards = JSON.parse(fs.readFileSync(path.join(liveDir, "techcards.json"), "utf8"));
  const eventsList = JSON.parse(fs.readFileSync(path.join(liveDir, "events.json"), "utf8")).filters.events as {
    event_code: string;
    season: string;
    start_date: string;
    event_name: string;
  }[];
  const dataout = await import(path.resolve(srcRoot, "lib/dataout-export.ts"));
  const edata = await import(path.resolve(srcRoot, "lib/edata-export.ts"));
  fs.mkdirSync(outDir, { recursive: true });
  for (const ev of events) {
    const snap = JSON.parse(fs.readFileSync(path.join(liveDir, `${ev}.json`), "utf8"));
    const qualRules: Record<string, string> = {};
    for (const [category, mode] of Object.entries((snap.qualifying_config?.classMode || {}) as Record<string, string>)) {
      const rule = edata.qualRuleFromMode(mode);
      if (rule) qualRules[category.trim().toUpperCase().replace(/\s+/g, " ")] = rule;
    }
    const event = eventsList.find((e) => e.event_code === ev && e.season === snap.season);
    // The route hands the builder whatever it accepts; older builders ignore unknown options.
    const opts = {
      pdfs: false,
      qualRules,
      eventStartDate: event?.start_date,
      eventCode: ev,
      season: snap.season,
      pointsRaceCode: RACE_CODE[ev],
      proScale: ev === "II1" ? "indy" : "regular",
    };
    const builder = dataout.buildDataOutForEvent || dataout.buildDataOutArtifacts;
    const art = builder(snap.runs, techCards, opts);
    const out = {
      edat: art.edat.map((f: { filename: string; content: string; category: string }) => ({
        filename: f.filename,
        category: f.category,
        content: f.content,
      })),
      qdat: art.qdat.map((f: { filename: string; content: string; category: string }) => ({
        filename: f.filename,
        category: f.category,
        content: f.content,
      })),
      points: (art.points || []).map((f: { filename: string; content: string; category: string }) => ({
        filename: f.filename,
        category: f.category,
        content: f.content,
      })),
      idx: art.idx ? { filename: art.idx.filename, content: art.idx.content } : null,
      warnings: art.warnings,
    };
    fs.writeFileSync(path.join(outDir, `${ev}.json`), JSON.stringify(out, null, 1));
    console.log(ev, "edat", out.edat.length, "qdat", out.qdat.length, "points", out.points.length, "warnings", out.warnings.length);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
