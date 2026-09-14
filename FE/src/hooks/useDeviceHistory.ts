"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { DeviceHistory } from "@/types/device";

export function useDeviceHistory(deviceId: string, hours: number) {
  const [history, setHistory] = useState<DeviceHistory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await api.get<DeviceHistory>(
          `/devices/${deviceId}/history?hours=${hours}`,
        );
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
  }, [deviceId, hours]);

  return { history, isLoading, error };
}
