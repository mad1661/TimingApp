"use client";

import type { RoundPrintPayload, RoundPrintRun } from "@/app/api/round-print/route";

interface Props {
  data: RoundPrintPayload;
  categoryLabel: string;
  footerLabel?: string;
}

function pad(s: string, len: number, align: "left" | "right" = "left"): string {
  if (s.length >= len) return s.slice(0, len);
  const diff = " ".repeat(len - s.length);
  return align === "left" ? s + diff : diff + s;
}

function fmt3(v: number | null | undefined): string {
  if (v == null) return "";
  return v.toFixed(3);
}

function fmt2(v: number | null | undefined): string {
  if (v == null) return "";
  return v.toFixed(2);
}

function fmtRT(v: number | null | undefined): string {
  if (v == null) return "";
  const s = v.toFixed(3);
  return v < 0 ? s : (v >= 1 ? s : "." + s.split(".")[1]);
}

function fmtMov(v: number | null | undefined, places = 4): string {
  if (v == null) return "";
  const abs = Math.abs(v);
  const s = abs.toFixed(places);
  return "." + s.split(".")[1];
}

function fmtOverUnder(v: number | null | undefined): string {
  if (v == null) return "";
  return v.toString();
}

function fmtIndex(run: RoundPrintRun): string {
  if (run.index_value != null) return run.index_value.toFixed(2);
  return run.class_index ?? "";
}

const COL_WIDTHS = {
  car: 5,
  cls: 4,
  idx: 6,
  ov: 5,
  di: 3,
  rt: 6,
  ft60: 6,
  ft330: 6,
  ft660: 6,
  mph660: 6,
  ft1000: 6,
  et: 6,
  mph: 6,
  run: 5,
  first: 6,
  mov: 4,
  time: 6,
  remarks: 8,
} as const;

function Cell({ children, w, right }: { children: React.ReactNode; w: number; right?: boolean }) {
  const s = String(children ?? "");
  return (
    <span className="whitespace-pre">{pad(s, w, right ? "right" : "left")}</span>
  );
}

function Divider({ cols }: { cols: string }) {
  return <span className="text-gray-500 whitespace-pre">{cols}</span>;
}

export default function RoundPrintCard({ data, categoryLabel, footerLabel }: Props) {
  const {
    round_header,
    start_time_label,
    end_time_label,
    date_label,
    car_count,
    pairs,
  } = data;

  const headerLine = `${round_header}   ${start_time_label}   ${date_label}`;
  const bang = "!".repeat(90);
  const dots = ".".repeat(30);

  const headerRow = (
    <div className="flex gap-0">
      <Cell w={COL_WIDTHS.car} right>#</Cell>
      <span> </span>
      <Cell w={COL_WIDTHS.cls}>CLASS</Cell>
      <span>|</span>
      <Cell w={COL_WIDTHS.idx}>Idx/Rec</Cell>
      <span>|</span>
      <Cell w={COL_WIDTHS.ov} right>Ov/Un</Cell>
      <span>|</span>
      <Cell w={COL_WIDTHS.di}>D/I</Cell>
      <span>|</span>
      <Cell w={COL_WIDTHS.rt} right>R/T</Cell>
      <span>|</span>
      <Cell w={COL_WIDTHS.ft60} right>60&apos;</Cell>
      <span>|</span>
      <Cell w={COL_WIDTHS.ft330} right>330</Cell>
      <span>|</span>
      <Cell w={COL_WIDTHS.ft660} right>1/8</Cell>
      <span>|</span>
      <Cell w={COL_WIDTHS.mph660} right>MPH</Cell>
      <span>|</span>
      <Cell w={COL_WIDTHS.ft1000} right>1000</Cell>
      <span>|</span>
      <Cell w={COL_WIDTHS.et} right>ET</Cell>
      <span>|</span>
      <Cell w={COL_WIDTHS.mph} right>MPH</Cell>
      <span>|</span>
      <Cell w={COL_WIDTHS.run} right>Run #</Cell>
      <span>|</span>
      <Cell w={COL_WIDTHS.first} right>1st</Cell>
      <span> </span>
      <Cell w={COL_WIDTHS.mov} right>MOV</Cell>
      <span>|</span>
      <Cell w={COL_WIDTHS.time}>TIME</Cell>
      <span> </span>
      <Cell w={COL_WIDTHS.remarks}>Remarks</Cell>
    </div>
  );

  return (
    <div className="round-print bg-white text-black font-mono text-[11px] leading-[1.25] p-4 mx-auto print:p-0 print:shadow-none print:m-0" style={{ width: "100%", maxWidth: "1080px" }}>
      {/* Header block */}
      <div className="whitespace-pre text-[10px]">
        <div>{bang}</div>
        <div className="flex justify-between items-start">
          <div>{headerLine}</div>
          <div className="font-bold text-base tracking-widest">{categoryLabel}</div>
          <div className="w-[160px]">&nbsp;</div>
        </div>
        <div>{bang}</div>
        <div className="text-right">CompuLink StarTrak    #####</div>
      </div>

      <div className="mt-2 border-y border-dashed border-gray-400 py-1 font-bold">
        {headerRow}
      </div>

      <div className="mt-1">
        {pairs.map((pair, pi) => {
          const winnerMovAssigned = pair.pair_mov != null;
          const winnerCar = pair.winner_car;
          return (
            <div key={pair.canonical_ts + pi} className="mb-2">
              {pair.runs.map((run, ri) => {
                const isWinner = run.car_number != null && run.car_number === winnerCar;
                const showFirst = isWinner && winnerMovAssigned;
                const showTime = ri === 0;
                const cls = (run.class_index || "").slice(0, COL_WIDTHS.cls);
                return (
                  <div key={`${pair.canonical_ts}-${run.run_number}-${ri}`} className="flex gap-0 items-center">
                    <Cell w={COL_WIDTHS.car} right>{run.car_number ?? ""}</Cell>
                    <span> </span>
                    <Cell w={COL_WIDTHS.cls}>{cls}</Cell>
                    <Divider cols="|" />
                    <Cell w={COL_WIDTHS.idx}>{fmtIndex(run)}</Cell>
                    <Divider cols="|" />
                    <Cell w={COL_WIDTHS.ov} right>{fmtOverUnder(run.over_under_thou)}</Cell>
                    <Divider cols="|" />
                    <Cell w={COL_WIDTHS.di}>{""}</Cell>
                    <Divider cols="|" />
                    <Cell w={COL_WIDTHS.rt} right>{fmtRT(run.rt)}</Cell>
                    <Divider cols="|" />
                    <Cell w={COL_WIDTHS.ft60} right>{fmt3(run.ft60)}</Cell>
                    <Divider cols="|" />
                    <Cell w={COL_WIDTHS.ft330} right>{fmt3(run.ft330)}</Cell>
                    <Divider cols="|" />
                    <Cell w={COL_WIDTHS.ft660} right>{fmt3(run.ft660)}</Cell>
                    <Divider cols="|" />
                    <Cell w={COL_WIDTHS.mph660} right>{fmt2(run.mph_660)}</Cell>
                    <Divider cols="|" />
                    <Cell w={COL_WIDTHS.ft1000} right>{fmt3(run.ft1000)}</Cell>
                    <Divider cols="|" />
                    <Cell w={COL_WIDTHS.et} right>{fmt3(run.ft1320)}</Cell>
                    <Divider cols="|" />
                    <Cell w={COL_WIDTHS.mph} right>{fmt2(run.mph_1320)}</Cell>
                    <Divider cols="|" />
                    <Cell w={COL_WIDTHS.run} right>{String(run.run_number)}</Cell>
                    <Divider cols="|" />
                    <Cell w={COL_WIDTHS.first} right>{showFirst ? fmtMov(pair.pair_mov) : ""}</Cell>
                    <span> </span>
                    <Cell w={COL_WIDTHS.mov} right>{isWinner ? fmtMov(pair.pair_mov, 2) : ""}</Cell>
                    <Divider cols="|" />
                    <Cell w={COL_WIDTHS.time}>{showTime ? pair.time_label : ""}</Cell>
                    <span> </span>
                    <Cell w={COL_WIDTHS.remarks}>{run.remarks}</Cell>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="whitespace-pre text-center mt-3">
        {dots} END of CATEGORY ... {car_count} Cars ...... {footerLabel || data.end_time_label} {dots}
      </div>
    </div>
  );
}
