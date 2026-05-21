import { NextRequest, NextResponse } from "next/server";
import { saveTechCards, getTechCardByCarNumber, getTechCardByName, searchTechCards, type TechCardEntry } from "@/lib/db";
import * as XLSX from "xlsx";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const eventName = formData.get("event_name") as string || "";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet, { defval: "" });

    if (rows.length === 0) {
      return NextResponse.json({ error: "No data found in spreadsheet" }, { status: 400 });
    }

    // Map column headers (flexible matching)
    const entries: TechCardEntry[] = rows.map((row) => {
      const get = (keys: string[]): string => {
        for (const k of keys) {
          const val = row[k];
          if (val !== undefined && val !== null && val !== "") return String(val).trim();
          // Case-insensitive match
          const found = Object.keys(row).find((rk) => rk.toLowerCase().trim() === k.toLowerCase().trim());
          if (found && row[found] !== undefined && row[found] !== null && row[found] !== "") return String(row[found]).trim();
        }
        return "";
      };

      const bioLines: string[] = [];
      for (let i = 1; i <= 6; i++) {
        const line = get([`line${i}`, `Line${i}`, `LINE${i}`]);
        if (line) bioLines.push(line);
      }

      return {
        car_number: get(["Car Number", "CarNumber", "Car_Number", "car_number", "Car #"]),
        first_name: get(["First Name", "FirstName", "First_Name", "first_name"]),
        last_name: get(["Last Name", "LastName", "Last_Name", "last_name"]),
        street: get(["Street", "street", "Address"]),
        city: get(["City", "city"]),
        state: get(["State", "state"]),
        zip: get(["Zip", "zip", "ZIP", "Zip Code"]),
        occupation: get(["Occupation", "occupation"]),
        license_number: get(["License #", "License", "license_number", "License Number"]),
        license_expiry: get(["License Expiry", "License_Expiry", "license_expiry"]),
        home_division: get(["Home Division", "Home_Division", "home_division", "Division"]),
        owner: get(["Owner", "owner"]),
        crew_chief: get(["Crew Chief", "Crew_Chief", "crew_chief"]),
        category: get(["Category", "category", "Cat"]),
        class_name: get(["Class", "class", "Class Name"]),
        engine_make: get(["Engine Make", "Engine_Make", "engine_make"]),
        engine_year: get(["Engine Year", "Engine_Year", "engine_year"]),
        body_type: get(["Body Type", "Body_Type", "body_type", "Body Typ"]),
        body_year: get(["Body Year", "Body_Year", "body_year"]),
        cu_cc: get(["CU/CC", "CUCC", "cu_cc", "CU CC"]),
        hp: get(["HP", "hp", "Horsepower"]),
        factored_hp: get(["Factored HP", "Factored_HP", "factored_hp"]),
        member_number: get(["Member #", "Member", "member_number", "Membership", "Member Number"]),
        member_expiry: get(["Member Expiry", "Member_Expiry", "member_expiry"]),
        payee: get(["Payee", "payee"]),
        bio_lines: bioLines,
        submission_date: get(["SubmissionDate", "Submission Date", "submission_date"]),
        uploaded_at: new Date().toISOString(),
        event_name: eventName,
        phone: get(["Phone", "phone", "Phone Number", "Telephone", "Cell"]),
        email: get(["Email", "email", "Email Address", "E-mail"]),
      };
    });

    const result = await saveTechCards(entries);
    return NextResponse.json({
      success: true,
      total: rows.length,
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
