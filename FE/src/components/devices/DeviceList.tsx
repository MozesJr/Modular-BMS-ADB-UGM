"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Device } from "@/types/device";
import Button from "@/components/ui/button/Button";
import Badge from "@/components/ui/badge/Badge";
import { useModal } from "@/hooks/useModal";
import { Modal } from "@/components/ui/modal";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { alertSuccess, alertError } from "@/lib/alerts";

export default function DeviceList() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { isOpen, openModal, closeModal } = useModal();
  const [newId, setNewId] = useState("");
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
      setError(
        err instanceof ApiError ? err.message : "Gagal memuat data device.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDevices();
  }, []);

  async function handleAddDevice(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!newId.trim()) {
      setFormError("Device ID / lisensi wajib diisi.");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post("/devices", {
        id: newId.trim(),
        name: newName.trim() || undefined,
      });
      setNewId("");
      setNewName("");
      closeModal();
      await loadDevices();
      alertSuccess(
        "Device ditambahkan",
        `Device "${newId.trim()}" menunggu verifikasi admin.`,
      );
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Gagal menambahkan device.";
      setFormError(message);
      alertError("Gagal menambahkan device", message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            My Devices
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Device BMS yang kamu miliki atau kelola bersama tim.
          </p>
        </div>
        <Button size="sm" onClick={openModal}>
          + Tambah Device
        </Button>
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
            Belum ada device terdaftar. Klik &quot;Tambah Device&quot; untuk
            mulai.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {devices.map((device) => (
          <Link
            key={device.id}
            href={`/devices/${device.id}`}
            className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 hover:border-brand-500 dark:hover:border-brand-500 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <h4 className="font-medium text-gray-800 dark:text-white/90">
                {device.name || device.id}
              </h4>
              {device.verified ? (
                <Badge color="success">Verified</Badge>
              ) : (
                <Badge color="warning">Pending</Badge>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mb-3">
              {device.id}
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span>{device.packs.length} pack</span>
              <span>{device.collaborators.length} kolaborator</span>
            </div>
          </Link>
        ))}
      </div>

      <Modal isOpen={isOpen} onClose={closeModal} className="max-w-[500px] m-4">
        <div className="p-6">
          <h4 className="mb-1 text-xl font-semibold text-gray-800 dark:text-white/90">
            Tambah Device Baru
          </h4>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
            Masukkan Device ID sesuai yang tertera pada unit BMS fisik. Device
            akan berstatus <span className="font-medium">Pending</span> sampai
            diverifikasi admin.
          </p>

          <form onSubmit={handleAddDevice} className="space-y-5">
            {formError && (
              <div className="rounded-lg bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10 dark:text-error-400">
                {formError}
              </div>
            )}
            <div>
              <Label>
                Device ID / Lisensi <span className="text-error-500">*</span>
              </Label>
              <Input
                type="text"
                placeholder="mis. esp32-bms-001"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
              />
            </div>
            <div>
              <Label>Nama Device (opsional)</Label>
              <Input
                type="text"
                placeholder="mis. BMS Rumah - Lantai 1"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
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
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? "Menambahkan..." : "Tambah Device"}
              </Button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}
