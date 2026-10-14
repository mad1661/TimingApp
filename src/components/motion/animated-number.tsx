"use client";

// Adapted from Motion-Primitives `components/core/animated-number.tsx`
// (MIT, see ./LICENSE). Changes: the motion element is created once per `as`
// instead of on every render, and with "reduce motion" on the value jumps
// straight to its target (useSpring ignores MotionConfig).
import { cn } from "@/lib/cn";
import { motion, type SpringOptions, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useMemo } from "react";

export type AnimatedNumberProps = {
  value: number;
  className?: string;
  springOptions?: SpringOptions;
  as?: React.ElementType;
};

export function AnimatedNumber({ value, className, springOptions, as = "span" }: AnimatedNumberProps) {
  const MotionComponent = useMemo(() => motion.create(as as keyof JSX.IntrinsicElements), [as]);
  const reduceMotion = useReducedMotion();

  const spring = useSpring(value, springOptions);
  const display = useTransform(spring, (current) => Math.round(current).toLocaleString());

  useEffect(() => {
    if (reduceMotion) spring.jump(value);
    else spring.set(value);
  }, [spring, value, reduceMotion]);

  return <MotionComponent className={cn("tabular-nums", className)}>{display}</MotionComponent>;
}
