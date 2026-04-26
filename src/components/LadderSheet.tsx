"use client";

import type { Ladder, QuadCell, Lane } from "@/lib/ladder";

export interface LadderSheetHeader {
  eventTitle?: string;
  venue?: string;
  dateRange?: string;
  classTitle?: string; // e.g. "TOP ALCOHOL DRAGSTER"
  seriesBanner?: string; // e.g. "NHRA LUCAS OIL DRAG RACING SERIES"
  runTime?: string; // e.g. "6:05 PM"
  runDate?: string; // e.g. "24/APR/2026"
  roundNumber?: string; // e.g. "1"
  lowEt?: { value: string; carNumber: string; driver: string };
  topSpeed?: { value: string; carNumber: string; driver: string };
  systemMark?: string; // e.g. "CompuLink StarTrak"
}

interface LadderSheetProps {
  ladder: Ladder;
  header?: LadderSheetHeader;
  champion?: Lane | null;
  runnerUp?: Lane | null;
}

export default function LadderSheet({ ladder, header, champion, runnerUp }: LadderSheetProps) {
  return (
    <div className="ladder-sheet bg-white text-black font-serif">
      <SheetHeader header={header} fieldSize={ladder.fieldSize} />

      <div className="px-2 pt-1 pb-1">
        <BracketGrid
          rounds={ladder.rounds}
          champion={champion ?? null}
          runnerUp={runnerUp ?? null}
        />
      </div>

      <PrintStyles />
    </div>
  );
}

// ─── Header banner ─────────────────────────────────────────────────────────

function SheetHeader({
  header,
  fieldSize,
}: {
  header?: LadderSheetHeader;
  fieldSize: number;
}) {
  const h = header || {};
  return (
    <div className="px-3 pt-1 pb-1">
      {/* Top row: date / field / round on the left, series banner on the right */}
      <div className="flex items-start gap-3">
        <div className="text-[9px] leading-tight whitespace-nowrap">
          {h.runDate && <div>{h.runDate}</div>}
          <div>{fieldSize} car field</div>
          <div>Round # {h.roundNumber || "1"}</div>
        </div>
        <div className="flex-1 text-center">
          {h.seriesBanner && (
            <div className="text-base font-bold tracking-wide">
              {h.seriesBanner}
            </div>
          )}
          {h.eventTitle && (
            <div className="text-[10px] italic leading-tight whitespace-pre-line">
              {h.eventTitle}
            </div>
          )}
          {(h.venue || h.dateRange) && (
            <div className="text-[10px] italic leading-tight">
              {h.venue}
              {h.venue && h.dateRange ? " " : ""}
              {h.dateRange}
            </div>
          )}
        </div>
      </div>

      {/* Class title row with trailing dotted line and system mark */}
      <div className="flex items-baseline gap-2 mt-1">
        {h.classTitle && (
          <div className="text-base font-bold tracking-wide">
            {h.classTitle}
          </div>
        )}
        <div className="flex-1 border-b border-dotted border-black mb-0.5" />
        {h.systemMark && (
          <div className="text-[10px] italic">{h.systemMark}</div>
        )}
      </div>

      {/* Low E.T. / Top Speed callouts (right-aligned) */}
      {(h.lowEt || h.topSpeed) && (
        <div className="flex justify-end mt-1">
          <table className="text-[10px] leading-tight">
            <tbody>
              {h.lowEt && (
                <tr>
                  <td className="pr-3">Low E.T.</td>
                  <td className="pr-3 text-right">{h.lowEt.value}</td>
                  <td className="pr-3"># {h.lowEt.carNumber}</td>
                  <td>{h.lowEt.driver}</td>
                </tr>
              )}
              {h.topSpeed && (
                <tr>
                  <td className="pr-3">Top Speed</td>
                  <td className="pr-3 text-right">{h.topSpeed.value}</td>
                  <td className="pr-3"># {h.topSpeed.carNumber}</td>
                  <td>{h.topSpeed.driver}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Bracket grid layout ───────────────────────────────────────────────────
//
// All boxes (and the connector lines between them) are placed on a grid
// of N rows where N = number of round-1 quads. Each round's box spans
// 2× as many rows as the previous round, so its row-center always lands
// exactly midway between its two feeder boxes — which is what makes the
// connector lines line up.

function BracketGrid({
  rounds,
  champion,
  runnerUp,
}: {
  rounds: QuadCell[][];
  champion: Lane | null;
  runnerUp: Lane | null;
}) {
  const numRounds = rounds.length;
  const N = rounds[0].length; // R1 quad count = total rows in the grid
  // Layout: round col, connector col, round col, ..., final round col.
  const gridCols: string[] = [];
  for (let r = 0; r < numRounds; r++) {
    if (r === 0) gridCols.push("minmax(190px, 1fr)");
    else if (r === numRounds - 1) gridCols.push("minmax(170px, 1fr)");
    else gridCols.push("minmax(150px, 1fr)");
    if (r < numRounds - 1) gridCols.push("24px");
  }

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: gridCols.join(" "),
        gridTemplateRows: `repeat(${N}, minmax(94px, 1fr))`,
      }}
    >
      {rounds.map((round, ri) => {
        const col = 2 * ri + 1;
        const rowsPerQuad = N / round.length;
        const isFinal = ri === numRounds - 1;
        return round.map((quad, i) => {
          const rowStart = i * rowsPerQuad + 1;
          if (isFinal) {
            return (
              <GridCell
                key={`r${ri}-${i}`}
                col={col}
                rowStart={1}
                rowSpan={N}
              >
                <FinalCell
                  quad={quad}
                  champion={champion}
                  runnerUp={runnerUp}
                />
              </GridCell>
            );
          }
          return (
            <GridCell
              key={`r${ri}-${i}`}
              col={col}
              rowStart={rowStart}
              rowSpan={rowsPerQuad}
            >
              <QuadBox
                quad={quad}
                variant={ri === 0 ? "round1" : "advanced"}
              />
            </GridCell>
          );
        });
      })}

      {rounds.slice(0, -1).map((source, ri) => {
        const col = 2 * ri + 2;
        const rowsPerSource = N / source.length;
        const numConnectors = source.length / 2;
        return Array.from({ length: numConnectors }, (_, i) => (
          <GridCell
            key={`c${ri}-${i}`}
            col={col}
            rowStart={i * 2 * rowsPerSource + 1}
            rowSpan={rowsPerSource * 2}
          >
            <ConnectorPair />
          </GridCell>
        ));
      })}
    </div>
  );
}

function GridCell({
  col,
  rowStart,
  rowSpan,
  children,
}: {
  col: number;
  rowStart: number;
  rowSpan: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-center px-1 py-1"
      style={{
        gridColumn: col,
        gridRow: `${rowStart} / span ${rowSpan}`,
      }}
    >
      {children}
    </div>
  );
}

function FinalCell({
  quad,
  champion,
  runnerUp,
}: {
  quad: QuadCell;
  champion: Lane | null;
  runnerUp: Lane | null;
}) {
  // Champion + Runner-Up sit at the top of the column. The Final quad stays
  // vertically centered in the remaining space so it lines up with the
  // semifinal connector lines like the original NHRA sheet.
  return (
    <div className="flex flex-col w-full h-full">
      <div className="flex flex-col gap-2">
        <PodiumBox label="Champion" lane={champion} accent="champion" />
        <PodiumBox label="Runner-Up" lane={runnerUp} accent="runner" />
      </div>
      <div className="flex-1 flex flex-col justify-center min-h-0">
        <div className="text-center text-[10px] italic tracking-widest mb-1">
          — FINAL —
        </div>
        <QuadBox quad={quad} variant="advanced" />
      </div>
    </div>
  );
}

function PodiumBox({
  label,
  lane,
  accent,
}: {
  label: string;
  lane: Lane | null;
  accent: "champion" | "runner";
}) {
  const q = lane?.qualifier;
  const et = lane?.runEt != null ? lane.runEt : q?.et ?? null;
  const mph = lane?.runMph != null ? lane.runMph : q?.qMph ?? null;
  const accentClass =
    accent === "champion"
      ? "border-black bg-yellow-50"
      : "border-black bg-gray-50";
  return (
    <div className={`border-2 ${accentClass}`}>
      <div className="px-2 py-0.5 border-b border-black bg-white text-center text-[10px] font-bold tracking-[0.2em] uppercase">
        {label}
      </div>
      <div className="px-2 py-1.5 min-h-[42px] flex items-center">
        {q ? (
          <div className="text-[10px] leading-[1.15] font-mono w-full">
            <div className="flex gap-1">
              <span className="w-9 text-right font-bold">{q.carNumber ?? ""}</span>
              <span className="flex-1 truncate font-bold">{q.driver ?? ""}</span>
            </div>
            <div className="flex gap-1">
              <span className="w-9 text-right">{q.position}</span>
              <span className="w-12 text-right">
                {et != null ? et.toFixed(3) : ""}
              </span>
              <span className="flex-1">
                {mph != null ? mph.toFixed(2) : ""}
              </span>
            </div>
          </div>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
    </div>
  );
}

// Two rendering variants:
//   round1   — full 4-lane quad box, active lanes show qualifier data,
//              BYE lanes are labeled "BYE / 0".
//   advanced — used for R2/R3/Final. If a lane has a qualifier object
//              (because the user advanced winner / runner-up into it) we
//              show the same qualifier line; if the lane has only a
//              projected seed, we print just the seed; otherwise blank.

type QuadVariant = "round1" | "advanced";

function QuadBox({ quad, variant }: { quad: QuadCell; variant: QuadVariant }) {
  const hasAnyAdvanced = quad.lanes.some((l) => l.qualifier);
  const minHeight = variant === "round1" || hasAnyAdvanced ? 21 : 14;
  return (
    <div className="border border-black bg-white w-full">
      {quad.lanes.map((lane, idx) => (
        <div
          key={idx}
          className={`px-1 py-0.5 ${idx > 0 ? "border-t border-black" : ""}`}
          style={{ minHeight }}
        >
          <LaneRow lane={lane} variant={variant} />
        </div>
      ))}
    </div>
  );
}

function LaneRow({ lane, variant }: { lane: Lane; variant: QuadVariant }) {
  if (variant === "round1" && lane.isBye) {
    return (
      <div className="text-[9px] leading-[1.1] font-mono">
        <div className="flex gap-1">
          <span className="w-3 text-right">&nbsp;</span>
          <span>BYE</span>
        </div>
        <div className="flex gap-1">
          <span className="w-3 text-right">0</span>
        </div>
      </div>
    );
  }

  if (lane.qualifier) {
    const q = lane.qualifier;
    // R2+ lanes prefer what the racer ran in the previous round; R1 lanes
    // fall back to the qualifier's qualifying ET / MPH.
    const et = lane.runEt != null ? lane.runEt : q.et ?? null;
    const mph = lane.runMph != null ? lane.runMph : q.qMph ?? null;
    return (
      <div className="text-[9px] leading-[1.1] font-mono">
        <div className="flex gap-1">
          <span className="w-3 text-right">&nbsp;</span>
          <span className="w-9 text-right font-bold">{q.carNumber ?? ""}</span>
          <span className="flex-1 truncate font-bold">{q.driver ?? ""}</span>
        </div>
        <div className="flex gap-1">
          <span className="w-3 text-right">{q.position}</span>
          <span className="w-10 text-right">
            {et != null ? et.toFixed(3) : ""}
          </span>
          <span className="flex-1">
            {mph != null ? mph.toFixed(2) : ""}
          </span>
        </div>
      </div>
    );
  }

  if (variant === "round1") {
    // Round 1 active lane with no qualifier loaded — show just the seed.
    return (
      <div className="text-[9px] leading-tight font-mono">
        {lane.position != null ? <div>{lane.position}</div> : <div>&nbsp;</div>}
      </div>
    );
  }

  // variant === "advanced": no qualifier yet → leave the cell blank so the
  // user has the printable sheet to fill in by hand if they want, while
  // any lanes that have been advanced still print real data above.
  return <div className="text-[9px] leading-tight">&nbsp;</div>;
}

// ─── Connector pair ────────────────────────────────────────────────────────
//
// Each connector cell spans the vertical extent of its two source feeders.
// In that span, the top feeder is centered at 25% and the bottom at 75%;
// the target (next-round) box is centered at 50%. The path draws the
// classic right-bracket and a horizontal lead-out to the target.

function ConnectorPair() {
  return (
    <div className="relative w-full h-full">
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <path
          d="M 0 25 H 50 V 75 H 0 M 50 50 H 100"
          fill="none"
          stroke="#000"
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

// ─── Print styles ──────────────────────────────────────────────────────────

function PrintStyles() {
  return (
    <style jsx global>{`
      @media print {
        @page {
          size: letter portrait;
          margin: 0.25in;
        }
        body {
          background: white !important;
        }
        body * {
          visibility: hidden;
        }
        .ladder-sheet,
        .ladder-sheet * {
          visibility: visible;
        }
        .ladder-sheet {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          page-break-inside: avoid;
        }
      }
    `}</style>
  );
}
