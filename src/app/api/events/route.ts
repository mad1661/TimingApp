import { NextResponse } from "next/server";
import { getEvents, getFetchLog } from "@/lib/db";

export async function GET() {
  try {
    const [events, fetchLog] = await Promise.all([getEvents(), getFetchLog()]);
    return NextResponse.json({ events, fetchLog });
  } catch (error) {
    console.error("Events query error:", error);
    return NextResponse.json({ error: "Failed to query events" }, { status: 500 });
  }
}
