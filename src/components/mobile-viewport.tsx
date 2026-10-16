"use client";
import { useEffect } from "react";

/** Keep the mobile conversation composer inside Safari's visible keyboard area. */
export function MobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const update = () => {
      if (viewport.scale !== 1) {
        root.style.removeProperty("--app-visual-height");
        root.style.removeProperty("--app-visual-top");
        delete root.dataset.keyboard;
        return;
      }
      root.style.setProperty("--app-visual-height", `${viewport.height}px`);
      root.style.setProperty("--app-visual-top", `${viewport.offsetTop}px`);
      root.dataset.keyboard =
        window.innerHeight - viewport.height > 150 ? "open" : "closed";
    };
    update();
    viewport.addEventListener("resize", update, { passive: true });
    viewport.addEventListener("scroll", update, { passive: true });
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--app-visual-height");
      root.style.removeProperty("--app-visual-top");
      delete root.dataset.keyboard;
    };
  }, []);
  return null;
}
