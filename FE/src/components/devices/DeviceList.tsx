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
import { GroupIcon, BoxIconLine } from "@/icons";
import BatteryIcon from "@/components/devices/BatteryIcon";

export default function DeviceList() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    queueMicrotask(() => {
      loadDevices();
    });
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
    // Format ID: huruf/angka di awal, lalu huruf/angka/-/_ ; minimal 4 karakter.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{3,}$/.test(serial)) {
      setFormError(
        "Device ID minimal 4 karakter, diawali huruf/angka, hanya boleh huruf, angka, titik, strip, atau garis bawah.",
      );
      return;
    }
    // Keunikan dicek final oleh backend (respons 409); ini hanya validasi bentuk.
    if (name && name.length < 3) {
      setFormError("Nama label minimal 3 karakter (atau kosongkan).");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post("/devices", {
        serialNumber: serial,
        name: name || undefined,
      });
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

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">My BMS Devices</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Kelola unit manajemen baterai yang terhubung dalam sistem.</p>
        </div>
        <Button size="sm" onClick={openModal}>+ Tambah Device</Button>
      </div>

      {isLoading && <p className="text-sm text-gray-500 py-8 text-center">Memuat daftar device...</p>}
      {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600 mb-4">{error}</div>}

      {!isLoading && !error && devices.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 px-6 py-12 text-center bg-gray-50/50 dark:bg-white/[0.02]">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Belum ada device BMS terdaftar.</p>
          <p className="text-xs text-gray-400 mt-1">Klik tombol &quot;Tambah Device&quot; untuk menghubungkan unit.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {devices.map((device) => {
          const status = device.verified ? "verified" : "pending";
          return (
            <Link
              key={device.id}
              href={`/devices/${device.id}`}
              className="rounded-2xl border border-gray-200 dark:border-gray-800 p-5 bg-white dark:bg-gray-900/40 transition-all duration-200 hover:border-brand-500 hover:shadow-md group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800 group-hover:bg-brand-50 dark:group-hover:bg-brand-500/10 transition-colors">
                    <BatteryIcon status={status} size={26} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-gray-900 dark:text-white/90 truncate text-base">
                      {device.name || device.serialNumber}
                    </h4>
                    <p className="text-xs text-gray-500 font-mono truncate mt-0.5">
                      {device.serialNumber}
                    </p>
                  </div>
                </div>
                {device.verified ? <Badge color="success">Verified</Badge> : <Badge color="warning">Pending</Badge>}
              </div>

              <div className="flex items-center gap-4 text-xs font-medium text-gray-500 pt-3 border-t border-gray-100 dark:border-gray-800">
                <span className="flex items-center gap-1.5">
                  <BoxIconLine className="size-4 text-gray-400" />
                  {device.packs.length} Pack
                </span>
                <span className="flex items-center gap-1.5">
                  <GroupIcon className="size-4 text-gray-400" />
                  {device.collaborators.length} Kolaborator
                </span>
              </div>
            </Link>
          );
        })}
      </div>

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