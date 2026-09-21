import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Tes integrasi: butuh Postgres SEKALI-PAKAI yang sudah dimigrasi.
//   source <file-env-berisi-TEST_DATABASE_URL> && npm test
// Sengaja menolak apa pun selain 127.0.0.1/localhost dengan nama database "bms_test*"
// supaya tes tidak pernah menyentuh DB development/produksi.
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

d("ingestion (DB nyata sekali-pakai)", () => {
  let prisma: typeof import("@/lib/prisma").prisma;
  let persistWithRetry: typeof import("./ingest").persistWithRetry;
  let n = 0;
  const serial = () => `TEST-${Date.now()}-${++n}`;

  const payload = (temp: number | null, volt = 3.3) => ({
    timestamp: 0,
    packs: [
      {
        index: 0,
        temperature: temp,
        balancerConnected: true,
        current: -1.5,
        power: -80,
        cells: [
          { index: 0, voltage: volt },
          { index: 1, voltage: volt + 0.01 },
        ],
      },
    ],
  });
  const job = (deviceId: string, at: string, temp: number | null, volt?: number) => ({
    deviceId,
    payload: payload(temp, volt),
    recordedAt: new Date(at),
    receivedAt: new Date("2026-09-21T10:00:00.000Z"),
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = url; // sebelum PrismaClient dibuat
    ({ prisma } = await import("@/lib/prisma"));
    ({ persistWithRetry } = await import("./ingest"));
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("pesan pertama membuat device (auto-provision), pack, cell, dan history", async () => {
    const s = serial();
    const r = await persistWithRetry(job(s, "2026-09-21T09:00:00.000Z", 25));
    expect(r.packsUpdated).toBe(1);
    const dev = await prisma.device.findUniqueOrThrow({
      where: { serialNumber: s },
      include: { packs: { include: { cells: true } } },
    });
    expect(dev.ownerId).toBeNull();
    expect(dev.verified).toBe(false);
    expect(dev.packs[0].temperature).toBe(25);
    expect(dev.packs[0].cells).toHaveLength(2);
    expect(dev.packs[0].recordedAt?.toISOString()).toBe("2026-09-21T09:00:00.000Z");
    expect(dev.packs[0].receivedAt?.toISOString()).toBe("2026-09-21T10:00:00.000Z");
    expect(await prisma.packHistory.count({ where: { deviceId: dev.id } })).toBe(1);
    expect(await prisma.cellHistory.count({ where: { deviceId: dev.id } })).toBe(2);
    // current/power ikut masuk history (untuk grafik daya/arus)
    const hist = await prisma.packHistory.findFirstOrThrow({ where: { deviceId: dev.id } });
    expect(hist.current).toBe(-1.5);
    expect(hist.power).toBe(-80);
  });

  it("idempoten: pesan yang sama dua kali tidak menggandakan history", async () => {
    const s = serial();
    await persistWithRetry(job(s, "2026-09-21T09:00:00.000Z", 25));
    const again = await persistWithRetry(job(s, "2026-09-21T09:00:00.000Z", 25));
    expect(again.historyDuplicates).toBe(3); // 1 pack + 2 cell dilewati
    const dev = await prisma.device.findUniqueOrThrow({ where: { serialNumber: s } });
    expect(await prisma.packHistory.count({ where: { deviceId: dev.id } })).toBe(1);
    expect(await prisma.cellHistory.count({ where: { deviceId: dev.id } })).toBe(2);
  });

  it("pesan lebih lama TIDAK menimpa state terbaru, tapi tetap masuk history", async () => {
    const s = serial();
    await persistWithRetry(job(s, "2026-09-21T09:00:10.000Z", 30, 3.4));
    const old = await persistWithRetry(job(s, "2026-09-21T09:00:00.000Z", 20, 3.0));
    expect(old.packsStale).toBe(1);
    expect(old.packsUpdated).toBe(0);
    const dev = await prisma.device.findUniqueOrThrow({
      where: { serialNumber: s },
      include: { packs: { include: { cells: { orderBy: { index: "asc" } } } } },
    });
    expect(dev.packs[0].temperature).toBe(30);
    expect(dev.packs[0].cells[0].voltage).toBe(3.4);
    expect(await prisma.packHistory.count({ where: { deviceId: dev.id } })).toBe(2);
  });

  it("suhu null (sensor fault): disimpan sebagai NULL, tegangan cell tetap tersimpan", async () => {
    const s = serial();
    await persistWithRetry(job(s, "2026-09-21T09:00:00.000Z", 25));
    await persistWithRetry(job(s, "2026-09-21T09:00:05.000Z", null, 3.45));
    const dev = await prisma.device.findUniqueOrThrow({
      where: { serialNumber: s },
      include: { packs: { include: { cells: { orderBy: { index: "asc" } } } } },
    });
    expect(dev.packs[0].temperature).toBeNull();
    expect(dev.packs[0].cells[0].voltage).toBe(3.45);
    const hist = await prisma.packHistory.findFirstOrThrow({
      where: { deviceId: dev.id, recordedAt: new Date("2026-09-21T09:00:05.000Z") },
    });
    expect(hist.temperature).toBeNull();
    expect(await prisma.cellHistory.count({ where: { deviceId: dev.id } })).toBe(4);
  });

  it("pesan lebih baru menimpa state terbaru", async () => {
    const s = serial();
    await persistWithRetry(job(s, "2026-09-21T09:00:00.000Z", 20));
    await persistWithRetry(job(s, "2026-09-21T09:00:05.000Z", 31));
    const dev = await prisma.device.findUniqueOrThrow({ where: { serialNumber: s }, include: { packs: true } });
    expect(dev.packs[0].temperature).toBe(31);
  });

  it("dua pesan pertama bersamaan untuk device baru tidak error dan hanya membuat satu device", async () => {
    const s = serial();
    const results = await Promise.all([
      persistWithRetry(job(s, "2026-09-21T09:00:00.000Z", 20)),
      persistWithRetry(job(s, "2026-09-21T09:00:01.000Z", 21)),
      persistWithRetry(job(s, "2026-09-21T09:00:02.000Z", 22)),
    ]);
    expect(results).toHaveLength(3);
    expect(await prisma.device.count({ where: { serialNumber: s } })).toBe(1);
    const dev = await prisma.device.findUniqueOrThrow({ where: { serialNumber: s }, include: { packs: true } });
    expect(dev.packs).toHaveLength(1);
    expect(dev.packs[0].temperature).toBe(22); // yang tertua-waktunya tidak boleh menang
  });

  it("jumlah pack dinamis: pack baru ikut dibuat pada pesan berikutnya", async () => {
    const s = serial();
    await persistWithRetry(job(s, "2026-09-21T09:00:00.000Z", 20));
    const two = job(s, "2026-09-21T09:00:05.000Z", 21);
    two.payload.packs.push({ ...two.payload.packs[0], index: 1 });
    await persistWithRetry(two);
    const dev = await prisma.device.findUniqueOrThrow({ where: { serialNumber: s }, include: { packs: true } });
    expect(dev.packs.map((p) => p.index).sort()).toEqual([0, 1]);
  });
});
