"use client";

import { Fragment } from "react";
import type { RoundPrintPayload, RoundPrintPair, RoundPrintRun } from "@/app/api/round-print/route";

interface Props {
  data: RoundPrintPayload;
  categoryLabel: string;
  footerLabel?: string;
}

const FIRST_PAGE_CARS = 32;
const NEXT_PAGE_CARS = 38;

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
  if (v >= 1) return v.toFixed(3);
  const abs = Math.abs(v).toFixed(3).split(".")[1];
  return (v < 0 ? "-." : ".") + abs;
}

function fmtMov(v: number | null | undefined, places = 4): string {
  if (v == null) return "";
  const abs = Math.abs(v);
  return "." + abs.toFixed(places).split(".")[1];
}

function fmtOverUnder(v: number | null | undefined): string {
  if (v == null) return "";
  return v.toString();
}

function fmtIndex(run: RoundPrintRun): string {
  if (run.index_value != null) return run.index_value.toFixed(2);
  return "";
}

function laneDisplay(lane: string | null | undefined): string {
  const l = (lane || "").trim().toUpperCase();
  if (l === "L" || l === "L1" || l === "1") return "1";
  if (l === "R" || l === "L2" || l === "2") return "2";
  if (l === "L3" || l === "3") return "3";
  if (l === "L4" || l === "4") return "4";
  return l;
}

function HeaderCell({ children, align = "left", w }: { children: React.ReactNode; align?: "left" | "right"; w: string }) {
  return (
    <th
      className={`px-2 py-0.5 font-bold border-b border-dashed border-gray-500 text-${align}`}
      style={{ width: w }}
    >
      {children}
    </th>
  );
}

function DataCell({ children, align = "left", mono = true }: { children?: React.ReactNode; align?: "left" | "right"; mono?: boolean }) {
  return (
    <td className={`px-2 py-[1px] text-${align} ${mono ? "font-mono" : ""} whitespace-nowrap`}>
      {children}
    </td>
  );
}

function chunkPairs(pairs: RoundPrintPair[]): RoundPrintPair[][] {
  const chunks: RoundPrintPair[][] = [];
  if (pairs.length === 0) return chunks;
  let cur: RoundPrintPair[] = [];
  let carsInChunk = 0;
  for (const pair of pairs) {
    const carsInPair = pair.runs.length;
    const limit = chunks.length === 0 ? FIRST_PAGE_CARS : NEXT_PAGE_CARS;
    if (cur.length > 0 && carsInChunk + carsInPair > limit) {
      chunks.push(cur);
      cur = [];
      carsInChunk = 0;
    }
    cur.push(pair);
    carsInChunk += carsInPair;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

function Banner({ roundHeader, startTime, date, category, isFourWide }: { roundHeader: string; startTime: string; date: string; category: string; isFourWide: boolean }) {
  const bangFill = "!".repeat(220);
  const compuLinkLabel = isFourWide ? "CompuLink 4 LANE" : "CompuLink StarTrak";
  return (
    <div className="leading-none">
      {/* Top bang line with category name centered */}
      <div className="flex items-baseline w-full overflow-hidden whitespace-nowrap">
        <span className="flex-1 overflow-hidden text-[9px]">{bangFill}</span>
        <span className="px-3 font-bold italic text-[13px] tracking-[0.25em] flex-shrink-0">{category}</span>
        <span className="flex-1 overflow-hidden text-[9px] text-right">{bangFill}</span>
      </div>

      {/* Round / time / date line */}
      <div className="text-[11px] mt-1 mb-1 font-bold">
        Round #&nbsp;{roundHeader.replace(/^Round # /, "")}&nbsp;&nbsp;&nbsp;{startTime}&nbsp;&nbsp;{date}
      </div>

      {/* Bottom bang line with CompuLink label on the right */}
      <div className="flex items-baseline w-full overflow-hidden whitespace-nowrap">
        <span className="flex-1 overflow-hidden text-[9px]">{bangFill}</span>
        <span className="pl-3 text-[10px] flex-shrink-0">{compuLinkLabel}&nbsp;&nbsp;&nbsp;&nbsp;#####</span>
      </div>

      <div className="h-2" />
    </div>
  );
}

function ColumnHeader() {
  return (
    <thead>
      <tr>
        <HeaderCell w="4%">Lane</HeaderCell>
        <HeaderCell align="right" w="4%">#</HeaderCell>
        <HeaderCell w="5%">CLASS</HeaderCell>
        <HeaderCell w="5%">Idx/Rec</HeaderCell>
        <HeaderCell align="right" w="5%">Ov/Un</HeaderCell>
        <HeaderCell align="right" w="4%">R/T</HeaderCell>
        <HeaderCell align="right" w="5%">60&apos;</HeaderCell>
        <HeaderCell align="right" w="5%">330</HeaderCell>
        <HeaderCell align="right" w="5%">1/8</HeaderCell>
        <HeaderCell align="right" w="5%">MPH</HeaderCell>
        <HeaderCell align="right" w="5%">1000</HeaderCell>
        <HeaderCell align="right" w="5%">ET</HeaderCell>
        <HeaderCell align="right" w="5%">MPH</HeaderCell>
        <HeaderCell align="right" w="4%">Run #</HeaderCell>
        <HeaderCell align="right" w="5%">Finish</HeaderCell>
        <HeaderCell w="6%">WINpos</HeaderCell>
        <HeaderCell align="right" w="4%">MOV</HeaderCell>
        <HeaderCell w="5%">TIME</HeaderCell>
        <HeaderCell w="7%">Remarks</HeaderCell>
      </tr>
    </thead>
  );
}

function PairRows({ pair }: { pair: RoundPrintPair }) {
  const winnerCar = pair.winner_car;
  return (
    <>
      {pair.runs.map((run, ri) => {
        const isWinner = run.car_number != null && run.car_number === winnerCar;
        const showTime = ri === 0;
        return (
          <tr key={`${pair.canonical_ts}-${run.run_number}-${ri}`} className="align-baseline">
            <DataCell>{laneDisplay(run.lane)}</DataCell>
            <DataCell align="right">{run.car_number ?? ""}</DataCell>
            <DataCell>{run.class_index ?? ""}</DataCell>
            <DataCell>{fmtIndex(run)}</DataCell>
            <DataCell align="right">{fmtOverUnder(run.over_under_thou)}</DataCell>
            <DataCell align="right">{fmtRT(run.rt)}</DataCell>
            <DataCell align="right">{fmt3(run.ft60)}</DataCell>
            <DataCell align="right">{fmt3(run.ft330)}</DataCell>
            <DataCell align="right">{fmt3(run.ft660)}</DataCell>
            <DataCell align="right">{fmt2(run.mph_660)}</DataCell>
            <DataCell align="right">{fmt3(run.ft1000)}</DataCell>
            <DataCell align="right">{fmt3(run.ft1320)}</DataCell>
            <DataCell align="right">{fmt2(run.mph_1320)}</DataCell>
            <DataCell align="right">{String(run.run_number)}</DataCell>
            <DataCell align="right">{run.finish != null ? String(run.finish) : ""}</DataCell>
            <DataCell>{run.winpos}</DataCell>
            <DataCell align="right">{isWinner ? fmtMov(pair.pair_mov, 2) : ""}</DataCell>
            <DataCell>{showTime ? pair.time_label : ""}</DataCell>
            <DataCell>{run.remarks}</DataCell>
          </tr>
        );
      })}
      <tr aria-hidden="true">
        <td colSpan={19} className="py-2" />
      </tr>
    </>
  );
}

export default function RoundPrintCard({ data, categoryLabel, footerLabel }: Props) {
  const {
    round_header,
    start_time_label,
    date_label,
    car_count,
    pairs,
  } = data;

  const dots = ".".repeat(30);
  const pageChunks = chunkPairs(pairs);
  const totalPages = pageChunks.length || 1;

  return (
    <div className="round-print bg-white text-black font-mono text-[11px] leading-tight p-5 mx-auto print:p-0 print:shadow-none print:m-0" style={{ width: "100%" }}>
      {pageChunks.map((chunk, pageIdx) => {
        const isFirst = pageIdx === 0;
        const isLast = pageIdx === totalPages - 1;
        return (
          <div
            key={`page-${pageIdx}`}
            className="round-print-page"
            style={{ breakAfter: isLast ? "auto" : "page", pageBreakAfter: isLast ? "auto" : "always" }}
          >
            {isFirst && (
              <Banner
                roundHeader={round_header}
                startTime={start_time_label}
                date={date_label}
                category={categoryLabel}
                isFourWide={data.is_four_wide}
              />
            )}

            <table className="w-full border-collapse text-[11px] leading-tight">
              <ColumnHeader />
              <tbody>
                {chunk.map((pair, pi) => (
                  <Fragment key={`${pair.canonical_ts}-${pageIdx}-${pi}`}>
                    <PairRows pair={pair} />
                  </Fragment>
                ))}
              </tbody>
            </table>

            {isLast && (
              <div className="whitespace-pre text-center mt-3 text-[11px]">
                {dots} END of CATEGORY ... {car_count} Cars ...... {footerLabel || data.end_time_label} {dots}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
