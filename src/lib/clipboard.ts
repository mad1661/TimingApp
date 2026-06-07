// Client-only clipboard helpers. Do not import from server code.

export interface CopyTableOptions {
  /** Bold heading rendered above the table (e.g. "Dead On - Spring Nationals"). */
  title: string;
  /** Optional smaller line under the title (e.g. "Mode: Quickest ET"). */
  subtitle?: string;
  /** Column headers. */
  headers: string[];
  /** Row cells, one array per row. Numbers are stringified; null/undefined render blank. */
  rows: (string | number | null | undefined)[][];
}

type Cell = string | number | null | undefined;

function escapeHtml(value: Cell): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cellText(value: Cell): string {
  return String(value ?? "");
}

/**
 * Build the rich (HTML table) and plain (tab-separated) representations of a
 * publication table. Exported mainly so the payload can be unit-checked; pages
 * normally call copyTableForPublication.
 */
export function buildTablePayload(opts: CopyTableOptions): { html: string; text: string } {
  const { title, subtitle, headers, rows } = opts;

  const th = headers
    .map(
      (h) =>
        `<th style="border:1px solid #cccccc;padding:6px 10px;background:#f2f2f2;text-align:left;font-weight:bold;">${escapeHtml(
          h
        )}</th>`
    )
    .join("");

  const trs = rows
    .map((row, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f9f9f9";
      const tds = row
        .map(
          (c) =>
            `<td style="border:1px solid #cccccc;padding:6px 10px;text-align:left;">${escapeHtml(c)}</td>`
        )
        .join("");
      return `<tr style="background:${bg};">${tds}</tr>`;
    })
    .join("");

  const titleHtml = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;margin:0 0 2px;">${escapeHtml(
    title
  )}</div>`;
  const subtitleHtml = subtitle
    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#555555;margin:0 0 8px;">${escapeHtml(
        subtitle
      )}</div>`
    : "";

  const html =
    `<div>${titleHtml}${subtitleHtml}` +
    `<table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;">` +
    `<thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;

  // Tab-separated plain-text fallback — pastes cleanly into spreadsheets and
  // any client that ignores the HTML representation.
  const lines = [title];
  if (subtitle) lines.push(subtitle);
  lines.push("");
  lines.push(headers.map(cellText).join("\t"));
  for (const row of rows) lines.push(row.map(cellText).join("\t"));
  const text = lines.join("\n");

  return { html, text };
}

/**
 * Copy a table to the clipboard as both an HTML table (so it pastes as a real
 * table into email/docs) and tab-separated text (for spreadsheets / plain
 * contexts). Returns true on success. Must be called from a user gesture.
 */
export async function copyTableForPublication(opts: CopyTableOptions): Promise<boolean> {
  const { html, text } = buildTablePayload(opts);

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    } catch {
      // Fall through to plain-text copy below.
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
