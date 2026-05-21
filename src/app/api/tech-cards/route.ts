import { NextRequest, NextResponse } from "next/server";
import { saveTechCards, getTechCardByCarNumber, getTechCardByName, searchTechCards } from "@/lib/db";
import { parseTechCardWorkbook } from "@/lib/tech-card-parse";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const eventName = formData.get("event_name") as string || "";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const entries = parseTechCardWorkbook(buffer, eventName);

    if (entries.length === 0) {
      return NextResponse.json({ error: "No data found in spreadsheet" }, { status: 400 });
    }

    const result = await saveTechCards(entries);
    return NextResponse.json({
      success: true,
      total: entries.length,
      saved: result.saved,
      skipped: result.skipped,
      preview: entries.slice(0, 5).map((e) => ({
        name: `${e.first_name} ${e.last_name}`,
        car_number: e.car_number,
        category: e.category,
        member_number: e.member_number,
      })),
    });
  } catch (err) {
    console.error("Tech card upload error:", err);
    return NextResponse.json({ error: "Failed to process file" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const carNumber = params.get("car_number");
  const firstName = params.get("first_name");
  const lastName = params.get("last_name");
  const query = params.get("q");

  try {
    if (carNumber) {
      const results = await getTechCardByCarNumber(carNumber);
      return NextResponse.json({ results });
    }
    if (firstName && lastName) {
      const results = await getTechCardByName(firstName, lastName);
      return NextResponse.json({ results });
    }
    if (query) {
      const results = await searchTechCards(query);
      return NextResponse.json({ results });
    }
    return NextResponse.json({ error: "Provide car_number, first_name+last_name, or q parameter" }, { status: 400 });
  } catch (err) {
    console.error("Tech card lookup error:", err);
    return NextResponse.json({ error: "Failed to fetch tech cards" }, { status: 500 });
  }
}
