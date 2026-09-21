import { describe, expect, it } from "vitest";
import net from "node:net";
import nodemailer from "nodemailer";
import { buildPasswordResetEmail, createGmailTransport } from "./email";

describe("email reset password", () => {
  const url = "https://app.example.com/reset-password?token=abc123";

  it("pesan berisi tautan reset, subjek, penerima, teks alternatif", () => {
    const m = buildPasswordResetEmail("noreply@example.com", "user@example.com", url);
    expect(m.to).toBe("user@example.com");
    expect(m.subject).toContain("Reset Password");
    expect(String(m.html)).toContain(`href="${url}"`);
    expect(String(m.text)).toContain(url);
  });

  it("meng-escape HTML pada tautan", () => {
    const m = buildPasswordResetEmail("a@b.co", "u@x.co", 'https://x/?a=1&b="><script>');
    expect(String(m.html)).not.toContain("<script>");
    expect(String(m.html)).toContain("&amp;");
  });

  it("nodemailer (versi terpasang) merakit pesan MIME lengkap lewat jsonTransport, tanpa jaringan", async () => {
    const t = nodemailer.createTransport({ jsonTransport: true });
    const info = await t.sendMail(buildPasswordResetEmail("noreply@example.com", "user@example.com", url));
    const msg = JSON.parse(String(info.message));
    expect(msg.to[0].address).toBe("user@example.com");
    expect(msg.from.address).toBe("noreply@example.com");
    expect(msg.html).toContain(url);
  });

  it("menolak header injection (CRLF) pada alamat penerima atau menetralkannya", async () => {
    const t = nodemailer.createTransport({ jsonTransport: true });
    const info = await t.sendMail(
      buildPasswordResetEmail("noreply@example.com", "victim@example.com\r\nBcc: attacker@evil.test", url),
    );
    const msg = JSON.parse(String(info.message));
    expect(JSON.stringify(msg)).not.toMatch(/"bcc"/i);
  });

  it("transport gmail dikonfigurasi ke smtp.gmail.com dengan timeout yang kita set", () => {
    const t = createGmailTransport("u@gmail.com", "app-password-placeholder");
    const opts = (t as unknown as { transporter: { options: Record<string, unknown> } }).transporter.options;
    expect(opts.host).toBe("smtp.gmail.com");
    expect(opts.connectionTimeout).toBe(10_000);
    expect(opts.socketTimeout).toBe(20_000);
    t.close();
  });

  // SMTP sungguhan lewat socket lokal: memastikan jalur protokol (EHLO/MAIL/RCPT/DATA) tetap jalan di versi terpasang.
  it("mengirim lewat protokol SMTP ke server lokal palsu", async () => {
    const received: string[] = [];
    const server = net.createServer((sock) => {
      let inData = false;
      let buf = "";
      sock.write("220 fake ESMTP\r\n");
      sock.on("data", (chunk) => {
        buf += chunk.toString();
        let idx: number;
        while ((idx = buf.indexOf("\r\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (inData) {
            if (line === ".") {
              inData = false;
              sock.write("250 queued\r\n");
            } else received.push(line);
            continue;
          }
          const cmd = line.split(" ")[0].toUpperCase();
          if (cmd === "EHLO" || cmd === "HELO") sock.write("250 fake\r\n");
          else if (cmd === "MAIL" || cmd === "RCPT") sock.write("250 ok\r\n");
          else if (cmd === "DATA") {
            inData = true;
            sock.write("354 go\r\n");
          } else if (cmd === "QUIT") {
            sock.write("221 bye\r\n");
            sock.end();
          } else sock.write("250 ok\r\n");
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const t = nodemailer.createTransport({ host: "127.0.0.1", port, secure: false, ignoreTLS: true });
      const info = await t.sendMail(buildPasswordResetEmail("noreply@example.com", "user@example.com", url));
      expect(info.accepted).toEqual(["user@example.com"]);
      expect(received.join("\n")).toContain("Subject: Reset Password");
      t.close();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
