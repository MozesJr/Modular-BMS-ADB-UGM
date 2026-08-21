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