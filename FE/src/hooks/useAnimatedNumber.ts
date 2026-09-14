"use client";
import { useEffect, useRef, useState } from "react";

const DURATION_MS = 500;

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

// Count up/down halus dari nilai lama ke nilai baru saat `value` berubah (mis. update dari WS).
export function useAnimatedNumber(value: number | null, durationMs = DURATION_MS) {
  const [displayValue, setDisplayValue] = useState(value);
  const rafRef = useRef<number | null>(null);
  // Selalu mengikuti nilai yang sedang ditampilkan (bukan target lama), supaya update yang
  // datang di tengah animasi lanjut mulus dari posisi sekarang, bukan lompat balik.
  const currentRef = useRef(value);

  useEffect(() => {
    if (value == null) {
      currentRef.current = null;
      setDisplayValue(null);
      return;
    }

    const from = currentRef.current ?? value;
    if (from === value) {
      currentRef.current = value;
      setDisplayValue(value);
      return;
    }

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const startTime = performance.now();

    function tick(now: number) {
      const progress = Math.min((now - startTime) / durationMs, 1);
      const eased = easeOutCubic(progress);
      const next = from + (value! - from) * eased;
      currentRef.current = next;
      setDisplayValue(next);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return displayValue;
}
