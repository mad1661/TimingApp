import QueryBoard from "../QueryBoard";

// Kept as an alias of /share/team-points so links already handed out keep
// working. Dynamic for the same reason: this board must never be served from a
// stale cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SharePointsPage() {
  return <QueryBoard />;
}
