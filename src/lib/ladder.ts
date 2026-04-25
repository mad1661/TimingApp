// Ladder generation for printable race brackets.
//
// Currently supports: 17-car NHRA Four-Wide Professional ladder.
// Designed so additional field sizes (14, 15, 16, 18+, plus head-to-head
// pair brackets) can be added later by registering new builders.

export type LadderFormat = "quad" | "pair";

export interface Qualifier {
  position: number;
  carNumber?: string | null;
  driver?: string | null;
  classCode?: string | null;
  hometown?: string | null;
  car?: string | null;
  motor?: string | null;
  et?: number | null;
  qMph?: number | null;
  topMph?: number | null;
}

export interface Lane {
  // Qualifier seed (1-based) projected into this lane.
  // Round 1: the actual seeded qualifier (or null for BYE).
  // Later rounds: the *projected* seed (assuming higher seed always advances)
  // — used as ghost label, like the "1 / 8 / 4 / 5" text printed in the
  // round-3 box on the NHRA sheet.
  position: number | null;
  qualifier?: Qualifier | null;
  isBye?: boolean;
}

export interface QuadCell {
  round: number;
  quadIndex: number; // 1-based within round
  lanes: Lane[]; // 4 entries, lanes 1..4
  feederQuads?: number[]; // 1-based feeder indices in (round - 1)
}

export interface Ladder {
  fieldSize: number;
  format: LadderFormat;
  rounds: QuadCell[][];
}

// ─── 17-car NHRA Four-Wide Professional ladder ─────────────────────────────
//
// Round 1 first-round pairings (qualifying seed → first-round quad / lane):
//
//   Q1: [ 1, Bye, 16, Bye  ]    Q5: [ 2, Bye, 15, Bye ]
//   Q2: [ 8, Bye,  9,  17  ]    Q6: [ 7, Bye, 10, Bye ]
//   Q3: [ 4, Bye, 13, Bye  ]    Q7: [ 3, Bye, 14, Bye ]
//   Q4: [ 5, Bye, 12, Bye  ]    Q8: [ 6, Bye, 11, Bye ]
//
// Round 2 quads are fed by pairs of round-1 quads (Q1+Q2, Q3+Q4, etc.),
// round 3 (semi) by pairs of round-2 quads, round 4 (final) by both semis.
// In each transition the top 2 finishers of each feeder advance.

const SEEDING_17: Record<number, { quad: number; lane: number }> = {
  1:  { quad: 1, lane: 1 },
  16: { quad: 1, lane: 3 },
  8:  { quad: 2, lane: 1 },
  9:  { quad: 2, lane: 3 },
  17: { quad: 2, lane: 4 },
  4:  { quad: 3, lane: 1 },
  13: { quad: 3, lane: 3 },
  5:  { quad: 4, lane: 1 },
  12: { quad: 4, lane: 3 },
  2:  { quad: 5, lane: 1 },
  15: { quad: 5, lane: 3 },
  7:  { quad: 6, lane: 1 },
  10: { quad: 6, lane: 3 },
  3:  { quad: 7, lane: 1 },
  14: { quad: 7, lane: 3 },
  6:  { quad: 8, lane: 1 },
  11: { quad: 8, lane: 3 },
};

// Active (non-bye) lanes for each round-1 quad in the 17-car ladder.
const ACTIVE_LANES_17: Record<number, number[]> = {
  1: [1, 3],
  2: [1, 3, 4],
  3: [1, 3],
  4: [1, 3],
  5: [1, 3],
  6: [1, 3],
  7: [1, 3],
  8: [1, 3],
};

export function buildLadder(qualifiers: Qualifier[]): Ladder {
  const sorted = [...qualifiers].sort((a, b) => a.position - b.position);
  const fieldSize = sorted.length;
  if (fieldSize === 17) return build17QuadLadder(sorted);
  throw new Error(
    `Field size ${fieldSize} not yet supported (only 17-car quad ladder is implemented)`
  );
}

function build17QuadLadder(qs: Qualifier[]): Ladder {
  const r1: QuadCell[] = Array.from({ length: 8 }, (_, i) => ({
    round: 1,
    quadIndex: i + 1,
    lanes: [
      { position: null, isBye: true },
      { position: null, isBye: true },
      { position: null, isBye: true },
      { position: null, isBye: true },
    ],
  }));

  for (let q = 1; q <= 8; q++) {
    for (const ln of ACTIVE_LANES_17[q]) {
      r1[q - 1].lanes[ln - 1] = { position: null, isBye: false };
    }
  }

  for (const q of qs) {
    const seed = SEEDING_17[q.position];
    if (!seed) continue;
    r1[seed.quad - 1].lanes[seed.lane - 1] = {
      position: q.position,
      qualifier: q,
      isBye: false,
    };
  }

  const r2 = buildNextRound(r1, 2);
  const r3 = buildNextRound(r2, 3);
  const r4 = buildNextRound(r3, 4);

  return { fieldSize: 17, format: "quad", rounds: [r1, r2, r3, r4] };
}

// Each next-round quad pulls the top-2 projected seeds from two consecutive
// feeder quads — this is the "lines on the bracket" rule.
function buildNextRound(prev: QuadCell[], roundNum: number): QuadCell[] {
  const out: QuadCell[] = [];
  for (let i = 0; i < prev.length; i += 2) {
    const a = prev[i];
    const b = prev[i + 1];
    const lanes = padTo4([...projectTop2(a), ...projectTop2(b)]);
    out.push({
      round: roundNum,
      quadIndex: out.length + 1,
      lanes,
      feederQuads: [i + 1, i + 2],
    });
  }
  return out;
}

function projectTop2(quad: QuadCell): Lane[] {
  const seeds = quad.lanes
    .filter((l) => !l.isBye && l.position != null)
    .map((l) => l.position as number)
    .sort((a, b) => a - b);
  return seeds.slice(0, 2).map((p) => ({ position: p }));
}

function padTo4(lanes: Lane[]): Lane[] {
  const out = [...lanes];
  while (out.length < 4) out.push({ position: null });
  return out;
}

// Field sizes that the builder currently supports.
export const SUPPORTED_FIELD_SIZES: number[] = [17];
