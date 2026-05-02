import { NextRequest } from "next/server";
import { getDashboardStats, getCategoryStats, getDetailedCategoryStats, getRacerRuns, getRacerRunsAllEvents, getCarNumberRuns, getCarNumberRunsAllEvents, searchRacers, searchRacersAllEvents, getEliminationRuns, detectNoShows, getAllNoShows, getDidNotRace, getMissingFromEliminations, getOpponentsForRuns, getScheduleData, getLatestPair, getNextPair, getBestLosingPackage, getEventWinners, getPerfectReactionTimes, getDeadOnRuns, bulkLookupMembership, getQualifyingConfig, saveQualifyingConfig, getQualifyingResults, getClassIndexTable, saveClassIndexTable, getEventRuns, getLadderHeader, saveLadderHeader, getLadderState, saveLadderState, getLadderRoundResults } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

// Wrap response construction so every stats reply carries no-store headers.
// Without this, browsers (and any intermediary CDN) can serve cached snapshots
// of /api/stats and the Dashboard appears frozen even though the live feed is
// pulling new runs.
function jsonResponse(data: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...NO_STORE_HEADERS },
  });
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const type = params.get("type") || "dashboard";
    const eventCode = params.get("event_code") || "";
    const season = params.get("season") || "";

    // car_runs can work across all events (no event_code required)
    if (type === "car_runs") {
      const carNumber = params.get("car_number");
      if (!carNumber) return jsonResponse({ error: "car_number parameter required" }, { status: 400 });
      const runs = eventCode && season
        ? await getCarNumberRuns(carNumber, eventCode, season)
        : await getCarNumberRunsAllEvents(carNumber);
      // Attach opponents for timeslip display
      if (eventCode && season && runs.length > 0) {
        const { opponents: opponentMap, tsGroups: tsGroupMap } = await getOpponentsForRuns(runs, eventCode, season);
        const runsWithOpponents = runs.map((run) => {
          const canonical = run.timestamp ? (tsGroupMap.get(run.timestamp) || run.timestamp) : "";
          const paired = opponentMap.get(canonical) || [];
          const opponents = paired.filter(
            (p) =>
              !(p.car_number === run.car_number && p.name === run.name) &&
              p.category === run.category &&
              p.round === run.round,
          );
          return { ...run, opponents: opponents.map((o) => ({ name: o.name, car_number: o.car_number, rt: o.rt, ft60: o.ft60, ft330: o.ft330, ft660: o.ft660, mph_660: o.mph_660, ft1000: o.ft1000, mph_1000: o.mph_1000, ft1320: o.ft1320, mph_1320: o.mph_1320, mov: o.mov, is_winner: o.is_winner, is_dq: o.is_dq, result: o.result, lane: o.lane, dial_in: o.dial_in })) };
        });
        return jsonResponse({ car_number: carNumber, runs: runsWithOpponents, totalRuns: runs.length });
      }
      return jsonResponse({ car_number: carNumber, runs, totalRuns: runs.length });
    }

    // racers search can work across all events when no event specified
    if (type === "racers") {
      const search = params.get("search") || "";
      if (search.length >= 1) {
        const results = eventCode && season
          ? await searchRacers(search, eventCode, season)
          : await searchRacersAllEvents(search);
        return jsonResponse({ racers: results.map((r) => r.name), racerDetails: results });
      }
      return jsonResponse({ racers: [] });
    }

    // racer-all-events: fetch all runs for a racer across all events
    if (type === "racer-all-events") {
      const racerName = params.get("name");
      if (!racerName) return jsonResponse({ error: "name parameter required" }, { status: 400 });
      const excludeEventCode = params.get("exclude_event_code") || undefined;
      const excludeSeason = params.get("exclude_season") || undefined;
      const runs = await getRacerRunsAllEvents(racerName, excludeEventCode, excludeSeason);
      return jsonResponse({ name: racerName, runs, totalRuns: runs.length });
    }

    if (type === "debug-timestamps") {
      if (!eventCode || !season) return jsonResponse({ error: "need event_code and season" }, { status: 400 });
      const runs = await getEventRuns(eventCode, season);
      const data = runs
        .filter((r) => r.timestamp)
        .map((r) => ({ ts: r.timestamp, seq: r._scrape_seq ?? null, cat: r.category, round: r.round, name: r.name }))
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      return jsonResponse({ eventCode, season, totalInCache: runs.length, withTimestamp: data.length, runs: data });
    }

    if (!eventCode || !season) {
      return jsonResponse({ error: "event_code and season are required" }, { status: 400 });
    }

    if (type === "dashboard") {
      const stats = await getDashboardStats(eventCode, season);
      return jsonResponse(stats);
    }

    if (type === "categories") {
      const stats = await getCategoryStats(eventCode, season);
      return jsonResponse({ categories: stats });
    }

    if (type === "detailed_categories") {
      const stats = await getDetailedCategoryStats(eventCode, season);
      return jsonResponse({ categories: stats });
    }

    if (type === "racer") {
      const name = params.get("name");
      if (!name) return jsonResponse({ error: "Name parameter required" }, { status: 400 });
      const runs = await getRacerRuns(name, eventCode, season);
      const { opponents: opponentMap, tsGroups: tsGroupMap } = await getOpponentsForRuns(runs, eventCode, season);
      const runsWithOpponents = runs.map((run) => {
        const canonical = run.timestamp ? (tsGroupMap.get(run.timestamp) || run.timestamp) : "";
        const paired = opponentMap.get(canonical) || [];
        const opponents = paired.filter(
          (p) => p.name !== run.name && p.category === run.category && p.round === run.round
        );
        return { ...run, opponents: opponents.map((o) => ({ name: o.name, car_number: o.car_number, rt: o.rt, ft60: o.ft60, ft330: o.ft330, ft660: o.ft660, mph_660: o.mph_660, ft1000: o.ft1000, mph_1000: o.mph_1000, ft1320: o.ft1320, mph_1320: o.mph_1320, mov: o.mov, is_winner: o.is_winner, is_dq: o.is_dq, result: o.result, lane: o.lane, dial_in: o.dial_in })) };
      });
      return jsonResponse({ name, runs: runsWithOpponents, totalRuns: runs.length });
    }

    if (type === "schedule") {
      const pmStart = params.get("pm_start") === "1";
      const schedule = await getScheduleData(eventCode, season, pmStart);
      return jsonResponse({ schedule });
    }

    if (type === "latest") {
      const pair = await getLatestPair(eventCode, season);
      return jsonResponse({ pair });
    }

    if (type === "next-pair") {
      const pair = await getNextPair(eventCode, season);
      return jsonResponse({ pair });
    }



    if (type === "noshows") {
      const result = await getAllNoShows(eventCode, season);
      return jsonResponse({ noShows: result.noShows, activeCategory: result.activeCategory });
    }

    if (type === "didnotrace") {
      const results = await getDidNotRace(eventCode, season);
      return jsonResponse({ didNotRace: results });
    }

    if (type === "missing-elims") {
      const eventName = params.get("event_name") || undefined;
      const results = await getMissingFromEliminations(eventCode, season, eventName);
      return jsonResponse({ missing: results });
    }

    if (type === "best-losing-package") {
      const rounds = params.get("rounds")?.split(",").filter(Boolean) || [];
      const categories = params.get("categories")?.split(",").filter(Boolean) || [];
      if (rounds.length === 0 || categories.length === 0) {
        return jsonResponse({ error: "rounds and categories are required" }, { status: 400 });
      }
      const results = await getBestLosingPackage(eventCode, season, rounds, categories);
      const allNames = Object.values(results).flat().map((e: { name: string }) => e.name);
      const memberMap = await bulkLookupMembership([...new Set(allNames)]);
      const memberLookup: Record<string, string> = {};
      memberMap.forEach((v, k) => { memberLookup[k] = v; });
      return jsonResponse({ results, membership: memberLookup });
    }

    if (type === "event-winners") {
      const categories = params.get("categories")?.split(",").filter(Boolean) || [];
      if (categories.length === 0) {
        return jsonResponse({ error: "categories required" }, { status: 400 });
      }
      const results = await getEventWinners(eventCode, season, categories);
      return jsonResponse({ results });
    }

    if (type === "perfect-rt") {
      const roundTypes = params.get("round_types")?.split(",").filter(Boolean) || [];
      const results = await getPerfectReactionTimes(eventCode, season, roundTypes.length > 0 ? roundTypes : undefined);
      // Lookup membership numbers from tech cards
      const allNames = Object.values(results).flat().map((e: { name: string }) => e.name);
      const memberMap = await bulkLookupMembership([...new Set(allNames)]);
      const memberLookup: Record<string, string> = {};
      memberMap.forEach((v, k) => { memberLookup[k] = v; });
      return jsonResponse({ results, membership: memberLookup });
    }

    if (type === "dead-on") {
      const results = await getDeadOnRuns(eventCode, season);
      // Lookup membership numbers from tech cards
      const allNames = Object.values(results).flat().map((e: { name: string }) => e.name);
      const memberMap = await bulkLookupMembership([...new Set(allNames)]);
      const memberLookup: Record<string, string> = {};
      memberMap.forEach((v, k) => { memberLookup[k] = v; });
      return jsonResponse({ results, membership: memberLookup });
    }

    if (type === "qualifying-config") {
      const config = await getQualifyingConfig(eventCode, season);
      return jsonResponse({ config });
    }

    if (type === "class-indexes") {
      const indexes = await getClassIndexTable(eventCode, season);
      return jsonResponse({ indexes });
    }

    if (type === "class-designations") {
      const category = params.get("category");
      if (!category) return jsonResponse({ error: "category required" }, { status: 400 });
      const runs = await getEventRuns(eventCode, season);
      const designations = new Set<string>();
      for (const r of runs) {
        if (r.category === category && r.class_index) {
          designations.add(r.class_index.trim());
        }
      }
      return jsonResponse({ designations: Array.from(designations).sort() });
    }

    if (type === "qualifying") {
      const category = params.get("category");
      const rounds = params.get("rounds")?.split(",").filter(Boolean) || [];
      const mode = params.get("mode") || "quickest_et";
      const tb = params.get("tiebreaker") === "first_run" ? "first_run" : "mph";
      if (!category || rounds.length === 0) {
        return jsonResponse({ error: "category and rounds are required" }, { status: 400 });
      }
      const results = await getQualifyingResults(eventCode, season, category, rounds, mode, tb as "mph" | "first_run");
      return jsonResponse({ results });
    }


    if (type === "brackets") {
      const category = params.get("category");
      if (!category) {
        return jsonResponse({ error: "category required" }, { status: 400 });
      }
      const runs = await getEliminationRuns(eventCode, season, category);
      const noShows = detectNoShows(runs);
      return jsonResponse({ runs, noShows });
    }

    if (type === "ladder-header") {
      const category = params.get("category") || "";
      const header = await getLadderHeader(eventCode, season, category);
      return jsonResponse({ header });
    }

    if (type === "ladder-state") {
      const category = params.get("category") || "";
      const state = await getLadderState(eventCode, season, category);
      return jsonResponse({ state });
    }

    if (type === "ladder-results") {
      const category = params.get("category") || "";
      const round = params.get("round") || "";
      if (!eventCode || !season || !category || !round) {
        return jsonResponse({ error: "event_code, season, category, round required" }, { status: 400 });
      }
      const results = await getLadderRoundResults(eventCode, season, category, round);
      return jsonResponse({ results });
    }

    return jsonResponse({ error: "Invalid stats type" }, { status: 400 });
  } catch (error) {
    console.error("Stats error:", error);
    return jsonResponse({ error: "Failed to get stats" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, event_code, season } = body;

    if (type === "save-class-indexes") {
      if (!event_code || !season) {
        return jsonResponse({ error: "event_code and season required" }, { status: 400 });
      }
      await saveClassIndexTable(event_code, season, body.indexes || {});
      return jsonResponse({ ok: true });
    }

    if (type === "save-qualifying-config") {
      if (!event_code || !season) {
        return jsonResponse({ error: "event_code and season required" }, { status: 400 });
      }
      await saveQualifyingConfig(event_code, season, {
        classMode: body.classMode || {},
        tiebreaker: body.tiebreaker || "mph",
      });
      return jsonResponse({ ok: true });
    }

    if (type === "save-ladder-header") {
      const { category, header } = body;
      if (!event_code || !season || !category) {
        return jsonResponse({ error: "event_code, season, category required" }, { status: 400 });
      }
      await saveLadderHeader(event_code, season, category, header || {});
      return jsonResponse({ ok: true });
    }

    if (type === "save-ladder-state") {
      const { category, state } = body;
      if (!event_code || !season || !category) {
        return jsonResponse({ error: "event_code, season, category required" }, { status: 400 });
      }
      if (!state || typeof state !== "object") {
        return jsonResponse({ error: "state object required" }, { status: 400 });
      }
      await saveLadderState(event_code, season, category, {
        fieldSize: state.fieldSize || 17,
        qualifiers: Array.isArray(state.qualifiers) ? state.qualifiers : [],
        advancers: state.advancers && typeof state.advancers === "object" ? state.advancers : {},
        seedResults: state.seedResults && typeof state.seedResults === "object" ? state.seedResults : {},
        classCode: typeof state.classCode === "string" ? state.classCode : undefined,
      });
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Invalid type" }, { status: 400 });
  } catch (error) {
    console.error("Stats POST error:", error);
    return jsonResponse({ error: "Failed" }, { status: 500 });
  }
}
