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
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    expiresAt: string | null;
    // versi token user saat login; undefined pada JWT lama -> dianggap 0
    tv?: number;
  }
}

// biar import DefaultSession di atas ke-resolve
import type { DefaultSession } from "next-auth";