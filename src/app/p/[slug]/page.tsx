import PointsBoard from "../../share/PointsBoard";

// Short shareable form: /p/ET11-2026, /p/ET11-2026-jr, /p/ET11-2026-big.
// Rendered per request so the board is never served from a stale cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ShortPointsPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { refresh?: string; title?: string };
}) {
  // CODE-SEASON with an optional board suffix. The event code itself can
  // contain dashes, so read the season and the suffix from the end.
  const parts = (params.slug || "").split("-");
  let view: "combined" | "big" | "jr" = "combined";
  const last = (parts[parts.length - 1] || "").toLowerCase();
  if (last === "jr" || last === "big") {
    view = last;
    parts.pop();
  }
  const season = parts.pop() || "";
  const eventCode = parts.join("-");

  return (
    <PointsBoard
      eventCode={eventCode}
      season={season}
      view={view}
      title={searchParams.title || ""}
      refreshSeconds={Number(searchParams.refresh) || undefined}
    />
  );
}
