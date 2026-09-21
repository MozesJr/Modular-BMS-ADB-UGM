import nodemailer from "nodemailer";
import type { SendMailOptions, Transporter } from "nodemailer";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Pembentuk pesan murni (dites tanpa jaringan di email.test.ts).
export function buildPasswordResetEmail(from: string, to: string, resetUrl: string): SendMailOptions {
  const url = escapeHtml(resetUrl);
  return {
    from: `"Modular Universal BMS" <${from}>`,
    to,
    subject: "Reset Password - Modular Universal BMS",
    html: `
      <p>Kami menerima permintaan reset password untuk akun kamu.</p>
      <p><a href="${url}">Klik di sini untuk reset password</a> (berlaku 1 jam).</p>
      <p>Kalau kamu tidak meminta ini, abaikan email ini.</p>
    `,
    text: `Kami menerima permintaan reset password untuk akun kamu.\nBuka tautan ini (berlaku 1 jam): ${resetUrl}\nKalau kamu tidak meminta ini, abaikan email ini.`,
  };
}

export function createGmailTransport(user?: string, pass?: string): Transporter {
  return nodemailer.createTransport({
    service: "gmail",
    // Jangan biarkan SMTP yang lambat menahan worker latar belakang tanpa batas.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    auth: { user, pass }, // pass = App Password, BUKAN password akun
  });
}

let transporter: Transporter | null = null;

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  transporter ??= createGmailTransport(process.env.GMAIL_USER, process.env.GMAIL_APP_PASSWORD);
  await transporter.sendMail(buildPasswordResetEmail(process.env.GMAIL_USER ?? "", to, resetUrl));
}
