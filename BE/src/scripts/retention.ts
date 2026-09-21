import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { DEFAULT_RETENTION, runRetention, type RetentionOptions } from "@/lib/retention";

// Retensi + rollup riwayat. DEFAULT = DRY-RUN (hanya menghitung, tidak mengubah apa pun).
//   node dist/scripts/retention.js                 # dry-run
//   node dist/scripts/retention.js --execute       # benar-benar menulis rollup dan menghapus
//   opsi: --raw-days 30 --rollup-days 365 --lookback-hours 48 --chunk-hours 6 --batch 20000
// Terjadwal (host, tiap hari 03:10):  10 3 * * *  cd /home/Modular-BMS-ADB-UGM && docker compose exec -T backend node dist/scripts/retention.js --execute
function arg(name: string): number | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = Number(process.argv[i + 1]);
  if (!Number.isFinite(v) || v <= 0) {
    console.error(`--${name} harus angka > 0`);
    process.exit(2);
  }
  return v;
}

async function main() {
  const opts: Partial<RetentionOptions> = {
    execute: process.argv.includes("--execute"),
    rawDays: arg("raw-days") ?? Number(process.env.RAW_RETENTION_DAYS) ?? DEFAULT_RETENTION.rawDays,
    rollupDays: arg("rollup-days") ?? DEFAULT_RETENTION.rollupDays,
    lookbackHours: arg("lookback-hours") ?? DEFAULT_RETENTION.lookbackHours,
    chunkHours: arg("chunk-hours") ?? DEFAULT_RETENTION.chunkHours,
    deleteBatch: arg("batch") ?? DEFAULT_RETENTION.deleteBatch,
  };
  if (!Number.isFinite(opts.rawDays) || (opts.rawDays ?? 0) <= 0) opts.rawDays = DEFAULT_RETENTION.rawDays;
  const t0 = Date.now();
  const report = await runRetention(prisma, opts);
  console.log(JSON.stringify({ ...report, tookMs: Date.now() - t0 }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("retention gagal:", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
