"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { AdminUser, Role } from "@/types/user";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import DatePicker from "@/components/form/date-picker";
import { useModal } from "@/hooks/useModal";
import { Modal } from "@/components/ui/modal";
import { alertSuccess, alertError, alertConfirm } from "@/lib/alerts";

const ITEMS_PER_PAGE = 10;

export default function UserManagement() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);

  const createModal = useModal();
  const editModal = useModal();
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);

  // form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("USER");
  const [expiresAt, setExpiresAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadUsers() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<AdminUser[]>("/admin/users");
      setUsers(data);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Gagal memuat data user.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  const totalPages = Math.max(1, Math.ceil(users.length / ITEMS_PER_PAGE));
  const paginatedUsers = users.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages, currentPage]);

  function resetForm() {
    setName("");
    setEmail("");
    setPassword("");
    setRole("USER");
    setExpiresAt("");
    setFormError(null);
  }

  function openCreate() {
    resetForm();
    createModal.openModal();
  }

  function openEdit(user: AdminUser) {
    setEditingUser(user);
    setName(user.name ?? "");
    setEmail(user.email);
    setPassword("");
    setRole(user.role);
    setExpiresAt(user.expiresAt ? user.expiresAt.slice(0, 10) : "");
    setFormError(null);
    editModal.openModal();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!email.trim() || !password || password.length < 8) {
      setFormError("Email wajib diisi dan password minimal 8 karakter.");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post("/admin/users", {
        name: name.trim() || undefined,
        email: email.trim(),
        password,
        role,
        expiresAt: expiresAt || null,
      });
      createModal.closeModal();
      resetForm();
      await loadUsers();
      alertSuccess("User berhasil dibuat", `${email} telah ditambahkan.`);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Gagal membuat user.";
      setFormError(message);
      alertError("Gagal membuat user", message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    setFormError(null);
    setIsSubmitting(true);

    try {
      await api.patch(`/admin/users/${editingUser.id}`, {
        name: name.trim() || undefined,
        role,
        expiresAt: expiresAt || null,
        password: password || undefined,
      });
      editModal.closeModal();
      setEditingUser(null);
      resetForm();
      await loadUsers();
      alertSuccess(
        "Perubahan disimpan",
        `Data ${editingUser.email} telah diperbarui.`,
      );
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Gagal memperbarui user.";
      setFormError(message);
      alertError("Gagal memperbarui user", message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(user: AdminUser) {
    const confirmed = await alertConfirm({
      title: "Hapus user ini?",
      text: `"${user.email}" akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.`,
      confirmText: "Ya, hapus",
      danger: true,
    });
    if (!confirmed) return;

    try {
      await api.delete(`/admin/users/${user.id}`);
      await loadUsers();
      alertSuccess("User dihapus", `${user.email} telah dihapus dari sistem.`);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Gagal menghapus user.";
      alertError("Gagal menghapus user", message);
    }
  }

  function isExpired(user: AdminUser) {
    return user.expiresAt != null && new Date(user.expiresAt) < new Date();
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Manajemen User
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Kelola role, masa aktif, dan akun user.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          + Tambah User
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

      {!isLoading && !error && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 text-left text-gray-500 dark:text-gray-400">
                  <th className="py-3 pr-4 font-medium">Nama</th>
                  <th className="py-3 pr-4 font-medium">Email</th>
                  <th className="py-3 pr-4 font-medium">Role</th>
                  <th className="py-3 pr-4 font-medium">Masa Aktif</th>
                  <th className="py-3 pr-4 font-medium">Device</th>
                  <th className="py-3 pr-4 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {paginatedUsers.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-gray-100 dark:border-gray-800"
                  >
                    <td className="py-3 pr-4 text-gray-800 dark:text-white/90">
                      {user.name || "—"}
                    </td>
                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">
                      {user.email}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge color={user.role === "ADMIN" ? "info" : "light"}>
                        {user.role}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4">
                      {user.expiresAt ? (
                        <Badge color={isExpired(user) ? "error" : "warning"}>
                          {isExpired(user)
                            ? "Expired"
                            : new Date(user.expiresAt).toLocaleDateString(
                                "id-ID",
                              )}
                        </Badge>
                      ) : (
                        <span className="text-gray-400">Tidak expired</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">
                      {user._count.devicesOwned}
                    </td>
                    <td className="py-3 pr-4 text-right space-x-3">
                      <button
                        onClick={() => openEdit(user)}
                        className="text-brand-500 hover:text-brand-600 text-xs font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(user)}
                        className="text-error-600 hover:text-error-700 text-xs font-medium"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {users.length === 0 && (
            <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-6">
              Belum ada user.
            </p>
          )}

          {users.length > 0 && (
            <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Menampilkan {(currentPage - 1) * ITEMS_PER_PAGE + 1}–
                {Math.min(currentPage * ITEMS_PER_PAGE, users.length)} dari{" "}
                {users.length} user
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-400 disabled:opacity-40"
                >
                  Sebelumnya
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400 px-2">
                  Halaman {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-400 disabled:opacity-40"
                >
                  Selanjutnya
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal Create */}
      <Modal
        isOpen={createModal.isOpen}
        onClose={createModal.closeModal}
        className="max-w-[500px] m-4"
      >
        <div className="p-6">
          <h4 className="mb-6 text-xl font-semibold text-gray-800 dark:text-white/90">
            Tambah User Baru
          </h4>
          <form
            key={`create-${createModal.isOpen}`}
            onSubmit={handleCreate}
            className="space-y-5"
          >
            {formError && (
              <div className="rounded-lg bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10 dark:text-error-400">
                {formError}
              </div>
            )}
            <div>
              <Label>Nama</Label>
              <Input
                type="text"
                defaultValue={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label>
                Email <span className="text-error-500">*</span>
              </Label>
              <Input
                type="email"
                defaultValue={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label>
                Password <span className="text-error-500">*</span>
              </Label>
              <Input
                type="password"
                defaultValue={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <Label>Role</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90"
              >
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </div>
            <div>
              <DatePicker
                id="expires-at-create"
                label="Masa Aktif Sampai (opsional)"
                placeholder="Pilih tanggal (kosongkan jika tidak expired)"
                onChange={(_dates, currentDateString) =>
                  setExpiresAt(currentDateString)
                }
              />
              {expiresAt && (
                <button
                  type="button"
                  onClick={() => setExpiresAt("")}
                  className="mt-1 text-xs text-gray-500 hover:text-error-600 dark:text-gray-400"
                >
                  Hapus tanggal
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 justify-end">
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={createModal.closeModal}
              >
                Batal
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? "Menyimpan..." : "Buat User"}
              </Button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Modal Edit */}
      <Modal
        isOpen={editModal.isOpen}
        onClose={editModal.closeModal}
        className="max-w-[500px] m-4"
      >
        <div className="p-6">
          <h4 className="mb-1 text-xl font-semibold text-gray-800 dark:text-white/90">
            Edit User
          </h4>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
            {editingUser?.email}
          </p>
          <form
            key={`edit-${editingUser?.id}-${editModal.isOpen}`}
            onSubmit={handleUpdate}
            className="space-y-5"
          >
            {formError && (
              <div className="rounded-lg bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10 dark:text-error-400">
                {formError}
              </div>
            )}
            <div>
              <Label>Nama</Label>
              <Input
                type="text"
                defaultValue={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label>Role</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90"
              >
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </div>
            <div>
              <DatePicker
                id="expires-at-edit"
                label="Masa Aktif Sampai (kosongkan = tidak expired)"
                placeholder="Pilih tanggal"
                defaultDate={expiresAt || undefined}
                onChange={(_dates, currentDateString) =>
                  setExpiresAt(currentDateString)
                }
              />
              {expiresAt && (
                <button
                  type="button"
                  onClick={() => setExpiresAt("")}
                  className="mt-1 text-xs text-gray-500 hover:text-error-600 dark:text-gray-400"
                >
                  Hapus tanggal
                </button>
              )}
            </div>
            <div>
              <Label>
                Reset Password (opsional, kosongkan jika tidak ingin ubah)
              </Label>
              <Input
                type="password"
                defaultValue={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3 justify-end">
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={editModal.closeModal}
              >
                Batal
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? "Menyimpan..." : "Buat User"}
              </Button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}
