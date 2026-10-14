"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** Every motion component honours the OS "reduce motion" setting: transforms and
 *  layout animations are skipped, opacity fades remain. */
export default function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
