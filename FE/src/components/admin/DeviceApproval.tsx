// FE/src/components/admin/DeviceApproval.tsx
"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import Badge from "@/components/ui/badge/Badge";

type AdminDevice = {
  id: string;
  name: string | null;
  verified: boolean;
  createdAt: string;
  owner: { id: string; name: string | null; email: string };
};

export default function DeviceApproval() {
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [filter, setFilter] = useState<"pending" | "verified" | "all">(
    "pending",
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  async function loadDevices() {
    setIsLoading(true);
    setError(null);
    try {
      const query =
        filter === "pending"
          ? "?verified=false"
          : filter === "verified"
            ? "?verified=true"
            : "";
      const data = await api.get<AdminDevice[]>(`/admin/devices${query}`);
      setDevices(data);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Gagal memuat data device.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function handleApprove(id: string) {
    setActingId(id);
    try {
      await api.patch(`/admin/devices/${id}/verify`, { verified: true });
      await loadDevices();
      alertSuccess("Device disetujui", `Device "${id}" kini terverifikasi.`);
    } catch (err) {
      alertError(
        "Gagal approve device",
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setActingId(null);
    }
  }

  async function handleReject(id: string) {
    const confirmed = await alertConfirm({
      title: "Tolak device ini?",
      text: `Device "${id}" akan dihapus permanen.`,
      confirmText: "Ya, tolak",
      danger: true,
    });
    if (!confirmed) return;

    setActingId(id);
    try {
      await api.delete(`/admin/devices/${id}`);
      await loadDevices();
      alertSuccess("Device ditolak", `Device "${id}" telah dihapus.`);
    } catch (err) {
      alertError(
        "Gagal menolak device",
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setActingId(null);
    }
  }

  async function handleUnverify(id: string) {
    const confirmed = await alertConfirm({
      title: "Cabut verifikasi device ini?",
      text: `Device "${id}" akan kembali berstatus pending.`,
      confirmText: "Ya, cabut",
      danger: true,
    });
    if (!confirmed) return;

    setActingId(id);
    try {
      await api.patch(`/admin/devices/${id}/verify`, { verified: false });
      await loadDevices();
      alertSuccess(
        "Verifikasi dicabut",
        `Device "${id}" kini berstatus pending.`,
      );
    } catch (err) {
      alertError(
        "Gagal mencabut verifikasi",
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Verifikasi Device
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Approve device baru yang didaftarkan user sebelum bisa menerima data
            MQTT.
          </p>
        </div>
        <div className="flex gap-2">
          {(["pending", "verified", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                filter === f
                  ? "bg-brand-500 text-white"
                  : "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-400"
              }`}
            >
              {f === "pending"
                ? "Pending"
                : f === "verified"
                  ? "Verified"
                  : "Semua"}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-gray-500 dark:text-gray-400">Memuat...</p>
      )}
      {error && (
        <div className="rounded-lg bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </div>
      )}

      {!isLoading && !error && devices.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-10 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Tidak ada device pada filter ini.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {devices.map((device) => (
          <div
            key={device.id}
            className="flex items-center justify-between flex-wrap gap-3 rounded-xl border border-gray-200 dark:border-gray-800 p-4"
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-gray-800 dark:text-white/90">
                  {device.name || device.id}
                </span>
                {device.verified ? (
                  <Badge color="success">Verified</Badge>
                ) : (
                  <Badge color="warning">Pending</Badge>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                {device.id}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Owner: {device.owner.name || device.owner.email}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {!device.verified ? (
                <>
                  <button
                    onClick={() => handleApprove(device.id)}
                    disabled={actingId === device.id}
                    className="px-3 py-1.5 rounded-lg bg-success-500 text-white text-xs font-medium hover:bg-success-600 disabled:opacity-60"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(device.id)}
                    disabled={actingId === device.id}
                    className="px-3 py-1.5 rounded-lg bg-error-500 text-white text-xs font-medium hover:bg-error-600 disabled:opacity-60"
                  >
                    Tolak
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleUnverify(device.id)}
                  disabled={actingId === device.id}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-400 disabled:opacity-60"
                >
                  Cabut Verifikasi
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
