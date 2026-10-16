"use client";
import { useEffect, useRef } from "react";

export function Ambient() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const move = (event: PointerEvent) => {
      if (motion.matches || event.pointerType !== "mouse") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        ref.current?.style.setProperty("--cursor-x", `${event.clientX}px`);
        ref.current?.style.setProperty("--cursor-y", `${event.clientY}px`);
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div ref={ref} className="ambient" aria-hidden="true">
      <div className="ambient-mesh" />
      <div className="ambient-cursor" />
    </div>
  );
}

export function AnimatedValue({ value }: { value: string | number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    if (
      typeof value !== "number" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 200);
      if (ref.current)
        ref.current.textContent = Math.round(
          value * (1 - (1 - progress) ** 3),
        ).toLocaleString("ro-RO");
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <span aria-label={String(value)}>
      <span ref={ref} aria-hidden="true">
        {value}
      </span>
    </span>
  );
}
