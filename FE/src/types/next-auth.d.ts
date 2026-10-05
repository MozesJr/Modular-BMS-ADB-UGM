// FE/src/types/next-auth.d.ts
import "next-auth";
import "next-auth/jwt";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "USER" | "ADMIN";
      expiresAt: string | null;
    } & DefaultSession["user"];
    // Batas idle dari server; remainingSec dihitung server saat respons.
    idle?: { timeoutSec: number; warningSec: number; remainingSec: number };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "USER" | "ADMIN";
    expiresAt: string | null;
    // idle deadline (epoch detik) dihitung SERVER; satu-satunya sumber untuk proxy.ts. Hilang = sesi lama (ditolak).
    ida?: number;
  }
}