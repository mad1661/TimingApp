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
  category: string | null;
  lane: string | null;
  dial_in: number | null;
  event_name: string | null;
  event_code: string | null;
  season: string | null;
}

interface TimeslipCardProps {
  left: TimeslipRun;
  right: TimeslipRun | null;
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

function TimingRow({
  label,
  leftVal,
  rightVal,
  bold,
  highlight,
  sub,
}: {
  label: string;
  leftVal: string;
  rightVal: string;
  bold?: boolean;
  highlight?: boolean;
  sub?: { left: string; right: string };
}) {
  const valClass = bold ? "font-black" : "font-bold";
  const textSize = highlight ? "text-xl" : "text-sm";

  return (
    <div className={`flex items-center ${highlight ? "py-2.5 bg-gray-50 -mx-1 px-1 rounded" : "py-1.5"} border-b border-dashed border-gray-300 last:border-0`}>
      <div className="flex-1 text-right pr-3">
        <span className={`${valClass} ${textSize} font-mono`}>{leftVal}</span>
        {sub && <div className="text-[10px] text-gray-500 font-mono">{sub.left}</div>}
      </div>
      <div className="w-24 text-center flex-shrink-0">
        <span className={`text-[10px] uppercase tracking-wider text-gray-500 ${highlight ? "font-bold text-gray-700" : ""}`}>
          {label}
        </span>
      </div>
      <div className="flex-1 text-left pl-3">
        <span className={`${valClass} ${textSize} font-mono ${!rightVal || rightVal.startsWith("-") ? "text-gray-300" : ""}`}>{rightVal}</span>
        {sub && <div className="text-[10px] text-gray-500 font-mono">{sub.right}</div>}
      </div>
    </div>
  );
}

export default function TimeslipCard({ left, right, eventTitle }: TimeslipCardProps) {
  const date = left.timestamp?.split(" ")[0] ?? "";
  const time = left.timestamp?.split(" ")[1] ?? "";

  return (
    <div className="timeslip-card w-[520px] bg-white text-black font-mono text-sm border-2 border-gray-800 rounded print:border print:rounded-none print:shadow-none">
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
        {/* Left racer */}
        <div className={`flex-1 px-3 py-2.5 text-center ${left.is_winner ? "bg-green-50" : "bg-white"}`}>
          <div className="text-sm font-black tracking-wide truncate">{left.name || "—"}</div>
          <div className="flex items-center justify-center gap-2 mt-0.5">
            <span className="text-xs text-nhra-accent font-bold">#{left.car_number || "-"}</span>
            <span className="text-[10px] text-gray-400">{left.lane || ""}</span>
            {left.is_winner ? (
              <span className="text-[9px] font-bold bg-green-600 text-white px-1.5 py-0.5 rounded">WIN</span>
            ) : null}
          </div>
        </div>
        {/* Center divider */}
        <div className="w-px bg-gray-800" />
        <div className="w-24 flex-shrink-0 bg-gray-800 flex items-center justify-center">
          <span className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">VS</span>
        </div>
        <div className="w-px bg-gray-800" />
        {/* Right racer */}
        <div className={`flex-1 px-3 py-2.5 text-center ${right?.is_winner ? "bg-green-50" : "bg-white"}`}>
          {right ? (
            <>
              <div className="text-sm font-black tracking-wide truncate">{right.name || "—"}</div>
              <div className="flex items-center justify-center gap-2 mt-0.5">
                <span className="text-xs text-nhra-accent font-bold">#{right.car_number || "-"}</span>
                <span className="text-[10px] text-gray-400">{right.lane || ""}</span>
                {right.is_winner ? (
                  <span className="text-[9px] font-bold bg-green-600 text-white px-1.5 py-0.5 rounded">WIN</span>
                ) : null}
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
          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Dial-In</span>
        </div>
        <div className="flex-1 text-left pl-3 py-1.5">
          <span className={`text-xs font-bold font-mono ${!right ? "text-gray-300" : ""}`}>{right?.dial_in != null ? fmt(right.dial_in, 2) : "N/A"}</span>
        </div>
      </div>

      {/* Timing rows */}
      <div className="px-3 py-1">
        <TimingRow
          label="R/T"
          leftVal={fmt(left.rt)}
          rightVal={fmt(right?.rt)}
          bold
        />
        <TimingRow
          label="60'"
          leftVal={fmt(left.ft60)}
          rightVal={fmt(right?.ft60)}
        />
        <TimingRow
          label="330'"
          leftVal={fmt(left.ft330)}
          rightVal={fmt(right?.ft330)}
        />
        <TimingRow
          label="660' (⅛ mi)"
          leftVal={fmt(left.ft660)}
          rightVal={fmt(right?.ft660)}
          sub={{ left: `${fmtMph(left.mph_660)} mph`, right: `${fmtMph(right?.mph_660)} mph` }}
        />
        <TimingRow
          label="1000'"
          leftVal={fmt(left.ft1000)}
          rightVal={fmt(right?.ft1000)}
          sub={{ left: `${fmtMph(left.mph_1000)} mph`, right: `${fmtMph(right?.mph_1000)} mph` }}
        />
        <TimingRow
          label="ET (¼ mi)"
          leftVal={fmt(left.ft1320)}
          rightVal={fmt(right?.ft1320)}
          bold
          highlight
          sub={{ left: `${fmtMph(left.mph_1320)} mph`, right: `${fmtMph(right?.mph_1320)} mph` }}
        />
      </div>

      {/* MOV */}
      {left.mov != null && (
        <div className="border-t border-gray-300 px-3 py-1.5 flex justify-center">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Margin of Victory: </span>
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
