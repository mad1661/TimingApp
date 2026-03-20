export interface RaceClass {
  name: string;
  code: string;
  perPairSec: number;
  isRacing: boolean;
  fieldSize?: number;
}

export const RACE_CLASSES: RaceClass[] = [
  // Professional classes
  { name: "TOP FUEL", code: "TF", perPairSec: 225, isRacing: true, fieldSize: 16 },
  { name: "FUNNY CAR", code: "FC", perPairSec: 225, isRacing: true, fieldSize: 16 },
  { name: "PRO STOCK", code: "PS", perPairSec: 150, isRacing: true, fieldSize: 16 },
  { name: "PRO STOCK MOTORCYCLE", code: "PSM", perPairSec: 135, isRacing: true, fieldSize: 16 },

  // Sportsman racing classes
  { name: "Pro ET", code: "PRO", perPairSec: 55, isRacing: true },
  { name: "Super Pro", code: "SPRO", perPairSec: 65, isRacing: true },
  { name: "Super Comp", code: "SC", perPairSec: 65, isRacing: true, fieldSize: 32 },
  { name: "Super Gas", code: "SG", perPairSec: 55, isRacing: true, fieldSize: 32 },
  { name: "Super Stock", code: "SS", perPairSec: 55, isRacing: true, fieldSize: 32 },
  { name: "Super Street", code: "SST", perPairSec: 55, isRacing: true, fieldSize: 32 },
  { name: "Stock", code: "STK", perPairSec: 55, isRacing: true, fieldSize: 32 },
  { name: "Sportsman", code: "SPTM", perPairSec: 55, isRacing: true },
  { name: "Sportsman Motorcycle", code: "SMC", perPairSec: 55, isRacing: true },
  { name: "Street Legal", code: "SL", perPairSec: 55, isRacing: true },
  { name: "Snowmobile", code: "SM", perPairSec: 55, isRacing: true },
  { name: "Heads Up", code: "HU", perPairSec: 65, isRacing: true },
  { name: "Jr Dragster", code: "JR", perPairSec: 60, isRacing: true },
  { name: "Jr Street", code: "JS", perPairSec: 50, isRacing: true },

  // Semi-pro / alcohol / specialty
  { name: "Top Alcohol Dragster", code: "TAD", perPairSec: 200, isRacing: true, fieldSize: 16 },
  { name: "Top Alcohol Funny Car", code: "TAFC", perPairSec: 200, isRacing: true, fieldSize: 16 },
  { name: "Pro Mod", code: "PM", perPairSec: 150, isRacing: true, fieldSize: 16 },
  { name: "Top Dragster", code: "TD", perPairSec: 105, isRacing: true, fieldSize: 32 },
  { name: "Top Sportsman", code: "TS", perPairSec: 135, isRacing: true, fieldSize: 32 },
  { name: "Competition Eliminator", code: "COMP", perPairSec: 125, isRacing: true, fieldSize: 32 },
  { name: "Factory Stock Showdown", code: "FSS", perPairSec: 80, isRacing: true, fieldSize: 16 },
  { name: "Mountain Motor Pro Stock", code: "MMPS", perPairSec: 150, isRacing: true, fieldSize: 16 },
  { name: "Hemi Challenge", code: "HC", perPairSec: 65, isRacing: true },
  { name: "Top Fuel Motorcycle", code: "TFM", perPairSec: 150, isRacing: true, fieldSize: 16 },
  { name: "Sponsor Race", code: "SR", perPairSec: 75, isRacing: true },
  { name: "Drag & Drive", code: "DND", perPairSec: 70, isRacing: true },

  // Sportsman finals / semi-finals
  { name: "Sportsman Finals", code: "SF", perPairSec: 150, isRacing: true },
  { name: "Sportsman Semi Finals", code: "SSF", perPairSec: 120, isRacing: true },

  // Nostalgia / exhibition
  { name: "Nostalgia Exhibition", code: "NS", perPairSec: 120, isRacing: true },
  { name: "Nostalgia Top Fuel", code: "NTF", perPairSec: 210, isRacing: true },
  { name: "Nostalgia Funny Car", code: "NFC", perPairSec: 210, isRacing: true },
  { name: "Legends Nitro Funny Car", code: "NFC", perPairSec: 210, isRacing: true },
  { name: "Nostalgia Pro Stock", code: "NPS", perPairSec: 150, isRacing: true },
  { name: "Legends Match Race", code: "LMR", perPairSec: 60, isRacing: true },
  { name: "Exhibition", code: "EXH", perPairSec: 150, isRacing: true },
  { name: "Gassers", code: "GS", perPairSec: 90, isRacing: true },
  { name: "Jet Dragster", code: "JET", perPairSec: 480, isRacing: true },
  { name: "Wheelstander", code: "WS", perPairSec: 300, isRacing: true },
  { name: "Cacklefest", code: "CF", perPairSec: 900, isRacing: false },
  { name: "Top the Cops", code: "TTC", perPairSec: 50, isRacing: true },
  { name: "DeeCell Comp Clash", code: "DCC", perPairSec: 125, isRacing: true },

  // Summit series
  { name: "Summit Pro ET", code: "PROET", perPairSec: 55, isRacing: true },
  { name: "Summit Sportsman ET", code: "SPTM", perPairSec: 55, isRacing: true },
  { name: "Summit Super Pro ET", code: "SPRO", perPairSec: 65, isRacing: true },
  { name: "Summit ET Motorcycle", code: "ETM", perPairSec: 55, isRacing: true },
  { name: "Summit JDRL Shootout", code: "JDRL", perPairSec: 60, isRacing: true },
  { name: "Summit Street Legal EV", code: "SLEV", perPairSec: 50, isRacing: true },

  // JEGS classes
  { name: "JEGS Competition Eliminator", code: "COMP", perPairSec: 125, isRacing: true },
  { name: "JEGS Stock", code: "STK", perPairSec: 55, isRacing: true },
  { name: "JEGS Super Comp", code: "SC", perPairSec: 65, isRacing: true },
  { name: "JEGS Super Gas", code: "SG", perPairSec: 55, isRacing: true },
  { name: "JEGS Super Stock", code: "SS", perPairSec: 55, isRacing: true },
  { name: "JEGS Super Street", code: "SST", perPairSec: 55, isRacing: true },
  { name: "JEGS Top Alcohol Dragster", code: "TAD", perPairSec: 200, isRacing: true },
  { name: "JEGS Top Alcohol Funny Car", code: "TAFC", perPairSec: 200, isRacing: true },
  { name: "JEGS Top Dragster", code: "TD", perPairSec: 105, isRacing: true },
  { name: "JEGS Top Sportsman", code: "TS", perPairSec: 135, isRacing: true },

  // Callouts / challenges
  { name: "#2FAST2TASTY TF Challenge", code: "TF", perPairSec: 300, isRacing: true },
  { name: "#2FAST2TASTY FC Challenge", code: "FC", perPairSec: 300, isRacing: true },
  { name: "#2FAST2TASTY PS Challenge", code: "PS", perPairSec: 240, isRacing: true },
  { name: "#2FAST2TASTY PSM Challenge", code: "PSM", perPairSec: 240, isRacing: true },
  { name: "Right Trailers All Star TF Callout", code: "TF", perPairSec: 300, isRacing: true },
  { name: "All Star FC Callout", code: "FC", perPairSec: 300, isRacing: true },
  { name: "GETTRX All Star PS Callout", code: "PS", perPairSec: 240, isRacing: true },
  { name: "GETTRX All Star PSM Callout", code: "PSM", perPairSec: 240, isRacing: true },

  // JEGS Allstar events (non-racing / fixed duration)
  { name: "JEGS Allstar Driver/Team Intro", code: "", perPairSec: 2700, isRacing: false },
  { name: "JEGS Allstar Finals", code: "", perPairSec: 1800, isRacing: false },
  { name: "JEGS Allstar Parade", code: "", perPairSec: 900, isRacing: false },

  // Non-racing / ceremonies / activities
  { name: "Track Prep", code: "TP", perPairSec: 420, isRacing: false },
  { name: "Pre-Race Ceremonies", code: "PRC", perPairSec: 3600, isRacing: false },
  { name: "Driver Intros", code: "DI", perPairSec: 900, isRacing: false },
  { name: "Marketing Activity", code: "MA", perPairSec: 300, isRacing: false },
  { name: "SealMaster Track Walk", code: "TW", perPairSec: 600, isRacing: false },
  { name: "Miscellaneous", code: "MISC", perPairSec: 600, isRacing: false },
  { name: "Parade of Champions", code: "PC", perPairSec: 1500, isRacing: false },
  { name: "Invocation / National Anthem", code: "MKT", perPairSec: 300, isRacing: false },
  { name: "Start Engines", code: "", perPairSec: 1800, isRacing: false },
  { name: "Secure", code: "X", perPairSec: 0, isRacing: false },
];

export function findClass(name: string): RaceClass | undefined {
  return RACE_CLASSES.find((c) => c.name === name);
}

export function searchClasses(query: string): RaceClass[] {
  const q = query.toLowerCase();
  return RACE_CLASSES.filter(
    (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
  );
}
