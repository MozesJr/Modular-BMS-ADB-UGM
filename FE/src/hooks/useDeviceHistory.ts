"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { DeviceHistory } from "@/types/device";

type Options = {
  cells?: boolean; // sertakan rata-rata voltage per cell per bucket (?cells=1)
  bucket?: string | number; // "auto" (default) atau lebar bucket dalam detik
};

export function useDeviceHistory(deviceId: string, hours: number, options?: Options) {
  const { cells = false, bucket = "auto" } = options ?? {};
  const [history, setHistory] = useState<DeviceHistory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ hours: String(hours), bucket: String(bucket) });
        if (cells) params.set("cells", "1");
        const data = await api.get<DeviceHistory>(`/devices/${deviceId}/history?${params.toString()}`);
        if (!cancelled) setHistory(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Gagal memuat riwayat data.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [deviceId, hours, cells, bucket]);

  return { history, isLoading, error };
}
