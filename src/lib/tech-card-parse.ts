import * as XLSX from "xlsx";
import type { TechCardEntry } from "./db";

// Parse a Compulink tech-card workbook (the .xlsx produced by racefiles
// "Create Compulink File", and the same file uploaded manually on /tech-cards)
// into TechCardEntry rows. Column matching is flexible/case-insensitive.
//
// Also handles the divisional E.T. tech-card export (TCET_*.xlsx), which names
// the same fields differently — `carbikenumber`, `nhramember`,
// `drivername_first`/`drivername_last`, `bracket` — and adds the `trackteam`
// column naming the team the racer entered under. Each field below lists every
// spelling seen, so one parser covers both without the caller choosing.
export function parseTechCardWorkbook(buffer: Buffer, eventName: string): TechCardEntry[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet, { defval: "" });

  return rows.map((row) => {
    const get = (keys: string[]): string => {
      for (const k of keys) {
        const val = row[k];
        if (val !== undefined && val !== null && val !== "") return String(val).trim();
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

    // The ET export occasionally carries the racer's whole name in the first
    // name cell with the first name echoed into the last name cell ("Abbey
    // Beecher" / "Abbey"). Taking both verbatim yields "Abbey Beecher Abbey",
    // so drop a last name the first name already contains.
    let firstName = get(["First Name", "FirstName", "First_Name", "first_name", "drivername_first"]);
    let lastName = get(["Last Name", "LastName", "Last_Name", "last_name", "drivername_last"]);
    if (firstName && lastName && firstName.toLowerCase().split(/\s+/).includes(lastName.toLowerCase())) {
      const parts = firstName.split(/\s+/);
      if (parts.length > 1) {
        lastName = parts[parts.length - 1];
        firstName = parts.slice(0, -1).join(" ");
      }
    }

    return {
      car_number: get(["Car Number", "CarNumber", "Car_Number", "car_number", "Car #", "carbikenumber"]),
      first_name: firstName,
      last_name: lastName,
      street: get(["Street", "street", "Address"]),
      city: get(["City", "city"]),
      state: get(["State", "state"]),
      zip: get(["Zip", "zip", "ZIP", "Zip Code"]),
      occupation: get(["Occupation", "occupation"]),
      license_number: get(["License #", "License", "license_number", "License Number"]),
      license_expiry: get(["License Expiry", "License_Expiry", "license_expiry", "LIC_EXP_DATE"]),
      home_division: get(["Home Division", "Home_Division", "home_division", "Division"]),
      owner: get(["Owner", "owner"]),
      crew_chief: get(["Crew Chief", "Crew_Chief", "crew_chief"]),
      category: get(["Category", "category", "Cat", "CatCode"]),
      class_name: get(["Class", "class", "Class Name", "bracket"]),
      engine_make: get(["Engine Make", "Engine_Make", "engine_make", "enginemake"]),
      engine_year: get(["Engine Year", "Engine_Year", "engine_year"]),
      body_type: get(["Body Type", "Body_Type", "body_type", "Body Typ", "vehiclemodel"]),
      body_year: get(["Body Year", "Body_Year", "body_year", "vehicleyear"]),
      cu_cc: get(["CU/CC", "CUCC", "cu_cc", "CU CC", "enginesize"]),
      hp: get(["HP", "hp", "Horsepower", "horsepower"]),
      factored_hp: get(["Factored HP", "Factored_HP", "factored_hp"]),
      member_number: get(["Member #", "Member", "member_number", "Membership", "Member Number", "nhramember"]),
      member_expiry: get(["Member Expiry", "Member_Expiry", "member_expiry", "MBR_EXP_DATE"]),
      payee: get(["Payee", "payee"]),
      bio_lines: bioLines,
      submission_date: get(["SubmissionDate", "Submission Date", "submission_date"]),
      uploaded_at: new Date().toISOString(),
      event_name: eventName,
      phone: get(["Phone", "phone", "Phone Number", "Telephone", "Cell"]),
      email: get(["Email", "email", "Email Address", "E-mail"]),
      // Track code the racer entered under, normalized — the export's casing is
      // inconsistent ("MD", "Md", "md" all appear). The racefiles Compulink
      // layout calls the same thing "Team Code".
      track_team: get(["trackteam", "Track Team", "track_team", "Team Code", "TeamCode", "team_code"]).toUpperCase(),
      team_slot: get(["team1", "Team", "team_slot"]),
    };
  });
}
