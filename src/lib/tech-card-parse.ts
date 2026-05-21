import * as XLSX from "xlsx";
import type { TechCardEntry } from "./db";

// Parse a Compulink tech-card workbook (the .xlsx produced by racefiles
// "Create Compulink File", and the same file uploaded manually on /tech-cards)
// into TechCardEntry rows. Column matching is flexible/case-insensitive.
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
}
