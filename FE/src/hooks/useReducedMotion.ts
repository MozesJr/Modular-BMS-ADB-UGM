"use client";
import { useEffect, useState } from "react";

// True bila user meminta prefers-reduced-motion: reduce. Dipakai untuk mematikan animasi JS
// (partikel, dsb.) — animasi CSS sudah dijaga via media query di globals.css.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}
