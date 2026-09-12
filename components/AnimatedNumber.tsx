"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect } from "react";

/** A number that eases to its new value rather than snapping to it. */
export function AnimatedNumber({
  value,
  decimals = 0,
  suffix = "",
}: {
  value: number;
  decimals?: number;
  suffix?: string;
}) {
  const reduce = useReducedMotion();
  const motionValue = useMotionValue(value);
  const text = useTransform(motionValue, (v) => v.toFixed(decimals) + suffix);

  useEffect(() => {
    if (reduce) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, { duration: 0.8, ease: [0.25, 1, 0.5, 1] });
    return () => controls.stop();
  }, [value, motionValue, reduce]);

  return <motion.span className="tnum">{text}</motion.span>;
}
