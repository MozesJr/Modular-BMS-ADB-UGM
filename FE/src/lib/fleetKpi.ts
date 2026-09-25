// Agregasi level-fleet untuk Fleet Dashboard v2 (KPI strip + Fleet Pulse).
// Kontrak "aktif/live": hanya device dengan freshness "live" yang dihitung sebagai daya/alarm
// aktif/imbalance aktif. Device stale/offline TIDAK dihitung di sini — offline dihitung terpisah
// (offlineCount) sebagai status, bukan sebagai imbalance/alarm aktif.
import type { Device } from "@/types/device";
import type { DeviceSummary } from "@/lib/deviceSummary";

export type FleetKpi = {
  liveCount: number;
  staleCount: number;
  offlineCount: number;
  total: number;
  packs: number;
  cells: number;
  // Alarm NYATA (bukan pseudo "offline"), device live saja.
  activeAlarmCount: number;
  chargeW: number; // daya masuk (charging), live saja, positif
  dischargeW: number; // daya keluar (discharging), live saja, positif
  netW: number; // dischargeW - chargeW; negatif = net charging
  worst: { device: Device; deltaMv: number } | null; // imbalance terburuk, device LIVE saja
};

export function computeFleetKpi(devices: Device[], summaries: Map<string, DeviceSummary>): FleetKpi {
  let liveCount = 0;
  let staleCount = 0;
  let offlineCount = 0;
  let packs = 0;
  let cells = 0;
  let activeAlarmCount = 0;
  let chargeW = 0;
  let dischargeW = 0;
  let worst: { device: Device; deltaMv: number } | null = null;

  for (const device of devices) {
    const s = summaries.get(device.id);
    if (!s) continue;
    packs += s.packs.length;
    cells += s.cellCount;

    if (s.freshness.status === "live") liveCount++;
    else if (s.freshness.status === "stale") staleCount++;
    else offlineCount++;

    if (s.freshness.status !== "live") continue;

    activeAlarmCount += s.realAlarms.length;
    for (const p of s.packs) {
      if (p.power == null) continue;
      // Konvensi sensor: current negatif = charging -> power negatif = daya masuk.
      if (p.power < 0) chargeW += -p.power;
      else dischargeW += p.power;
    }
    if (worst == null || s.worstDelta > worst.deltaMv) worst = { device, deltaMv: s.worstDelta };
  }

  return {
    liveCount,
    staleCount,
    offlineCount,
    total: devices.length,
    packs,
    cells,
    activeAlarmCount,
    chargeW,
    dischargeW,
    netW: dischargeW - chargeW,
    worst,
  };
}
