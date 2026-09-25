"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { api, ApiError } from "@/lib/api";
import { Device } from "@/types/device";
import { applyRealtimeUpdate } from "@/lib/realtimeMerge";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { useModal } from "@/hooks/useModal";
import { Modal } from "@/components/ui/modal";
import { alertSuccess, alertError, alertConfirm } from "@/lib/alerts";
import { useBmsSocket } from "@/hooks/useBmsSocket";
import { useDeviceHistory } from "@/hooks/useDeviceHistory";
import DeviceHistoryCharts from "@/components/devices/DeviceHistoryCharts";
import PackCard from "@/components/devices/PackCard";
import AvatarText from "@/components/ui/avatar/AvatarText";
import { CopyIcon, CheckLineIcon } from "@/icons";
import { getFreshness } from "@/lib/freshness";
import Heartbeat from "@/components/devices/Heartbeat";
import HealthRing from "@/components/devices/HealthRing";
import AlarmTimeline from "@/components/devices/AlarmTimeline";
import { computeHealthScore } from "@/lib/healthScore";
import { evaluateSnapshot, evaluateHistoryEpisodes } from "@/lib/alertRules";
import Link from "next/link";
import { Skeleton } from "@/components/common/Skeleton";
import ErrorState from "@/components/common/ErrorState";

const ALARM_HISTORY_HOURS = 24;

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="7" cy="18" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <line x1="8.3" y1="10.7" x2="15.7" y2="6.3" />
      <line x1="8.3" y1="13.3" x2="15.7" y2="17.7" />
    </svg>
  );
}

function truncateMiddle(value: string, headLen = 10, tailLen = 6) {
  if (value.length <= headLen + tailLen + 1) return value;
  return `${value.slice(0, headLen)}…${value.slice(-tailLen)}`;
}

const NOMINAL_LIFEPO4_V_PER_CELL = 3.2;

export default function DeviceDetail({ deviceId }: { deviceId: string }) {
  const { data: session } = useSession();
  const [device, setDevice] = useState<Device | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { history: alarmHistory } = useDeviceHistory(deviceId, ALARM_HISTORY_HOURS);

  const { isOpen, openModal, closeModal } = useModal();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedSerial, setCopiedSerial] = useState(false);

  async function loadDevice(options?: { silent?: boolean }) {
    if (!options?.silent) setIsLoading(true);
    setError(null);
    setErrorStatus(null);
    try {
      const data = await api.get<Device>(`/devices/${deviceId}`);
      setDevice(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat device.");
      setErrorStatus(err instanceof ApiError ? err.status : null);
    } finally {
      if (!options?.silent) setIsLoading(false);
    }
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await loadDevice({ silent: true });
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleCopySerial() {
    if (!device) return;
    try {
      await navigator.clipboard.writeText(device.serialNumber);
      setCopiedSerial(true);
      setTimeout(() => setCopiedSerial(false), 1500);
    } catch {}
  }

  useEffect(() => {
    queueMicrotask(() => {
      loadDevice();
    });
  }, [deviceId]);

  useBmsSocket((update) => {
    if (update.id !== deviceId) return;
    setDevice((prev) => (prev ? applyRealtimeUpdate(prev, update) : prev));
    setLastUpdateAt(new Date());
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Prefer Device.lastSeen (waktu server terima paket); fallback ke max(pack.updatedAt).
  const initialLastUpdateAt = device?.lastSeen
    ? new Date(device.lastSeen)
    : device && device.packs.length > 0
      ? new Date(Math.max(...device.packs.map((p) => new Date(p.updatedAt).getTime())))
      : null;
  const effectiveLastUpdateAt = lastUpdateAt ?? initialLastUpdateAt;
  const freshness = getFreshness(effectiveLastUpdateAt?.getTime() ?? null, now);

  // GET /api/devices/[id] tak menjamin urutan packs; urutkan numerik di sini.
  const sortedPacks = device ? [...device.packs].sort((a, b) => a.index - b.index) : [];

  // Snapshot untuk alarm & health (live).
  const packSnaps = sortedPacks.map((p) => ({
    index: p.index,
    temperature: p.temperature,
    cells: p.cells.map((c) => ({ index: c.index, voltage: c.voltage })),
  }));
  const activeAlarms = evaluateSnapshot(packSnaps, freshness.status);
  const health = computeHealthScore(packSnaps, freshness.status);
  const alarmEpisodes = evaluateHistoryEpisodes(
    (alarmHistory?.packs ?? []).map((p) => ({
      index: p.index,
      buckets: p.buckets.map((b) => ({
        t: b.t,
        cellMin: b.cellMin,
        cellMax: b.cellMax,
        deltaMv: b.deltaMv,
        tempAvg: b.tempAvg,
      })),
    })),
  );

  const isOwner = device?.ownerId === session?.user?.id;
  const firstPackCellCount = sortedPacks[0]?.cells.length ?? 0;
  const hasHeterogeneousPacks =
    (device?.packs.length ?? 0) > 1 &&
    device!.packs.some((p) => p.cells.length !== firstPackCellCount);
  const nominalVoltage = firstPackCellCount > 0 ? firstPackCellCount * NOMINAL_LIFEPO4_V_PER_CELL : null;

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    if (!inviteEmail.trim()) {
      setInviteError("Email wajib diisi.");
      return;
    }
    setIsInviting(true);
    try {
      await api.post(`/devices/${deviceId}/collaborators`, {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInviteEmail("");
      setInviteRole("viewer");
      closeModal();
      await loadDevice();
      alertSuccess("Kolaborator ditambahkan", `${inviteEmail.trim()} kini punya akses.`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Gagal menambahkan kolaborator.";
      setInviteError(message);
      alertError("Gagal", message);
    } finally {
      setIsInviting(false);
    }
  }

  async function handleRemoveCollaborator(userId: string, userLabel: string) {
    const confirmed = await alertConfirm({
      title: "Hapus kolaborator ini?",
      text: `"${userLabel}" akan kehilangan akses ke device ini.`,
      confirmText: "Ya, hapus",
      danger: true,
    });
    if (!confirmed) return;

    setRemovingUserId(userId);
    try {
      await api.delete(`/devices/${deviceId}/collaborators?userId=${userId}`);
      await loadDevice();
      alertSuccess("Kolaborator dihapus", `"${userLabel}" telah dihapus.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menghapus.");
      alertError("Gagal", err instanceof ApiError ? err.message : undefined);
    } finally {
      setRemovingUserId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-6 bg-white dark:bg-white/[0.03] space-y-3">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-52" />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  // 404 / 403 — device tidak ditemukan atau tidak punya akses.
  if (errorStatus === 404 || errorStatus === 403 || (!device && !error)) {
    return (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-12 text-center">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Device tidak ditemukan</h3>
        <p className="mt-1 text-sm text-gray-500">Device ini tidak ada atau kamu tidak punya akses.</p>
        <Link href="/devices" className="inline-block mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">
          ← Kembali ke My Devices
        </Link>
      </div>
    );
  }

  if (error || !device) {
    return <ErrorState message={error ?? "Gagal memuat device."} onRetry={() => loadDevice()} />;
  }

  return (
    <div className="space-y-6">
      {/* Header Utama BMS */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6 shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="min-w-0">
            <div className="flex items-center flex-wrap gap-2.5">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {device.name || device.serialNumber}
              </h3>
              {device.verified ? (
                <Badge color="success">Verified System</Badge>
              ) : (
                <Badge color="warning">Pending Verification</Badge>
              )}
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                ID: {device.serialNumber}
              </span>
              <button
                type="button"
                onClick={handleCopySerial}
                title="Salin Serial Number"
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                {copiedSerial ? <CheckLineIcon className="w-4 h-4 text-emerald-500" /> : <CopyIcon className="w-4 h-4" />}
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <AvatarText name={device.owner ? device.owner.name || device.owner.email : "?"} className="shrink-0" />
              <div>
                <span className="text-xs text-gray-400 block">Device Owner</span>
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {device.owner ? device.owner.name || device.owner.email : "— (Belum diklaim)"}
                </span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {effectiveLastUpdateAt ? (
                <Heartbeat status={freshness.status} ageMs={freshness.ageMs} />
              ) : (
                <Badge color="light">Belum ada paket data</Badge>
              )}
              {activeAlarms.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-400">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  {activeAlarms.length} alarm aktif
                </span>
              )}
              {firstPackCellCount > 0 && (
                <Badge color="info">
                  LiFePO4 · {firstPackCellCount}S{hasHeterogeneousPacks ? " (Pack #1)" : ""}
                </Badge>
              )}
              {nominalVoltage != null && (
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Nominal: ~{nominalVoltage.toFixed(1)}V
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {sortedPacks.length > 0 && <HealthRing breakdown={health} />}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh telemetry"
              className="flex items-center justify-center w-10 h-10 text-gray-600 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 transition-all"
            >
              <RefreshIcon className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={openModal}
              title="Undang kolaborator"
              className="flex items-center justify-center w-10 h-10 text-gray-600 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 transition-all"
            >
              <ShareIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bagian Pack & Cell Cards */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h4 className="font-bold text-gray-800 dark:text-white/90 text-base">
            Battery Packs Overview ({device.packs.length} Pack Active)
          </h4>
        </div>

        {sortedPacks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-12 text-center bg-white dark:bg-white/[0.02]">
            <p className="text-sm text-gray-500">Belum ada data pack telemetri yang masuk dari MQTT.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {sortedPacks.map((pack) => (
              <div key={pack.index} className={sortedPacks.length === 1 ? "xl:col-span-2" : undefined}>
                <PackCard pack={pack} freshness={freshness.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alarm & Event Timeline */}
      <AlarmTimeline activeAlarms={activeAlarms} episodes={alarmEpisodes} />

      {/* Grafik Riwayat Telemetri */}
      <DeviceHistoryCharts deviceId={deviceId} />

      {/* Manajemen Kolaborator */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="font-bold text-gray-800 dark:text-white/90">Collaborators Access</h4>
            <p className="text-xs text-gray-500">Akses kontrol pemantauan device bersama tim.</p>
          </div>
          {isOwner && (
            <Button size="sm" onClick={openModal}>
              + Undang Anggota
            </Button>
          )}
        </div>

        {device.collaborators.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">Belum ada kolaborator terdaftar.</p>
        ) : (
          <div className="space-y-3">
            {device.collaborators.map((collab) => (
              <div key={collab.id} className="flex items-center justify-between rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30 px-4 py-3">
                <div className="flex items-center gap-3">
                  <AvatarText name={collab.user.name || collab.user.email} />
                  <div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-white/90">{collab.user.name || collab.user.email}</p>
                    <p className="text-xs text-gray-500">{collab.user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge color={collab.role === "editor" ? "info" : "light"}>{collab.role}</Badge>
                  {isOwner && (
                    <button
                      onClick={() => handleRemoveCollaborator(collab.user.id, collab.user.name || collab.user.email)}
                      disabled={removingUserId === collab.user.id}
                      className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400"
                    >
                      {removingUserId === collab.user.id ? "Menghapus..." : "Hapus"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Kolaborator */}
      <Modal isOpen={isOpen} onClose={closeModal} className="max-w-[500px] m-4">
        <div className="p-6">
          <h4 className="mb-1 text-xl font-semibold text-gray-800 dark:text-white/90">Undang Kolaborator</h4>
          <p className="mb-6 text-sm text-gray-500">Berikan akses monitoring device ke email rekan tim Anda.</p>

          <form onSubmit={handleInvite} className="space-y-4">
            {inviteError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{inviteError}</div>}
            <div>
              <Label>Email Akun <span className="text-red-500">*</span></Label>
              <Input type="email" placeholder="user@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </div>
            <div>
              <Label>Hak Akses (Role)</Label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "viewer" | "editor")}
                className="h-11 w-full rounded-xl border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="viewer" className="dark:bg-gray-900">Viewer (Hanya lihat data)</option>
                <option value="editor" className="dark:bg-gray-900">Editor (Kelola parameter device)</option>
              </select>
            </div>
            <div className="flex items-center gap-3 justify-end pt-2">
              <Button size="sm" variant="outline" onClick={closeModal} type="button">Batal</Button>
              <Button type="submit" size="sm" disabled={isInviting}>{isInviting ? "Mengirim..." : "Kirim Undangan"}</Button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}