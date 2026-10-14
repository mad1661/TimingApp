"use client";

// Adapted from Motion-Primitives `components/core/animated-number.tsx`
// (MIT, see ./LICENSE). Changes: rendered with `m` (see MotionProvider), the
// motion element is created once per `as` instead of on every render, the
// default spring is overdamped so a count never overshoots its real value, and
// with "reduce motion" on the value jumps straight to its target (useSpring
// ignores MotionConfig).
import { cn } from "@/lib/cn";
import { type SpringOptions, useReducedMotion, useSpring, useTransform } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useMemo } from "react";

export type AnimatedNumberProps = {
  value: number;
  className?: string;
  springOptions?: SpringOptions;
  as?: React.ElementType;
};

const DEFAULT_SPRING: SpringOptions = { stiffness: 260, damping: 38, mass: 1 };

export function AnimatedNumber({ value, className, springOptions = DEFAULT_SPRING, as = "span" }: AnimatedNumberProps) {
  const MotionComponent = useMemo(() => m.create(as as keyof JSX.IntrinsicElements), [as]);
  const reduceMotion = useReducedMotion();

  const spring = useSpring(value, springOptions);
  const display = useTransform(spring, (current) => Math.round(current).toLocaleString());

  useEffect(() => {
    if (reduceMotion) spring.jump(value);
    else spring.set(value);
  }, [spring, value, reduceMotion]);

  return <MotionComponent className={cn("tabular-nums", className)}>{display}</MotionComponent>;
}
