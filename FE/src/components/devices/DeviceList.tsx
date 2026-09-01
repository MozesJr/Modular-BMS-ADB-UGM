// FE/src/components/devices/DeviceDetail.tsx
"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { api, ApiError } from "@/lib/api";
import { Device } from "@/types/device";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { useModal } from "@/hooks/useModal";
import { Modal } from "@/components/ui/modal";
import { alertSuccess, alertError, alertConfirm } from "@/lib/alerts";

export default function DeviceDetail({ deviceId }: { deviceId: string }) {
  const { data: session } = useSession();
  const [device, setDevice] = useState<Device | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
              {device.name || device.id}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">
              {device.id}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Owner: {device.owner.name || device.owner.email}
            </p>
          </div>
          {device.verified ? (
            <Badge color="success">Verified</Badge>
          ) : (
            <Badge color="warning">Pending Verifikasi</Badge>
          )}
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
          <div className="space-y-4">
            {device.packs.map((pack) => (
              <div
                key={pack.id}
                className="rounded-xl border border-gray-200 dark:border-gray-800 p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium text-gray-800 dark:text-white/90">
                    Pack #{pack.index}
                  </span>
                  <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                    <span>
                      {pack.temperature != null ? `${pack.temperature}°C` : "—"}
                    </span>
                    <Badge color={pack.balancerConnected ? "success" : "error"}>
                      Balancer {pack.balancerConnected ? "OK" : "Off"}
                    </Badge>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {pack.cells.map((cell) => (
                    <div
                      key={cell.id}
                      className="rounded-lg bg-gray-50 dark:bg-white/5 px-3 py-2 text-center"
                    >
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        Cell {cell.index}
                      </p>
                      <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                        {cell.voltage.toFixed(3)}V
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
