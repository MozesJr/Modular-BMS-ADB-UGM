import { PrismaClient } from "@prisma/client";

// Selalu disimpan di globalThis: kode custom server (dist/) dan route handler Next (webpack)
// punya salinan modul sendiri; tanpa ini keduanya membuat PrismaClient + pool koneksi masing-masing.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

globalForPrisma.prisma = prisma;
