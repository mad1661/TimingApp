"use client";

import type { Ladder, QuadCell, Lane } from "@/lib/ladder";

export interface LadderSheetHeader {
  eventTitle?: string; // e.g. "NHRA and MISSION FOODS welcome you to the 16th Annual 4-Wide Nationals"
  venue?: string; // e.g. "zMAX Dragway"
  dateRange?: string; // e.g. "April 23-26, 2026"
  classTitle?: string; // e.g. "FACTORY STOCK SHOWDOWN"
  seriesBanner?: string; // e.g. "FLEXJET NHRA FACTORY STOCK SHOWDOWN"
  runTime?: string; // e.g. "6:05 PM"
  runDate?: string; // e.g. "24/APR/2026"
  lowEt?: { value: string; carNumber: string; driver: string };
  topSpeed?: { value: string; carNumber: string; driver: string };
  systemMark?: string; // e.g. "CompuLink StarTrak"
}

interface LadderSheetProps {
  ladder: Ladder;
  header?: LadderSheetHeader;
}

export default function LadderSheet({ ladder, header }: LadderSheetProps) {
  const [r1, r2, r3, r4] = ladder.rounds;

  return (
    <div className="ladder-sheet bg-white text-black font-serif">
      <SheetHeader header={header} fieldSize={ladder.fieldSize} />

      <div className="px-4 pt-1 pb-3">
        <div className="border border-black">
          <BracketGrid r1={r1} r2={r2} r3={r3} r4={r4} />
        </div>
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
    <div className="border-b border-black px-4 pt-2 pb-2 relative">
      <div className="absolute right-4 top-2 text-[9px] italic">
        {h.systemMark ?? ""}
      </div>
      {h.eventTitle && (
        <div className="text-center text-xs italic leading-tight whitespace-pre-line">
          {h.eventTitle}
        </div>
      )}
      {(h.venue || h.dateRange) && (
        <div className="text-center text-xs italic leading-tight">
          {h.venue}
          {h.venue && h.dateRange ? " " : ""}
          {h.dateRange}
        </div>
      )}

      <div className="flex items-end justify-between mt-1.5">
        <div className="text-[9px] leading-tight">
          {(h.lowEt || h.topSpeed) && (
            <div>Qualified Positions for ....</div>
          )}
          {h.lowEt && (
            <div>
              Low E.T. ........ {h.lowEt.value} Sec &nbsp;&nbsp; {h.lowEt.carNumber}{" "}
              {h.lowEt.driver}
            </div>
          )}
          {h.topSpeed && (
            <div>
              Top Speed ... {h.topSpeed.value} MPH &nbsp;&nbsp; {h.topSpeed.carNumber}{" "}
              {h.topSpeed.driver}
            </div>
          )}
        </div>

        <div className="flex-1 text-center">
          {h.classTitle && (
            <div className="text-sm font-bold tracking-wide">{h.classTitle}</div>
          )}
          {h.seriesBanner && (
            <div className="text-xs font-bold tracking-wide">
              {h.seriesBanner}
            </div>
          )}
          <div className="text-[10px] font-semibold mt-0.5">
            {fieldSize}-car field
          </div>
        </div>

        <div className="text-[9px] leading-tight text-right whitespace-nowrap">
          {h.runTime && <div>{h.runTime}</div>}
          {h.runDate && <div>{h.runDate}</div>}
        </div>
      </div>
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
  r1,
  r2,
  r3,
  r4,
}: {
  r1: QuadCell[];
  r2: QuadCell[];
  r3: QuadCell[];
  r4: QuadCell[];
}) {
  const N = r1.length; // 8 for the 17-car ladder

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns:
          "minmax(155px, 1fr) 22px minmax(110px, 1fr) 22px minmax(110px, 1fr) 22px minmax(110px, 1fr)",
        gridTemplateRows: `repeat(${N}, minmax(74px, 1fr))`,
      }}
    >
      {r1.map((q, k) => (
        <GridCell key={`r1-${k}`} col={1} rowStart={k + 1} rowSpan={1}>
          <QuadBox quad={q} />
        </GridCell>
      ))}

      {r2.map((_, i) => (
        <GridCell key={`c12-${i}`} col={2} rowStart={2 * i + 1} rowSpan={2}>
          <ConnectorPair />
        </GridCell>
      ))}
      {r2.map((q, i) => (
        <GridCell key={`r2-${i}`} col={3} rowStart={2 * i + 1} rowSpan={2}>
          <QuadBox quad={q} />
        </GridCell>
      ))}

      {r3.map((_, i) => (
        <GridCell key={`c23-${i}`} col={4} rowStart={4 * i + 1} rowSpan={4}>
          <ConnectorPair />
        </GridCell>
      ))}
      {r3.map((q, i) => (
        <GridCell key={`r3-${i}`} col={5} rowStart={4 * i + 1} rowSpan={4}>
          <QuadBox quad={q} />
        </GridCell>
      ))}

      <GridCell col={6} rowStart={1} rowSpan={N}>
        <ConnectorPair />
      </GridCell>
      <GridCell col={7} rowStart={1} rowSpan={N}>
        <FinalCell quad={r4[0]} />
      </GridCell>
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

function FinalCell({ quad }: { quad: QuadCell }) {
  return (
    <div className="flex flex-col w-full">
      <div className="text-center text-xs italic mb-1">** Champion **</div>
      <QuadBox quad={quad} isFinal />
    </div>
  );
}

function QuadBox({ quad, isFinal }: { quad: QuadCell; isFinal?: boolean }) {
  const isRound1 = quad.round === 1;
  // Match the blank-reference layout: in round 1, hide bye lanes so each
  // box only contains the active racing lanes (e.g. Q1 shows just two rows
  // for seeds 1 & 16, Q2 shows three rows for 8/9/17). Later rounds keep
  // all four lane slots since they represent a full 4-wide quad.
  const lanesToShow = isRound1
    ? quad.lanes.filter((l) => !l.isBye)
    : quad.lanes;
  return (
    <div className="border border-black bg-white w-full">
      {lanesToShow.map((lane, idx) => (
        <div
          key={idx}
          className={`px-1 py-0.5 ${idx > 0 ? "border-t border-black" : ""}`}
          style={{ minHeight: isRound1 ? 22 : 16 }}
        >
          <LaneRow lane={lane} showResult={isRound1} isFinal={isFinal} />
        </div>
      ))}
    </div>
  );
}

function LaneRow({
  lane,
  showResult,
  isFinal,
}: {
  lane: Lane;
  showResult: boolean;
  isFinal?: boolean;
}) {
  if (showResult && lane.qualifier) {
    const q = lane.qualifier;
    return (
      <div className="text-[8px] leading-[1.1] font-mono">
        <div className="flex gap-1">
          <span className="w-3 text-right">{q.position}</span>
          <span className="w-8 text-right">{q.carNumber ?? ""}</span>
          <span className="flex-1 truncate">{q.driver ?? ""}</span>
        </div>
        <div className="flex gap-1">
          <span className="w-3" />
          <span className="w-10 text-right">
            {q.et != null ? q.et.toFixed(3) : ""}
          </span>
          <span className="flex-1">
            {q.qMph != null ? q.qMph.toFixed(2) : ""}
          </span>
        </div>
      </div>
    );
  }

  if (showResult) {
    // Round 1 cell with no qualifier loaded — show just the seed.
    return (
      <div className="text-[9px] leading-tight font-mono">
        {lane.position != null ? <div>{lane.position}</div> : <div>&nbsp;</div>}
      </div>
    );
  }

  // Later rounds: print the projected seed number (ghost label).
  return (
    <div className="text-[9px] leading-tight font-mono">
      {lane.position != null && !isFinal ? (
        <div>{lane.position}</div>
      ) : (
        <div>&nbsp;</div>
      )}
    </div>
  );
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
          margin: 0.4in;
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
