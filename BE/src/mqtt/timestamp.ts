// Semantik waktu (lihat docs/MQTT-CONTRACT.md §Timestamp): jam device TIDAK dipercaya penuh.
// Firmware tanpa NTP/RTC bisa mengirim millis() sejak boot atau tanggal 1970. Bila jam device
// menyimpang > MAX_CLOCK_SKEW_MS dari waktu server, dipakai waktu server.
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type ResolvedTime = {
  recordedAt: Date;
  source: "device" | "server";
};

export function resolveRecordedAt(deviceTimestampMs: number, receivedAt: Date): ResolvedTime {
  const skew = Math.abs(deviceTimestampMs - receivedAt.getTime());
  if (skew > MAX_CLOCK_SKEW_MS) return { recordedAt: receivedAt, source: "server" };
  return { recordedAt: new Date(deviceTimestampMs), source: "device" };
}
