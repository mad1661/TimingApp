import { NextRequest, NextResponse } from "next/server";

/**
 * Public-host gating.
 *
 * The points board is meant to be shared, the rest of the app is not. When a
 * hostname is listed in PUBLIC_POINTS_HOSTS, this app serves only the points
 * board on that hostname and answers everything else with a 404 — so a
 * shareable link can live on its own domain without that domain becoming a way
 * into the working pages, the uploads, or the write APIs.
 *
 * With the variable unset (the default) nothing is gated and every host serves
 * the whole app exactly as before.
 */
const PUBLIC_PREFIXES = [
  "/p/", // short share links: /p/ET11-2026
  "/share/", // /share/team-points, /share/points
];

/** Read-only endpoints the board itself needs. */
const PUBLIC_APIS = ["/api/et-finals"];

/** Framework and asset paths that must keep working for the board to render. */
const ALWAYS_ALLOWED = ["/_next/", "/favicon", "/icon", "/apple-icon", "/robots.txt"];

function publicHosts(): string[] {
  return (process.env.PUBLIC_POINTS_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function middleware(request: NextRequest) {
  const hosts = publicHosts();
  if (hosts.length === 0) return NextResponse.next();

  // Behind a proxy (Firebase Hosting rewriting to this service) the original
  // domain arrives in x-forwarded-host, so check both.
  const candidates = [
    request.headers.get("x-forwarded-host") || "",
    request.headers.get("host") || "",
  ]
    .flatMap((h) => h.split(","))
    .map((h) => h.trim().toLowerCase().split(":")[0])
    .filter(Boolean);
  if (!candidates.some((h) => hosts.includes(h))) return NextResponse.next();

  const path = request.nextUrl.pathname;
  const allowed =
    ALWAYS_ALLOWED.some((p) => path.startsWith(p)) ||
    PUBLIC_PREFIXES.some((p) => path.startsWith(p)) ||
    // The board's own data, read-only and GET only.
    (PUBLIC_APIS.some((p) => path === p || path.startsWith(`${p}?`)) && request.method === "GET");

  if (allowed) return NextResponse.next();

  // Nothing else exists as far as this hostname is concerned.
  return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export const config = {
  // Every path except Next's internal asset pipeline, which middleware doesn't
  // need to see.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
