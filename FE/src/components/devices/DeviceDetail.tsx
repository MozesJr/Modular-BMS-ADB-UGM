// FE/src/components/devices/DeviceDetail.tsx
"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { api, ApiError } from "@/lib/api";
import { BmsUpdatePayload, Device, Pack } from "@/types/device";
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

// Window kecil khusus buat sparkline per-cell — dipisah dari rentang chart utama
// (yang dipilih user via tab di DeviceHistoryCharts) biar sparkline tetap "tren terkini".
const SPARKLINE_WINDOW_HOURS = 6;

// Terapkan update MQTT real-time (via WS) ke state device yang sudah dimuat lewat REST.
// Pack/cell di-upsert by index (bukan by db id, karena payload WS gak bawa db id).
function applyRealtimeUpdate(prev: Device, update: BmsUpdatePayload): Device {
  const packsByIndex = new Map(prev.packs.map((p) => [p.index, p]));

  for (const incomingPack of update.packs) {
    const existingPack = packsByIndex.get(incomingPack.index);
    const cellsByIndex = new Map((existingPack?.cells ?? []).map((c) => [c.index, c]));

    for (const incomingCell of incomingPack.cells) {
      const existingCell = cellsByIndex.get(incomingCell.index);
      cellsByIndex.set(incomingCell.index, {
        id: existingCell?.id ?? `local-cell-${incomingPack.index}-${incomingCell.index}`,
        index: incomingCell.index,
        voltage: incomingCell.voltage,
        updatedAt: new Date().toISOString(),
      });
    }

    const mergedPack: Pack = {
      id: existingPack?.id ?? `local-pack-${incomingPack.index}`,
      index: incomingPack.index,
      temperature: incomingPack.temperature,
      balancerConnected: incomingPack.balancerConnected,
      cells: Array.from(cellsByIndex.values()).sort((a, b) => a.index - b.index),
      updatedAt: new Date().toISOString(),
    };
    packsByIndex.set(incomingPack.index, mergedPack);
  }

  return {
    ...prev,
    packs: Array.from(packsByIndex.values()).sort((a, b) => a.index - b.index),
  };
}

const LIVE_THRESHOLD_MS = 30_000;

export default function DeviceDetail({ deviceId }: { deviceId: string }) {
  const { data: session } = useSession();
  const [device, setDevice] = useState<Device | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { history: sparklineHistory } = useDeviceHistory(deviceId, SPARKLINE_WINDOW_HOURS);

  const { isOpen, openModal, closeModal } = useModal();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  async function loadDevice() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<Device>(`/devices/${deviceId}`);
      setDevice(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat device.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDevice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  useBmsSocket((update) => {
    if (update.id !== deviceId) return; // broadcast global, filter punya device ini aja
    setDevice((prev) => (prev ? applyRealtimeUpdate(prev, update) : prev));
    setLastUpdateAt(new Date());
  });

  // Status live/offline dihitung dari selisih waktu, jadi perlu re-render berkala
  // walau tidak ada pesan WS baru (mis. saat koneksi putus).
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sebelum ada pesan WS pertama, pakai updatedAt pack dari REST (data DB asli) sebagai baseline.
  const initialLastUpdateAt =
    device && device.packs.length > 0
      ? new Date(Math.max(...device.packs.map((p) => new Date(p.updatedAt).getTime())))
      : null;
  const effectiveLastUpdateAt = lastUpdateAt ?? initialLastUpdateAt;
  const isLive = effectiveLastUpdateAt != null && now - effectiveLastUpdateAt.getTime() < LIVE_THRESHOLD_MS;

  const isOwner = device?.ownerId === session?.user?.id;

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
      alertSuccess(
        "Kolaborator ditambahkan",
        `${inviteEmail.trim()} kini punya akses ke device ini.`,
      );
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Gagal menambahkan kolaborator.";
      setInviteError(message);
      alertError("Gagal menambahkan kolaborator", message);
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
      alertSuccess(
        "Kolaborator dihapus",
        `"${userLabel}" telah dihapus dari device ini.`,
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Gagal menghapus kolaborator.",
      );
      alertError(
        "Gagal menghapus kolaborator",
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setRemovingUserId(null);
    }
  }

  if (isLoading) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">Memuat...</p>
    );
  }

  if (error || !device) {
    return (
      <div className="rounded-lg bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10 dark:text-error-400">
        {error ?? "Device tidak ditemukan."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {device.name || device.serialNumber}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">
              {device.serialNumber}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Owner:{" "}
              {device.owner
                ? device.owner.name || device.owner.email
                : "— (belum diklaim)"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {effectiveLastUpdateAt && (
              <Badge
                color={isLive ? "success" : "error"}
                startIcon={
                  <span className="relative flex h-2 w-2">
                    {isLive && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-400 opacity-75" />
                    )}
                    <span
                      className={`relative inline-flex h-2 w-2 rounded-full ${
                        isLive ? "bg-success-500" : "bg-error-500"
                      }`}
                    />
                  </span>
                }
              >
                {isLive ? "Live" : "Offline"} · {effectiveLastUpdateAt.toLocaleTimeString("id-ID")}
              </Badge>
            )}
            {device.verified ? (
              <Badge color="success">Verified</Badge>
            ) : (
              <Badge color="warning">Pending Verifikasi</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Packs & Cells */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <h4 className="mb-4 font-medium text-gray-800 dark:text-white/90">
          Pack &amp; Cell ({device.packs.length} pack)
        </h4>

        {device.packs.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Belum ada data pack. Data akan muncul otomatis setelah device
            mengirim data via MQTT.
          </p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {device.packs.map((pack) => (
              <div
                key={pack.index}
                className={device.packs.length === 1 ? "xl:col-span-2" : undefined}
              >
                <PackCard
                  pack={pack}
                  history={sparklineHistory?.packs.find((p) => p.index === pack.index) ?? null}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History */}
      <DeviceHistoryCharts deviceId={deviceId} />

      {/* Collaborators */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-medium text-gray-800 dark:text-white/90">
            Kolaborator ({device.collaborators.length})
          </h4>
          {isOwner && (
            <Button size="sm" onClick={openModal}>
              + Undang
            </Button>
          )}
        </div>

        {device.collaborators.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Belum ada kolaborator.{" "}
            {isOwner && "Undang anggota tim untuk berbagi akses device ini."}
          </p>
        ) : (
          <div className="space-y-2">
            {device.collaborators.map((collab) => (
              <div
                key={collab.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {collab.user.name || collab.user.email}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {collab.user.email}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge color={collab.role === "editor" ? "info" : "light"}>
                    {collab.role}
                  </Badge>
                  {isOwner && (
                    <button
                      onClick={() =>
                        handleRemoveCollaborator(
                          collab.user.id,
                          collab.user.name || collab.user.email,
                        )
                      }
                      disabled={removingUserId === collab.user.id}
                      className="text-xs text-error-600 hover:text-error-700 dark:text-error-400"
                    >
                      {removingUserId === collab.user.id
                        ? "Menghapus..."
                        : "Hapus"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal undang kolaborator */}
      <Modal isOpen={isOpen} onClose={closeModal} className="max-w-[500px] m-4">
        <div className="p-6">
          <h4 className="mb-1 text-xl font-semibold text-gray-800 dark:text-white/90">
            Undang Kolaborator
          </h4>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
            Masukkan email user yang sudah terdaftar di sistem.
          </p>

          <form onSubmit={handleInvite} className="space-y-5">
            {inviteError && (
              <div className="rounded-lg bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10 dark:text-error-400">
                {inviteError}
              </div>
            )}
            <div>
              <Label>
                Email <span className="text-error-500">*</span>
              </Label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div>
              <Label>Role</Label>
              <select
                value={inviteRole}
                onChange={(e) =>
                  setInviteRole(e.target.value as "viewer" | "editor")
                }
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90"
              >
                <option value="viewer">Viewer (lihat data saja)</option>
                <option value="editor">Editor (bisa kelola device)</option>
              </select>
            </div>
            <div className="flex items-center gap-3 justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={closeModal}
                type="button"
              >
                Batal
              </Button>
              <Button size="sm" disabled={isInviting}>
                {isInviting ? "Mengundang..." : "Undang"}
              </Button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}
