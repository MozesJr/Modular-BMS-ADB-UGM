import { Role } from "@prisma/client";
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    id: string;
    role: Role;
    expiresAt: Date | null;
    tokenVersion: number;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
      expiresAt: string | null;
      tokenVersion: number;
    } & DefaultSession["user"];
    // Batas idle sesi web; remainingSec dihitung server saat respons (klien memakainya, bukan jam server).
    idle?: { timeoutSec: number; warningSec: number; remainingSec: number };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    expiresAt: string | null;
    // versi token user saat login; undefined pada JWT lama -> dianggap 0
    tv?: number;
    // idle deadline (epoch detik) dihitung server; hilang = sesi lama -> dianggap idle. Lihat lib/session-idle.ts.
    ida?: number;
    // id sesi acak per login: dipakai hub WS untuk memperpanjang deadline koneksi milik SESI yang sama saja.
    sid?: string;
  }
}

// biar import DefaultSession di atas ke-resolve
import type { DefaultSession } from "next-auth";