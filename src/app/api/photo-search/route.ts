import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keyless image search proxy for the standalone announcer site's driver photos
// (browsers can't query DuckDuckGo directly — no CORS). Read-only, CORS-open,
// same precedent as /api/live-runs.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

interface Photo {
  url: string;
  thumb: string;
  page: string;
  source: string;
}

// Per-instance cache so one event's worth of announcer pairs doesn't hammer DDG.
const cache = new Map<string, { at: number; photos: Photo[] }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

async function ddgImageSearch(query: string): Promise<Photo[]> {
  // Step 1: the HTML page hands out the vqd token the image endpoint requires.
  const pageRes = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
    { headers: { "User-Agent": UA } },
  );
  if (!pageRes.ok) throw new Error(`DDG page ${pageRes.status}`);
  const html = await pageRes.text();
  const m = /vqd=([\d-]+)/.exec(html) || /vqd='([\d-]+)'/.exec(html) || /vqd="([\d-]+)"/.exec(html);
  if (!m) throw new Error("DDG vqd token not found");

  // Step 2: the JSON image results.
  const imgRes = await fetch(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${m[1]}`,
    { headers: { "User-Agent": UA, Referer: "https://duckduckgo.com/" } },
  );
  if (!imgRes.ok) throw new Error(`DDG images ${imgRes.status}`);
  const data = await imgRes.json();
  const results: Array<{ image?: string; thumbnail?: string; url?: string }> = data.results || [];

  return results
    .filter((r) => r.image)
    .slice(0, 24)
    .map((r) => {
      let source = "web";
      try { source = new URL(r.url || r.image!).hostname.replace(/^www\./, ""); } catch { /* keep default */ }
      return { url: r.image!, thumb: r.thumbnail || r.image!, page: r.url || "", source };
    });
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 120);
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400, headers: CORS });
  }

  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ photos: hit.photos, count: hit.photos.length, cached: true }, { headers: CORS });
  }

  try {
    const photos = await ddgImageSearch(q);
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(q, { at: Date.now(), photos });
    return NextResponse.json({ photos, count: photos.length }, { headers: CORS });
  } catch (error) {
    console.error("photo-search error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "photo search failed", photos: [] },
      { status: 502, headers: CORS },
    );
  }
}
