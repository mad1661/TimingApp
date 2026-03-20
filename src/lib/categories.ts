export type RaceFormat = "bracket" | "index" | "heads_up" | "handicap" | "unknown";

const HEADS_UP: RegExp[] = [
  /top\s*fuel/i,
  /funny\s*car/i,
  /pro\s*stock/i,
  /pro\s*mod/i,
  /factory\s*stock/i,
  /mountain\s*motor/i,
  /\bTF\b/,
  /\bFC\b/,
  /\bPS\b/,
  /\bPSM\b/,
  /\bFX\b/,
  /\bTAFC\b/,
  /\bTAD\b/,
  /\bTD\b/,
  /\bAA\/FA\b/,
  /\bAA\/FC\b/,
];

const INDEX_CLASSES: RegExp[] = [
  /super\s*stock/i,
  /stock\s*eliminator/i,
  /\bSS\b/,
  /\bSE\b/,
  /\bS\/S\b/,
  /\bSTK\b/,
];

const HANDICAP: RegExp[] = [
  /super\s*comp/i,
  /super\s*gas/i,
  /super\s*street/i,
  /top\s*dragster/i,
  /top\s*sportsman/i,
  /comp\s*eliminator/i,
  /\bSC\b/,
  /\bSG\b/,
  /\bSST\b/,
  /\bTD\b/,
  /\bTS\b/,
  /\bCOMP\b/i,
];

const BRACKET: RegExp[] = [
  /bracket/i,
  /super\s*pro/i,
  /pro\s*et/i,
  /sportsman\s*et/i,
  /junior\s*dragster/i,
  /jr\.?\s*dragster/i,
  /\bJD\b/,
  /\bSP\b.*et/i,
  /gamblers?/i,
  /trophy/i,
  /street\s*et/i,
  /foot\s*brake/i,
];

export function classifyCategory(category: string): RaceFormat {
  if (!category) return "unknown";

  for (const re of HEADS_UP) {
    if (re.test(category)) return "heads_up";
  }
  for (const re of INDEX_CLASSES) {
    if (re.test(category)) return "index";
  }
  for (const re of HANDICAP) {
    if (re.test(category)) return "handicap";
  }
  for (const re of BRACKET) {
    if (re.test(category)) return "bracket";
  }

  return "unknown";
}

export function formatLabel(format: RaceFormat): string {
  switch (format) {
    case "heads_up": return "Heads-Up";
    case "index": return "Index";
    case "handicap": return "Handicap";
    case "bracket": return "Bracket";
    default: return "Unknown";
  }
}

export function relevantMetrics(format: RaceFormat): string[] {
  switch (format) {
    case "heads_up":
      return ["ET", "Speed", "Reaction Time", "60ft", "330ft", "660ft", "1000ft"];
    case "index":
      return ["ET", "Speed", "Reaction Time", "Dial-In Accuracy", "Index Deviation"];
    case "handicap":
      return ["ET", "Reaction Time", "Dial-In Accuracy", "Breakout Rate", "Margin of Victory"];
    case "bracket":
      return ["Reaction Time", "Dial-In Accuracy", "Breakout Rate", "ET Consistency", "Margin of Victory"];
    default:
      return ["ET", "Speed", "Reaction Time"];
  }
}
