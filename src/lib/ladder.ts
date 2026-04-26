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
  // ET / MPH this lane's racer posted in the previous round to advance into
  // here. If set, the printed sheet shows these instead of the qualifier's
  // qualifying ET / MPH (so a R2 box prints what the racer ran in R1).
  runEt?: number | null;
  runMph?: number | null;
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

// ─── 16-car NHRA Four-Wide Professional ladder ─────────────────────────────
//
// Round 1 four-quad seeding (no byes — every quad is full):
//   Q1: [ 1,  8,  9, 16 ]
//   Q2: [ 4,  5, 12, 13 ]
//   Q3: [ 2,  7, 10, 15 ]
//   Q4: [ 3,  6, 11, 14 ]
//
// Round 2 (semis) is fed by Q1+Q2 → SF1 and Q3+Q4 → SF2. Final is fed by both
// semis. Top 2 finishers of each feeder advance.

const SEEDING_16: Record<number, { quad: number; lane: number }> = {
  1:  { quad: 1, lane: 1 },
  8:  { quad: 1, lane: 2 },
  9:  { quad: 1, lane: 3 },
  16: { quad: 1, lane: 4 },
  4:  { quad: 2, lane: 1 },
  5:  { quad: 2, lane: 2 },
  12: { quad: 2, lane: 3 },
  13: { quad: 2, lane: 4 },
  2:  { quad: 3, lane: 1 },
  7:  { quad: 3, lane: 2 },
  10: { quad: 3, lane: 3 },
  15: { quad: 3, lane: 4 },
  3:  { quad: 4, lane: 1 },
  6:  { quad: 4, lane: 2 },
  11: { quad: 4, lane: 3 },
  14: { quad: 4, lane: 4 },
};

export function buildLadder(
  qualifiers: Qualifier[],
  advancers?: AdvancerMap,
  seedResults?: SeedResultMap,
): Ladder {
  const sorted = [...qualifiers].sort((a, b) => a.position - b.position);
  const fieldSize = sorted.length;
  if (fieldSize === 17)
    return build17QuadLadder(sorted, advancers ?? {}, seedResults ?? {});
  if (fieldSize === 16)
    return build16QuadLadder(sorted, advancers ?? {}, seedResults ?? {});
  throw new Error(
    `Field size ${fieldSize} not supported (only 16-car and 17-car quad ladders are implemented)`
  );
}

function build17QuadLadder(
  qs: Qualifier[],
  advancers: AdvancerMap,
  seedResults: SeedResultMap,
): Ladder {
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

  const byPos = new Map<number, Qualifier>(qs.map((q) => [q.position, q]));
  const r2 = buildNextRound(r1, 2, advancers, byPos, seedResults);
  const r3 = buildNextRound(r2, 3, advancers, byPos, seedResults);
  const r4 = buildNextRound(r3, 4, advancers, byPos, seedResults);

  return { fieldSize: 17, format: "quad", rounds: [r1, r2, r3, r4] };
}

function build16QuadLadder(
  qs: Qualifier[],
  advancers: AdvancerMap,
  seedResults: SeedResultMap,
): Ladder {
  // 4 R1 quads, every lane active (no byes).
  const r1: QuadCell[] = Array.from({ length: 4 }, (_, i) => ({
    round: 1,
    quadIndex: i + 1,
    lanes: [
      { position: null, isBye: false },
      { position: null, isBye: false },
      { position: null, isBye: false },
      { position: null, isBye: false },
    ],
  }));

  for (const q of qs) {
    const seed = SEEDING_16[q.position];
    if (!seed) continue;
    r1[seed.quad - 1].lanes[seed.lane - 1] = {
      position: q.position,
      qualifier: q,
      isBye: false,
    };
  }

  const byPos = new Map<number, Qualifier>(qs.map((q) => [q.position, q]));
  const r2 = buildNextRound(r1, 2, advancers, byPos, seedResults); // semis
  const r3 = buildNextRound(r2, 3, advancers, byPos, seedResults); // final

  return { fieldSize: 16, format: "quad", rounds: [r1, r2, r3] };
}

// Each next-round quad pulls 2 advancers from each feeder quad. If the user
// has marked actual winner / runner-up via the advancers map, those fill the
// lanes (with full qualifier data). Otherwise we fall back to "projected
// top-2 by seed" so the printed ladder shows the ghost seeds (e.g. the
// semifinal box's classic "1, 8, 4, 5") until results are entered.
function buildNextRound(
  prev: QuadCell[],
  roundNum: number,
  advancers: AdvancerMap,
  byPos: Map<number, Qualifier>,
  seedResults: SeedResultMap,
): QuadCell[] {
  const out: QuadCell[] = [];
  // Lanes in round N show what the racer ran in round N-1 to advance here.
  const sourceRound = roundNum - 1;
  for (let i = 0; i < prev.length; i += 2) {
    const a = prev[i];
    const b = prev[i + 1];
    const lanes = padTo4([
      ...advancersOrProjected(a, advancers, byPos, seedResults, sourceRound),
      ...advancersOrProjected(b, advancers, byPos, seedResults, sourceRound),
    ]);
    out.push({
      round: roundNum,
      quadIndex: out.length + 1,
      lanes,
      feederQuads: [i + 1, i + 2],
    });
  }
  return out;
}

function advancersOrProjected(
  quad: QuadCell,
  advancers: AdvancerMap,
  byPos: Map<number, Qualifier>,
  seedResults: SeedResultMap,
  sourceRound: number,
): Lane[] {
  const key = advancerKey(quad.round, quad.quadIndex);
  const picked = advancers[key];
  if (picked && picked.length === 2 && picked[0] > 0 && picked[1] > 0) {
    return picked.map((p) => {
      const sr = seedResults[seedResultKey(sourceRound, p)];
      return {
        position: p,
        qualifier: byPos.get(p) ?? null,
        runEt: sr?.et ?? null,
        runMph: sr?.mph ?? null,
      };
    });
  }
  return projectTop2(quad);
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
export const SUPPORTED_FIELD_SIZES: number[] = [16, 17];

// Map of "round-quadIndex" → [winnerPosition, runnerUpPosition]. Positions
// reference the original qualifier seed (1..fieldSize), which carries the
// driver/car/ET data through to later rounds. A `0` slot means "not picked
// yet"; both slots must be non-zero for the next round's quad to populate.
export type AdvancerMap = Record<string, [number, number]>;

export function advancerKey(round: number, quadIndex: number): string {
  return `${round}-${quadIndex}`;
}

// Map of "{round}-{seed}" → ET / MPH that the seed posted in that round.
// e.g. seedResults["1-5"] = { et: 7.123, mph: 178.45 } means seed #5 ran
// 7.123 / 178.45 mph in Round 1, which gets printed on the seed's lane in
// Round 2 (the round it advanced into). Auto-fill populates this from the
// timing data; manual picks leave it empty and the qualifying ET/MPH is
// shown as a fallback.
export type SeedResultMap = Record<string, { et: number | null; mph: number | null }>;

export function seedResultKey(round: number, seed: number): string {
  return `${round}-${seed}`;
}
