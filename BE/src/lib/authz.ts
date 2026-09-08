import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// JWT session (no PrismaAdapter) gak pernah di-invalidate otomatis kalau row User-nya
// udah gak ada — bisa terjadi pas development (DB direset/reseed sementara browser masih
// nyimpen cookie lama). Tanpa cek ini, request lolos "authenticated" tapi nanti gagal di
// query/insert Prisma dengan error FK yang membingungkan. Verifikasi user-nya BENERAN masih
// ada dulu, treat sebagai unauthenticated kalau enggak.
async function getValidSession() {
  const session = await auth();
  if (!session?.user) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });
  if (!user) return null;

  return session;
}

export async function requireAuth() {
  return getValidSession();
}

export async function requireAdmin() {
  const session = await getValidSession();
  if (!session || session.user.role !== "ADMIN") return null;
  return session;
}