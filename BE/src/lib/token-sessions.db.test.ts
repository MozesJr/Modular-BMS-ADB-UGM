import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integrasi DB sekali-pakai (lihat ingest.db.test.ts untuk pengaman URL).
const url = process.env.TEST_DATABASE_URL;
const safe = (() => {
  if (!url) return false;
  try {
    const u = new URL(url);
    return ["127.0.0.1", "localhost"].includes(u.hostname) && u.pathname.startsWith("/bms_test");
  } catch {
    return false;
  }
})();
if (url && !safe) throw new Error("TEST_DATABASE_URL ditolak: harus 127.0.0.1/localhost dan DB bernama bms_test*");

const d = safe ? describe : describe.skip;

d("sesi token mobile (DB nyata sekali-pakai)", () => {
  let prisma: typeof import("@/lib/prisma").prisma;
  let sessions: typeof import("./token-sessions");
  let tokens: typeof import("./tokens");
  let n = 0;

  async function makeUser(over: Record<string, unknown> = {}) {
    n++;
    return prisma.user.create({
      data: { email: `ts${Date.now()}-${n}@test.local`, passwordHash: "x", name: "T", ...over },
    });
  }
  const asSessionUser = (u: Awaited<ReturnType<typeof makeUser>>) => ({
    id: u.id, email: u.email, name: u.name, role: u.role, expiresAt: u.expiresAt, tokenVersion: u.tokenVersion,
  });
  const rejectsWith = async (p: Promise<unknown>, code: string, status?: number) => {
    const e = (await p.then(() => null, (x: unknown) => x)) as { code?: string; status?: number } | null;
    expect(e?.code).toBe(code);
    if (status) expect(e?.status).toBe(status);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.JWT_ACCESS_SECRET = "test-access-secret-".padEnd(48, "x");
    process.env.NEXTAUTH_SECRET = "different-".padEnd(48, "y");
    ({ prisma } = await import("@/lib/prisma"));
    sessions = await import("./token-sessions");
    tokens = await import("./tokens");
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("login menerbitkan pasangan token; DB hanya menyimpan HASH refresh token", async () => {
    const u = await makeUser();
    const t = await sessions.startSession(asSessionUser(u), "Pixel 8");
    expect(t.tokenType).toBe("Bearer");
    expect(t.expiresIn).toBe(900);
    expect(await tokens.verifyAccessToken(t.accessToken)).toMatchObject({ userId: u.id, tokenVersion: 0 });
    const rows = await prisma.refreshToken.findMany({ where: { userId: u.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(tokens.hashRefreshToken(t.refreshToken));
    expect(JSON.stringify(rows[0])).not.toContain(t.refreshToken);
    expect(rows[0].deviceName).toBe("Pixel 8");
  });

  it("refresh: memutar token (lama ditandai usedAt), family sama, access token baru valid", async () => {
    const u = await makeUser();
    const t1 = await sessions.startSession(asSessionUser(u));
    const t2 = await sessions.rotateSession(t1.refreshToken);
    expect(t2.refreshToken).not.toBe(t1.refreshToken);
    expect(await tokens.verifyAccessToken(t2.accessToken)).toMatchObject({ userId: u.id });
    const rows = await prisma.refreshToken.findMany({ where: { userId: u.id }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].usedAt).not.toBeNull();
    expect(rows[0].replacedById).toBe(rows[1].id);
    expect(rows[1].familyId).toBe(rows[0].familyId);
    expect(rows[1].usedAt).toBeNull();
  });

  it("REUSE: token lama dipakai lagi -> 401 REFRESH_REUSED dan SELURUH family dicabut (termasuk token baru)", async () => {
    const u = await makeUser();
    const t1 = await sessions.startSession(asSessionUser(u));
    const t2 = await sessions.rotateSession(t1.refreshToken);
    await rejectsWith(sessions.rotateSession(t1.refreshToken), "REFRESH_REUSED", 401);
    await rejectsWith(sessions.rotateSession(t2.refreshToken), "REFRESH_REVOKED", 401); // pencuri maupun pemilik sah harus login ulang
    const rows = await prisma.refreshToken.findMany({ where: { userId: u.id } });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it("reuse pada satu family tidak mengganggu family lain (perangkat lain) milik user yang sama", async () => {
    const u = await makeUser();
    const a1 = await sessions.startSession(asSessionUser(u), "A");
    const b1 = await sessions.startSession(asSessionUser(u), "B");
    await sessions.rotateSession(a1.refreshToken);
    await rejectsWith(sessions.rotateSession(a1.refreshToken), "REFRESH_REUSED");
    const b2 = await sessions.rotateSession(b1.refreshToken);
    expect(b2.refreshToken).toBeTruthy();
  });

  it("dua refresh SERENTAK dengan token yang sama: tepat satu menang, yang lain dianggap reuse dan family dicabut", async () => {
    const u = await makeUser();
    const t1 = await sessions.startSession(asSessionUser(u));
    const results = await Promise.allSettled([sessions.rotateSession(t1.refreshToken), sessions.rotateSession(t1.refreshToken)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const rows = await prisma.refreshToken.findMany({ where: { userId: u.id } });
    expect(rows.every((r) => r.revokedAt !== null || r.usedAt !== null)).toBe(true);
    expect(rows.some((r) => r.revokedAt !== null)).toBe(true);
  });

  it("token tidak dikenal -> 401 INVALID_REFRESH_TOKEN", async () => {
    await rejectsWith(sessions.rotateSession("x".repeat(43)), "INVALID_REFRESH_TOKEN", 401);
  });

  it("refresh token kedaluwarsa -> 401 REFRESH_EXPIRED (tanpa mencabut family)", async () => {
    const u = await makeUser();
    const past = new Date(Date.now() - 40 * 24 * 3600 * 1000);
    const t = await sessions.startSession(asSessionUser(u), undefined, past); // umur 30 hari dihitung dari 'past'
    await rejectsWith(sessions.rotateSession(t.refreshToken), "REFRESH_EXPIRED", 401);
  });

  it("umur family dibatasi absolut (90 hari): token baru tidak melampaui familyExpiresAt", async () => {
    const u = await makeUser();
    const start = new Date(Date.now() - 80 * 24 * 3600 * 1000);
    const t1 = await sessions.startSession(asSessionUser(u), undefined, start);
    const row1 = await prisma.refreshToken.findFirstOrThrow({ where: { userId: u.id } });
    const t2 = await sessions.rotateSession(t1.refreshToken, new Date(start.getTime() + 29 * 24 * 3600 * 1000));
    const rows = await prisma.refreshToken.findMany({ where: { userId: u.id }, orderBy: { createdAt: "asc" } });
    expect(rows[1].expiresAt.getTime()).toBeLessThanOrEqual(row1.familyExpiresAt.getTime());
    expect(t2.refreshExpiresIn).toBeGreaterThan(0);
  });

  it("ganti/reset password (tokenVersion++) -> refresh ditolak SESSION_REVOKED dan family dicabut", async () => {
    const u = await makeUser();
    const t = await sessions.startSession(asSessionUser(u));
    await prisma.user.update({ where: { id: u.id }, data: { tokenVersion: { increment: 1 } } });
    await rejectsWith(sessions.rotateSession(t.refreshToken), "SESSION_REVOKED", 401);
    expect((await prisma.refreshToken.findMany({ where: { userId: u.id } })).every((r) => r.revokedAt)).toBe(true);
  });

  it("akun expired -> 403 ACCOUNT_EXPIRED dan family dicabut", async () => {
    const u = await makeUser();
    const t = await sessions.startSession(asSessionUser(u));
    await prisma.user.update({ where: { id: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await rejectsWith(sessions.rotateSession(t.refreshToken), "ACCOUNT_EXPIRED", 403);
    expect((await prisma.refreshToken.findMany({ where: { userId: u.id } })).every((r) => r.revokedAt)).toBe(true);
  });

  it("logout: seluruh family perangkat itu dicabut; idempoten; token asing/ngawur tidak error", async () => {
    const u = await makeUser();
    const a = await sessions.startSession(asSessionUser(u), "A");
    const b = await sessions.startSession(asSessionUser(u), "B");
    const a2 = await sessions.rotateSession(a.refreshToken);
    await sessions.endSession(a2.refreshToken);
    await sessions.endSession(a2.refreshToken); // idempoten
    await sessions.endSession("ngawur-".repeat(8)); // tidak melempar
    await rejectsWith(sessions.rotateSession(a2.refreshToken), "REFRESH_REVOKED");
    expect((await sessions.rotateSession(b.refreshToken)).refreshToken).toBeTruthy(); // perangkat B tidak terpengaruh
  });

  it("logout-all: semua refresh token dicabut dan tokenVersion naik (access token lama tak valid lagi di DB-check)", async () => {
    const u = await makeUser();
    const a = await sessions.startSession(asSessionUser(u));
    const b = await sessions.startSession(asSessionUser(u));
    await sessions.endAllSessions(u.id);
    await rejectsWith(sessions.rotateSession(a.refreshToken), "REFRESH_REVOKED");
    await rejectsWith(sessions.rotateSession(b.refreshToken), "REFRESH_REVOKED");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.tokenVersion).toBe(u.tokenVersion + 1);
    const claims = await tokens.verifyAccessToken(a.accessToken);
    expect(claims?.tokenVersion).not.toBe(after.tokenVersion);
  });

  it("menghapus user menghapus refresh token-nya (cascade)", async () => {
    const u = await makeUser();
    await sessions.startSession(asSessionUser(u));
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.refreshToken.count({ where: { userId: u.id } })).toBe(0);
  });
});
