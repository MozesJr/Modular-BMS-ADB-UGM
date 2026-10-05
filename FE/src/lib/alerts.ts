import Swal from "sweetalert2";

const baseConfig = {
  customClass: {
    popup: "rounded-2xl",
    confirmButton:
      "!bg-brand-500 !text-white !rounded-lg !px-5 !py-2.5 !text-sm !font-medium hover:!bg-brand-600 focus:!ring-0 focus:!shadow-none",
    cancelButton:
      "!bg-gray-100 !text-gray-700 !rounded-lg !px-5 !py-2.5 !text-sm !font-medium hover:!bg-gray-200 focus:!ring-0 focus:!shadow-none dark:!bg-white/10 dark:!text-gray-300",
  },
  buttonsStyling: false,
};

export function alertSuccess(title: string, text?: string) {
  return Swal.fire({
    ...baseConfig,
    icon: "success",
    title,
    text,
    timer: 2000,
    showConfirmButton: false,
  });
}

export function alertError(title: string, text?: string) {
  return Swal.fire({
    ...baseConfig,
    icon: "error",
    title,
    text,
  });
}

export function alertConfirm(options: {
  title: string;
  text?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}) {
  return Swal.fire({
    ...baseConfig,
    icon: "warning",
    title: options.title,
    text: options.text,
    showCancelButton: true,
    confirmButtonText: options.confirmText ?? "Ya, lanjutkan",
    cancelButtonText: options.cancelText ?? "Batal",
    customClass: {
      ...baseConfig.customClass,
      confirmButton: options.danger
        ? "!bg-error-500 !text-white !rounded-lg !px-5 !py-2.5 !text-sm !font-medium hover:!bg-error-600 focus:!ring-0 focus:!shadow-none"
        : baseConfig.customClass.confirmButton,
    },
    reverseButtons: true,
  }).then((result) => result.isConfirmed);
}
// Peringatan idle: hitung mundur sampai logout otomatis. result: "stay" (Tetap login), "logout" (Keluar), "closed"
// (ditutup program, mis. karena ada aktivitas di tab lain). Esc/klik luar dinonaktifkan agar tidak tertutup tanpa sengaja.
export function showIdleWarning(secondsLeft: () => number): { close: () => void; result: Promise<"stay" | "logout" | "closed"> } {
  let ticker: ReturnType<typeof setInterval> | null = null;
  const result = Swal.fire({
    ...baseConfig,
    icon: "warning",
    title: "Sesi akan berakhir",
    html: `Tidak ada aktivitas. Anda akan keluar otomatis dalam <b id="idle-countdown">${secondsLeft()}</b> detik.`,
    showCancelButton: true,
    confirmButtonText: "Tetap login",
    cancelButtonText: "Keluar",
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => {
      ticker = setInterval(() => {
        const el = document.getElementById("idle-countdown");
        if (el) el.textContent = String(secondsLeft());
      }, 250);
    },
    willClose: () => {
      if (ticker) clearInterval(ticker);
    },
  }).then((r) => (r.isConfirmed ? "stay" : r.dismiss === Swal.DismissReason.cancel ? "logout" : "closed"));
  return { close: () => Swal.close(), result };
}
