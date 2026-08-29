import PointsBoard from "../PointsBoard";

// Rendered per request, never cached. A points board has to show the current
// standings, and a long-lived CDN entry for a shared link is exactly what went
// wrong the first time this shipped: a 404 cached before the route existed was
// then served for a year under s-maxage.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ShareTeamPointsPage() {
  return <PointsBoard />;
}
