"use client";

export interface TimeslipRun {
  timestamp: string | null;
  round: string | null;
  car_number: string | null;
  name: string | null;
  class_index: string | null;
  rt: number | null;
  ft60: number | null;
  ft330: number | null;
  ft660: number | null;
  mph_660: number | null;
  ft1000: number | null;
  mph_1000: number | null;
  ft1320: number | null;
  mph_1320: number | null;
  mov: number | null;
  is_winner: number;
  is_dq: number;
  result?: string | null;
  category: string | null;
  lane: string | null;
  dial_in: number | null;
  event_name: string | null;
  event_code: string | null;
  season: string | null;
}

interface TimeslipCardProps {
  /** For 2-wide: left runner */
  left?: TimeslipRun;
  /** For 2-wide: right runner (null for bye/solo) */
  right?: TimeslipRun | null;
  /** For 4-wide (or any width): array of all runners sorted by lane */
  runners?: TimeslipRun[];
  eventTitle?: string;
}

function fmt(val: number | null | undefined, decimals = 3): string {
  if (val == null) return "-.---";
  return val.toFixed(decimals);
}

function fmtMph(val: number | null | undefined): string {
  if (val == null) return "--.--";
  return val.toFixed(2);
}

/** Get the display label for a result (W/R/3/4) */
function resultBadge(run: TimeslipRun): { text: string; bg: string; fg: string } | null {
  const r = run.result?.trim().toUpperCase();
  if (r === "W") return { text: "WIN", bg: "bg-green-600", fg: "text-white" };
  if (r === "R") return { text: "R/U", bg: "bg-blue-600", fg: "text-white" };
  if (r === "3") return { text: "3RD", bg: "bg-gray-500", fg: "text-white" };
  if (r === "4") return { text: "4TH", bg: "bg-gray-500", fg: "text-white" };
  if (run.is_winner) return { text: "WIN", bg: "bg-green-600", fg: "text-white" };
  return null;
}

function resultRowBg(run: TimeslipRun): string {
  const r = run.result?.trim().toUpperCase();
  if (r === "W" || (!r && run.is_winner)) return "bg-green-100";
  if (r === "R") return "bg-blue-100";
  if (r === "3" || r === "4") return "bg-gray-50";
  return "bg-white";
}

// --------------- 2-Wide Layout ---------------

function TimingRow2Wide({
  label,
  vals,
  bold,
  highlight,
  subs,
}: {
  label: string;
  vals: string[];
  bold?: boolean;
  highlight?: boolean;
  subs?: string[];
}) {
  const valClass = bold ? "font-black" : "font-bold";
  const textSize = highlight ? "text-xl" : "text-sm";
  const subSize = highlight ? textSize : "text-[10px]";

  return (
    <div className={`flex items-center ${highlight ? "py-2.5 bg-gray-50 -mx-1 px-1 rounded" : "py-1.5"} border-b border-dashed border-gray-300 last:border-0`}>
      <div className="flex-1 text-right pr-3">
        <span className={`${valClass} ${textSize} font-mono`}>{vals[0]}</span>
        {subs && <div className={`${subSize} text-black font-mono`}>{subs[0]}</div>}
      </div>
      <div className="w-24 text-center flex-shrink-0">
        <span className={`text-[10px] uppercase tracking-wider text-black ${highlight ? "font-bold" : ""}`}>
          {label}
        </span>
      </div>
      <div className="flex-1 text-left pl-3">
        <span className={`${valClass} ${textSize} font-mono ${!vals[1] || vals[1].startsWith("-") ? "text-gray-300" : ""}`}>{vals[1]}</span>
        {subs && <div className={`${subSize} text-black font-mono`}>{subs[1]}</div>}
      </div>
    </div>
  );
}

function Timeslip2Wide({ runners, eventTitle }: { runners: TimeslipRun[]; eventTitle?: string }) {
  const left = runners[0];
  const right = runners[1] ?? null;
  const date = left.timestamp?.split(" ")[0] ?? "";
  const time = left.timestamp?.split(" ")[1] ?? "";
  const leftBadge = resultBadge(left);
  const rightBadge = right ? resultBadge(right) : null;

  return (
    <div className="timeslip-card w-full max-w-[520px] bg-white text-black font-mono text-sm border-2 border-gray-800 rounded print:border print:rounded-none print:shadow-none">
      {/* Header */}
      <div className="bg-gray-900 text-white px-4 py-3 text-center">
        <div className="text-base font-bold tracking-wider">
          {eventTitle || left.event_name || "NHRA EVENT"}
        </div>
        <div className="text-[10px] text-gray-400 mt-0.5">
          {date} &bull; {left.season} &bull; Round {left.round || "-"} &bull; {left.category || "-"}
        </div>
      </div>

      {/* Racer names header */}
      <div className="flex items-stretch border-b-2 border-gray-800">
        <div className={`flex-1 px-3 py-2.5 text-center ${resultRowBg(left)}`}>
          <div className="text-sm font-black tracking-wide truncate">{left.name || "—"}</div>
          <div className="flex items-center justify-center gap-2 mt-0.5">
            <span className="text-xs text-nhra-accent font-bold">#{left.car_number || "-"}</span>
            <span className="text-[10px] text-black">{left.lane || ""}</span>
            {leftBadge && <span className={`text-[9px] font-bold ${leftBadge.bg} ${leftBadge.fg} px-1.5 py-0.5 rounded`}>{leftBadge.text}</span>}
          </div>
        </div>
        <div className="w-px bg-gray-800" />
        <div className="w-24 flex-shrink-0 bg-gray-800 flex items-center justify-center">
          <span className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">VS</span>
        </div>
        <div className="w-px bg-gray-800" />
        <div className={`flex-1 px-3 py-2.5 text-center ${right ? resultRowBg(right) : "bg-white"}`}>
          {right ? (
            <>
              <div className="text-sm font-black tracking-wide truncate">{right.name || "—"}</div>
              <div className="flex items-center justify-center gap-2 mt-0.5">
                <span className="text-xs text-nhra-accent font-bold">#{right.car_number || "-"}</span>
                <span className="text-[10px] text-black">{right.lane || ""}</span>
                {rightBadge && <span className={`text-[9px] font-bold ${rightBadge.bg} ${rightBadge.fg} px-1.5 py-0.5 rounded`}>{rightBadge.text}</span>}
              </div>
            </>
          ) : (
            <div className="text-xs text-gray-300 italic">Solo / Bye</div>
          )}
        </div>
      </div>

      {/* Dial-In */}
      <div className="flex items-center border-b border-gray-300 bg-gray-50">
        <div className="flex-1 text-right pr-3 py-1.5">
          <span className="text-xs font-bold font-mono">{left.dial_in != null ? fmt(left.dial_in, 2) : "N/A"}</span>
        </div>
        <div className="w-24 text-center flex-shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-black font-bold">Dial-In</span>
        </div>
        <div className="flex-1 text-left pl-3 py-1.5">
          <span className={`text-xs font-bold font-mono ${!right ? "text-gray-300" : ""}`}>{right?.dial_in != null ? fmt(right.dial_in, 2) : "N/A"}</span>
        </div>
      </div>

      {/* Timing rows */}
      <div className="px-3 py-1">
        <TimingRow2Wide label="R/T" vals={[fmt(left.rt), fmt(right?.rt)]} bold />
        <TimingRow2Wide label="60'" vals={[fmt(left.ft60), fmt(right?.ft60)]} />
        <TimingRow2Wide label="330'" vals={[fmt(left.ft330), fmt(right?.ft330)]} />
        <TimingRow2Wide label="660' (⅛ mi)" vals={[fmt(left.ft660), fmt(right?.ft660)]} subs={[`${fmtMph(left.mph_660)} mph`, `${fmtMph(right?.mph_660)} mph`]} />
        <TimingRow2Wide label="1000'" vals={[fmt(left.ft1000), fmt(right?.ft1000)]} subs={[`${fmtMph(left.mph_1000)} mph`, `${fmtMph(right?.mph_1000)} mph`]} />
        <TimingRow2Wide label="ET (¼ mi)" vals={[fmt(left.ft1320), fmt(right?.ft1320)]} bold highlight subs={[`${fmtMph(left.mph_1320)} mph`, `${fmtMph(right?.mph_1320)} mph`]} />
      </div>

      {/* MOV */}
      {left.mov != null && (
        <div className="border-t border-gray-300 px-3 py-1.5 flex justify-center">
          <span className="text-[10px] text-black uppercase tracking-wider">Margin of Victory: </span>
          <span className="text-xs font-bold font-mono ml-1">{fmt(left.mov, 4)}</span>
        </div>
      )}

      {/* Footer */}
      <div className="bg-gray-900 text-white px-4 py-2 text-center text-[10px]">
        <div className="text-gray-400">
          {time && `${time}`}
          {left.class_index && ` | Class: ${left.class_index}`}
          {left.event_code && ` | Event: ${left.event_code}`}
        </div>
        <div className="font-bold tracking-widest mt-0.5 text-xs">Timing Data</div>
      </div>
    </div>
  );
}

// --------------- 4-Wide Layout ---------------

function TimingRow4Wide({
  label,
  runners,
  bold,
  highlight,
  subs,
}: {
  label: string;
  runners: { val: string; sub?: string }[];
  bold?: boolean;
  highlight?: boolean;
  subs?: boolean;
}) {
  const valClass = bold ? "font-black" : "font-bold";
  const textSize = highlight ? "text-lg sm:text-xl" : "text-xs sm:text-sm";
  const subSize = highlight ? textSize : "text-[9px]";
  const midIdx = Math.ceil(runners.length / 2);

  return (
    <div className={`flex items-center ${highlight ? "py-2 bg-gray-50 -mx-1 px-1 rounded" : "py-1"} border-b border-dashed border-gray-300 last:border-0`}>
      {runners.slice(0, midIdx).map((r, i) => (
        <div key={`L${i}`} className={`flex-1 text-center ${i > 0 ? "border-l border-gray-200" : ""}`}>
          <span className={`${valClass} ${textSize} font-mono`}>{r.val}</span>
          {subs && r.sub && <div className={`${subSize} text-black font-mono`}>{r.sub}</div>}
        </div>
      ))}
      <div className="w-20 text-center flex-shrink-0 px-1">
        <span className={`text-[10px] uppercase tracking-wider text-black ${highlight ? "font-bold" : ""}`}>
          {label}
        </span>
      </div>
      {runners.slice(midIdx).map((r, i) => (
        <div key={`R${i}`} className={`flex-1 text-center ${i > 0 ? "border-l border-gray-200" : ""}`}>
          <span className={`${valClass} ${textSize} font-mono`}>{r.val}</span>
          {subs && r.sub && <div className={`${subSize} text-black font-mono`}>{r.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function Timeslip4Wide({ runners, eventTitle }: { runners: TimeslipRun[]; eventTitle?: string }) {
  const first = runners[0];
  const date = first.timestamp?.split(" ")[0] ?? "";
  const time = first.timestamp?.split(" ")[1] ?? "";

  return (
    <div className="timeslip-card w-full max-w-[700px] bg-white text-black font-mono text-sm border-2 border-gray-800 rounded print:border print:rounded-none print:shadow-none">
      {/* Header */}
      <div className="bg-gray-900 text-white px-4 py-3 text-center">
        <div className="text-base font-bold tracking-wider">
          {eventTitle || first.event_name || "NHRA EVENT"}
        </div>
        <div className="text-[10px] text-gray-400 mt-0.5">
          {date} &bull; {first.season} &bull; Round {first.round || "-"} &bull; {first.category || "-"} &bull; 4-WIDE
        </div>
      </div>

      {/* Racer names header — flex with middle gap */}
      <div className="flex items-stretch border-b-2 border-gray-800">
        {(() => {
          const mid = Math.ceil(runners.length / 2);
          const left = runners.slice(0, mid);
          const right = runners.slice(mid);
          const renderLane = (run: TimeslipRun, i: number, offset: number) => {
            const badge = resultBadge(run);
            const laneNum = offset + i + 1;
            return (
              <div key={`${offset}-${i}`} className={`flex-1 px-2 py-2 text-center ${resultRowBg(run)} ${i > 0 || offset > 0 ? "border-l border-gray-800" : ""}`}>
                <div className="text-[10px] text-black font-bold uppercase mb-0.5">Lane {laneNum}</div>
                <div className="text-xs sm:text-sm font-black tracking-wide truncate">{run.name || "—"}</div>
                <div className="flex items-center justify-center gap-1 mt-0.5 flex-wrap">
                  <span className="text-[10px] text-nhra-accent font-bold">#{run.car_number || "-"}</span>
                  {badge && <span className={`text-[8px] font-bold ${badge.bg} ${badge.fg} px-1 py-0.5 rounded`}>{badge.text}</span>}
                </div>
              </div>
            );
          };
          return (
            <>
              {left.map((run, i) => renderLane(run, i, 0))}
              <div className="w-20 flex-shrink-0 bg-gray-800 flex items-center justify-center">
                <span className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">VS</span>
              </div>
              {right.map((run, i) => renderLane(run, i, mid))}
            </>
          );
        })()}
      </div>

      {/* Dial-In row — flex with matching middle gap */}
      <div className="flex items-center border-b border-gray-300 bg-gray-50">
        {(() => {
          const mid = Math.ceil(runners.length / 2);
          const left = runners.slice(0, mid);
          const right = runners.slice(mid);
          const renderDial = (run: TimeslipRun, i: number, offset: number) => (
            <div key={`${offset}-${i}`} className={`flex-1 text-center py-1.5 ${i > 0 || offset > 0 ? "border-l border-gray-200" : ""}`}>
              <div className="text-[9px] text-black uppercase">Dial-In</div>
              <span className="text-xs font-bold font-mono">{run.dial_in != null ? fmt(run.dial_in, 2) : "N/A"}</span>
            </div>
          );
          return (
            <>
              {left.map((run, i) => renderDial(run, i, 0))}
              <div className="w-20 flex-shrink-0" />
              {right.map((run, i) => renderDial(run, i, mid))}
            </>
          );
        })()}
      </div>

      {/* Timing rows */}
      <div className="px-2 py-1">
        <TimingRow4Wide label="R/T" runners={runners.map((r) => ({ val: fmt(r.rt) }))} bold />
        <TimingRow4Wide label="60'" runners={runners.map((r) => ({ val: fmt(r.ft60) }))} />
        <TimingRow4Wide label="330'" runners={runners.map((r) => ({ val: fmt(r.ft330) }))} />
        <TimingRow4Wide label="660'" runners={runners.map((r) => ({ val: fmt(r.ft660), sub: `${fmtMph(r.mph_660)} mph` }))} subs />
        <TimingRow4Wide label="1000'" runners={runners.map((r) => ({ val: fmt(r.ft1000), sub: `${fmtMph(r.mph_1000)} mph` }))} subs />
        <TimingRow4Wide label="ET (¼ mi)" runners={runners.map((r) => ({ val: fmt(r.ft1320), sub: `${fmtMph(r.mph_1320)} mph` }))} bold highlight subs />
      </div>

      {/* MOV */}
      {first.mov != null && (
        <div className="border-t border-gray-300 px-3 py-1.5 flex justify-center">
          <span className="text-[10px] text-black uppercase tracking-wider">Margin of Victory: </span>
          <span className="text-xs font-bold font-mono ml-1">{fmt(first.mov, 4)}</span>
        </div>
      )}

      {/* Footer */}
      <div className="bg-gray-900 text-white px-4 py-2 text-center text-[10px]">
        <div className="text-gray-400">
          {time && `${time}`}
          {first.class_index && ` | Class: ${first.class_index}`}
          {first.event_code && ` | Event: ${first.event_code}`}
        </div>
        <div className="font-bold tracking-widest mt-0.5 text-xs">Timing Data</div>
      </div>
    </div>
  );
}

// --------------- Main Component ---------------

export default function TimeslipCard({ left, right, runners, eventTitle }: TimeslipCardProps) {
  // Normalize to runners array
  const allRunners: TimeslipRun[] = runners
    ? runners
    : left
      ? right ? [left, right] : [left]
      : [];

  if (allRunners.length === 0) return null;

  if (allRunners.length > 2) {
    return <Timeslip4Wide runners={allRunners} eventTitle={eventTitle} />;
  }

  return <Timeslip2Wide runners={allRunners} eventTitle={eventTitle} />;
}
