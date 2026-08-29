"use client";

import { Suspense } from "react";
import { PointsBoardFromQuery } from "./PointsBoard";

/** useSearchParams needs a Suspense boundary above it during prerender. */
export default function QueryBoard() {
  return (
    <Suspense fallback={null}>
      <PointsBoardFromQuery />
    </Suspense>
  );
}
