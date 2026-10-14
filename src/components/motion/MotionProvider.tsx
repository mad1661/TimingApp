"use client";

import { LazyMotion, MotionConfig } from "motion/react";
import { useSyncExternalStore, type ReactNode } from "react";

let featuresLoaded = false;
const listeners = new Set<() => void>();

// If the chunk never arrives (offline at the track), components stay static
// instead of throwing; useMotionFeaturesLoaded() keeps them visible.
const loadFeatures = () =>
  import("./features")
    .then((mod) => {
      featuresLoaded = true;
      listeners.forEach((notify) => notify());
      return mod.default;
    })
    .catch(() => new Promise<never>(() => {}));

/**
 * Until the animation features load, `m` components sit at their `initial`
 * values; anything whose initial state is hidden should skip it (initial={false})
 * while this is false.
 */
export function useMotionFeaturesLoaded(): boolean {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => featuresLoaded,
    () => false,
  );
}

/**
 * Animation features load after first paint (components render with `m`, not
 * `motion`), and every animation honours the OS "reduce motion" setting:
 * transforms and layout animations are skipped, opacity fades remain.
 */
export default function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
