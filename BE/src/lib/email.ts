import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD, // App Password, BUKAN password akun
  },
});

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await transporter.sendMail({
    from: `"Modular Universal BMS" <${process.env.GMAIL_USER}>`,
    to,
    subject: "Reset Password - Modular Universal BMS",
    html: `
      <p>Kami menerima permintaan reset password untuk akun kamu.</p>
      <p><a href="${resetUrl}">Klik di sini untuk reset password</a> (berlaku 1 jam).</p>
      <p>Kalau kamu tidak meminta ini, abaikan email ini.</p>
    `,
  });
}