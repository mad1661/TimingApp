import { NextRequest, NextResponse } from "next/server";
import { getDashboardStats, getCategoryStats, getRacerRuns, getCarNumberRuns, searchRacers, getEliminationRuns, detectNoShows, getAllNoShows, getDidNotRace, getOpponentsForRuns, getScheduleData, getLatestPair, getBestLosingPackage, getPerfectReactionTimes, getDeadOnRuns } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const type = params.get("type") || "dashboard";
    const eventCode = params.get("event_code") || "";
    const season = params.get("season") || "";

    if (!eventCode || !season) {
      return NextResponse.json({ error: "event_code and season are required" }, { status: 400 });
    }

    if (type === "dashboard") {
      const stats = await getDashboardStats(eventCode, season);
      return NextResponse.json(stats);
    }

    if (type === "categories") {
      const stats = await getCategoryStats(eventCode, season);
      return NextResponse.json({ categories: stats });
    }

    if (type === "racer") {
      const name = params.get("name");
      if (!name) return NextResponse.json({ error: "Name parameter required" }, { status: 400 });
      const runs = await getRacerRuns(name, eventCode, season);
      const opponentMap = await getOpponentsForRuns(runs, eventCode, season);
      const runsWithOpponents = runs.map((run) => {
        const paired = opponentMap.get(run.timestamp || "") || [];
        const opponents = paired.filter((p) => p.name !== run.name);
        return { ...run, opponents: opponents.map((o) => ({ name: o.name, car_number: o.car_number, rt: o.rt, ft60: o.ft60, ft330: o.ft330, ft660: o.ft660, mph_660: o.mph_660, ft1000: o.ft1000, mph_1000: o.mph_1000, ft1320: o.ft1320, mph_1320: o.mph_1320, mov: o.mov, is_winner: o.is_winner, is_dq: o.is_dq, lane: o.lane, dial_in: o.dial_in })) };
      });
      return NextResponse.json({ name, runs: runsWithOpponents, totalRuns: runs.length });
    }

    if (type === "car_runs") {
      const carNumber = params.get("car_number");
      if (!carNumber) return NextResponse.json({ error: "car_number parameter required" }, { status: 400 });
      const runs = await getCarNumberRuns(carNumber, eventCode, season);
      const opponentMap = await getOpponentsForRuns(runs, eventCode, season);
      const runsWithOpponents = runs.map((run) => {
        const paired = opponentMap.get(run.timestamp || "") || [];
        const opponents = paired.filter((p) => p.name !== run.name);
        return { ...run, opponents: opponents.map((o) => ({ name: o.name, car_number: o.car_number, rt: o.rt, ft60: o.ft60, ft330: o.ft330, ft660: o.ft660, mph_660: o.mph_660, ft1000: o.ft1000, mph_1000: o.mph_1000, ft1320: o.ft1320, mph_1320: o.mph_1320, mov: o.mov, is_winner: o.is_winner, is_dq: o.is_dq, lane: o.lane, dial_in: o.dial_in })) };
      });
      return NextResponse.json({ car_number: carNumber, runs: runsWithOpponents, totalRuns: runs.length });
    }

    if (type === "racers") {
      const search = params.get("search") || "";
      if (search.length >= 1) {
        const results = await searchRacers(search, eventCode, season);
        return NextResponse.json({ racers: results.map((r) => r.name), racerDetails: results });
      }
      return NextResponse.json({ racers: [] });
    }

    if (type === "schedule") {
      const pmStart = params.get("pm_start") === "1";
      const schedule = await getScheduleData(eventCode, season, pmStart);
      return NextResponse.json({ schedule });
    }

    if (type === "latest") {
      const pair = await getLatestPair(eventCode, season);
      return NextResponse.json({ pair });
    }

    if (type === "noshows") {
      const result = await getAllNoShows(eventCode, season);
      return NextResponse.json({ noShows: result.noShows, activeCategory: result.activeCategory });
    }

    if (type === "didnotrace") {
      const results = await getDidNotRace(eventCode, season);
      return NextResponse.json({ didNotRace: results });
    }

    if (type === "best-losing-package") {
      const rounds = params.get("rounds")?.split(",").filter(Boolean) || [];
      const categories = params.get("categories")?.split(",").filter(Boolean) || [];
      if (rounds.length === 0 || categories.length === 0) {
        return NextResponse.json({ error: "rounds and categories are required" }, { status: 400 });
      }
      const results = await getBestLosingPackage(eventCode, season, rounds, categories);
      return NextResponse.json({ results });
    }

    if (type === "perfect-rt") {
      const roundTypes = params.get("round_types")?.split(",").filter(Boolean) || [];
      const results = await getPerfectReactionTimes(eventCode, season, roundTypes.length > 0 ? roundTypes : undefined);
      return NextResponse.json({ results });
    }

    if (type === "dead-on") {
      const results = await getDeadOnRuns(eventCode, season);
      return NextResponse.json({ results });
    }

    if (type === "brackets") {
      const category = params.get("category");
      if (!category) {
        return NextResponse.json({ error: "category required" }, { status: 400 });
      }
      const runs = await getEliminationRuns(eventCode, season, category);
      const noShows = detectNoShows(runs);
      return NextResponse.json({ runs, noShows });
    }

    return NextResponse.json({ error: "Invalid stats type" }, { status: 400 });
  } catch (error) {
    console.error("Stats error:", error);
    return NextResponse.json({ error: "Failed to get stats" }, { status: 500 });
  }
}
