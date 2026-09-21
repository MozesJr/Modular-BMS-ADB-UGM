"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

// Mengambil resource GET dari backend (lewat proxy /api/backend) dan menyegarkannya berkala.
// Browser memakai ETag/If-None-Match otomatis (backend mengirim Cache-Control: private, no-cache), jadi polling murah.
// Data lama tetap ditampilkan saat refresh gagal (error hanya menandai bahwa data mungkin usang).
export function useApiResource<T>(path: string, intervalMs = 30_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await api.get<T>(path);
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Gagal memuat data.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    const timer = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [path, intervalMs]);

  return { data, error, isLoading };
}
