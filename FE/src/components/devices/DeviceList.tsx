"use client";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Device } from "@/types/device";
import Button from "@/components/ui/button/Button";
import { useModal } from "@/hooks/useModal";
import { Modal } from "@/components/ui/modal";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { alertSuccess, alertError } from "@/lib/alerts";
import { useBmsSocket } from "@/hooks/useBmsSocket";
import { applyRealtimeUpdate } from "@/lib/realtimeMerge";
import DeviceCard, { deviceSummary } from "@/components/devices/DeviceCard";
import type { Freshness } from "@/lib/freshness";
import { CardGridSkeleton } from "@/components/common/Skeleton";
import ErrorState from "@/components/common/ErrorState";

type StatusFilter = "all" | Freshness;
type VerifyFilter = "all" | "verified" | "pending";
type SortKey = "health" | "lastSeen" | "name";

export default function DeviceList() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [verifyFilter, setVerifyFilter] = useState<VerifyFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("health");

  const { isOpen, openModal, closeModal } = useModal();
  const [newSerialNumber, setNewSerialNumber] = useState("");
  const [newName, setNewName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadDevices() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<Device[]>("/devices");
      setDevices(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat data device.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDevices();
  }, []);

  useBmsSocket((update) => {
    setDevices((prev) => prev.map((d) => (d.id === update.id ? applyRealtimeUpdate(d, update) : d)));
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  async function handleAddDevice(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const serial = newSerialNumber.trim();
    const name = newName.trim();

    if (!serial) {
      setFormError("Device ID / Serial Number wajib diisi.");
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{3,}$/.test(serial)) {
      setFormError("Device ID minimal 4 karakter, diawali huruf/angka, hanya boleh huruf, angka, titik, strip, atau garis bawah.");
      return;
    }
    if (name && name.length < 3) {
      setFormError("Nama label minimal 3 karakter (atau kosongkan).");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post("/devices", { serialNumber: serial, name: name || undefined });
      setNewSerialNumber("");
      setNewName("");
      closeModal();
      await loadDevices();
      alertSuccess("Device ditambahkan", `Device "${serial}" berhasil didaftarkan.`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Gagal menambahkan device.";
      setFormError(message);
      alertError("Gagal", message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const withSummary = devices.map((d) => ({ d, s: deviceSummary(d, now) }));
    const result = withSummary.filter(({ d, s }) => {
      if (q && !(d.name?.toLowerCase().includes(q) || d.serialNumber.toLowerCase().includes(q))) return false;
      if (statusFilter !== "all" && s.freshness.status !== statusFilter) return false;
      if (verifyFilter === "verified" && !d.verified) return false;
      if (verifyFilter === "pending" && d.verified) return false;
      return true;
    });
    result.sort((a, b) => {
      if (sortKey === "health") return a.s.health.score - b.s.health.score; // terburuk dulu
      if (sortKey === "lastSeen") return b.s.freshness.ageMs === a.s.freshness.ageMs ? 0 : a.s.freshness.ageMs - b.s.freshness.ageMs; // terbaru dulu
      return (a.d.name || a.d.serialNumber).localeCompare(b.d.name || b.d.serialNumber);
    });
    return result.map((x) => x.d);
  }, [devices, search, statusFilter, verifyFilter, sortKey, now]);

  const selectCls = "h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">My BMS Devices</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Kelola unit manajemen baterai yang terhubung.</p>
        </div>
        <Button size="sm" onClick={openModal}>+ Tambah Device</Button>
      </div>

      {/* Controls */}
      {!isLoading && !error && devices.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama / ID…"
            aria-label="Cari device"
            className="h-9 flex-1 min-w-[160px] rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <select aria-label="Filter status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className={selectCls}>
            <option value="all">Semua status</option>
            <option value="live">Live</option>
            <option value="stale">Stale</option>
            <option value="offline">Offline</option>
          </select>
          <select aria-label="Filter verifikasi" value={verifyFilter} onChange={(e) => setVerifyFilter(e.target.value as VerifyFilter)} className={selectCls}>
            <option value="all">Semua verifikasi</option>
            <option value="verified">Verified</option>
            <option value="pending">Pending</option>
          </select>
          <select aria-label="Urutkan" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className={selectCls}>
            <option value="health">Sort: Health (terburuk dulu)</option>
            <option value="lastSeen">Sort: Last seen</option>
            <option value="name">Sort: Nama</option>
          </select>
        </div>
      )}

      {isLoading && <CardGridSkeleton count={6} />}
      {error && !isLoading && <ErrorState message={error} onRetry={loadDevices} className="mb-4" />}

      {!isLoading && !error && devices.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 px-6 py-14 text-center bg-gray-50/50 dark:bg-white/[0.02]">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Belum ada device BMS terdaftar.</p>
          <p className="text-xs text-gray-400 mt-1">Klik &quot;Tambah Device&quot; untuk menghubungkan unit.</p>
          <Button size="sm" onClick={openModal} className="mt-4">+ Tambah Device</Button>
        </div>
      )}

      {!isLoading && !error && devices.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-gray-500 py-10 text-center">Tidak ada device yang cocok dengan filter.</p>
      )}

      {filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((device) => (
            <DeviceCard key={device.id} device={device} variant="detailed" nowMs={now} />
          ))}
        </div>
      )}

      <Modal isOpen={isOpen} onClose={closeModal} className="max-w-[500px] m-4">
        <div className="p-6">
          <h4 className="mb-1 text-xl font-semibold text-gray-800 dark:text-white/90">Registrasi Device Baru</h4>
          <p className="mb-6 text-sm text-gray-500">Masukkan Serial Number sesuai fisik modul BMS.</p>
          <form onSubmit={handleAddDevice} className="space-y-4">
            {formError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{formError}</div>}
            <div>
              <Label>Device Serial Number <span className="text-red-500">*</span></Label>
              <Input type="text" placeholder="mis. GAMA-BMS-002" value={newSerialNumber} onChange={(e) => setNewSerialNumber(e.target.value)} />
            </div>
            <div>
              <Label>Nama Label (Opsional)</Label>
              <Input type="text" placeholder="mis. Powerbank Server Utama" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="flex items-center gap-3 justify-end pt-2">
              <Button size="sm" variant="outline" onClick={closeModal} type="button">Batal</Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>{isSubmitting ? "Menambahkan..." : "Daftarkan Device"}</Button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}
