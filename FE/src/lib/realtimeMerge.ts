// Merge event WS "bms:update" ke objek Device (latest-state) tanpa mutasi.
// Dipakai DeviceDetail, FleetDashboard, dan My Devices — satu implementasi.
import type { BmsUpdatePayload, Device, Pack } from "@/types/device";

export function applyRealtimeUpdate(prev: Device, update: BmsUpdatePayload): Device {
  const packsByIndex = new Map(prev.packs.map((p) => [p.index, p]));

  for (const incomingPack of update.packs) {
    const existingPack = packsByIndex.get(incomingPack.index);
    const cellsByIndex = new Map((existingPack?.cells ?? []).map((c) => [c.index, c]));

    for (const incomingCell of incomingPack.cells) {
      const existingCell = cellsByIndex.get(incomingCell.index);
      cellsByIndex.set(incomingCell.index, {
        id: existingCell?.id ?? `local-cell-${incomingPack.index}-${incomingCell.index}`,
        index: incomingCell.index,
        voltage: incomingCell.voltage,
        updatedAt: new Date().toISOString(),
      });
    }

    const mergedPack: Pack = {
      id: existingPack?.id ?? `local-pack-${incomingPack.index}`,
      index: incomingPack.index,
      temperature: incomingPack.temperature,
      balancerConnected: incomingPack.balancerConnected,
      current: incomingPack.current ?? null,
      power: incomingPack.power ?? null,
      cells: Array.from(cellsByIndex.values()).sort((a, b) => a.index - b.index),
      updatedAt: new Date().toISOString(),
    };
    packsByIndex.set(incomingPack.index, mergedPack);
  }

  return {
    ...prev,
    // lastSeen di-refresh lokal supaya freshness langsung "live" saat paket masuk.
    lastSeen: new Date().toISOString(),
    packs: Array.from(packsByIndex.values()).sort((a, b) => a.index - b.index),
  };
}
