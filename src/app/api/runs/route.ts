import { NextRequest, NextResponse } from "next/server";
import { queryRuns, getCategories, getDistinctRounds, getDistinctClasses, getEvents } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const eventCode = params.get("event_code") || "";
    const season = params.get("season") || "";

    if (!eventCode || !season) {
      const events = await getEvents();
      return NextResponse.json({
        runs: [],
        total: 0,
        filters: { categories: [], seasons: [], rounds: [], classes: [], events },
      });
    }

    const [result, categories, rounds, classes, events] = await Promise.all([
      queryRuns({
        category: params.get("category") || undefined,
        name: params.get("name") || undefined,
        car_number: params.get("car_number") || undefined,
        event_code: eventCode,
        season: season,
        round: params.get("round") || undefined,
        class_index: params.get("class_index") || undefined,
        limit: params.get("limit") ? parseInt(params.get("limit")!) : 100,
        offset: params.get("offset") ? parseInt(params.get("offset")!) : 0,
        sort_by: params.get("sort_by") || "timestamp",
        sort_dir: (params.get("sort_dir") as "ASC" | "DESC") || "DESC",
      }),
      getCategories(eventCode, season),
      getDistinctRounds(eventCode, season),
      getDistinctClasses(eventCode, season),
      getEvents(),
    ]);

    return NextResponse.json({
      ...result,
      filters: { categories, seasons: [season], rounds, classes, events },
    });
  } catch (error) {
    console.error("Runs query error:", error);
    return NextResponse.json({ error: "Failed to query runs" }, { status: 500 });
  }
}
