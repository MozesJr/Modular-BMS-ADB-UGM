"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Device } from "@/types/device";
import type { DeviceSummary } from "@/lib/deviceSummary";
import { useBmsSocket } from "@/hooks/useBmsSocket";
import { formatAge, FRESHNESS_META, type Freshness } from "@/lib/freshness";

// "Packet masuk" TIDAK lagi jadi baris tersendiri per paket (dulu bisa membanjiri feed saat
// banyak device live) — sekarang satu baris per device yang diperbarui di tempat (count + waktu
// terakhir). Transisi freshness & alarm tetap baris terpisah, lebih menonjol (warna + border).
type EventKind = Freshness | "alarm-new" | "alarm-clear";

type FeedEvent = {
  id: string;
  at: number;
  deviceId: string;
  deviceLabel: string;
  kind: EventKind;
  text: string;
};

type PacketStat = { deviceId: string; deviceLabel: string; count: number; lastAt: number };

const MAX_EVENTS = 50;

const KIND_META: Record<EventKind, { dot: string; text: string; row: string }> = {
  live: { dot: FRESHNESS_META.live.dot, text: FRESHNESS_META.live.text, row: "border-emerald-100 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-500/5" },
  stale: { dot: FRESHNESS_META.stale.dot, text: FRESHNESS_META.stale.text, row: "border-amber-100 bg-amber-50/60 dark:border-amber-500/20 dark:bg-amber-500/5" },
  offline: { dot: FRESHNESS_META.offline.dot, text: FRESHNESS_META.offline.text, row: "border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-white/[0.02]" },
  "alarm-new": { dot: "bg-red-500", text: "text-red-600 dark:text-red-400", row: "border-red-100 bg-red-50/60 dark:border-red-500/20 dark:bg-red-500/5" },
  "alarm-clear": { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", row: "border-emerald-100 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-500/5" },
};

export default function LiveEventFeed({
  devices,
  summaries,
  nowMs,
}: {
  devices: Device[];
  summaries: Map<string, DeviceSummary>;
  nowMs: number;
}) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [packetStats, setPacketStats] = useState<Map<string, PacketStat>>(new Map());
  const prevStateRef = useRef(new Map<string, { status: Freshness; alarmIds: Set<string> }>());
  const devicesRef = useRef(devices);
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  function deviceLabel(id: string): string {
    const d = devicesRef.current.find((x) => x.id === id);
    return d ? d.name || d.serialNumber : id;
  }

  function pushEvent(e: Omit<FeedEvent, "id">) {
    const id = `${e.at}-${e.deviceId}-${e.kind}-${Math.random().toString(36).slice(2, 7)}`;
    setEvents((prev) => [{ ...e, id }, ...prev].slice(0, MAX_EVENTS));
  }

  // Satu baris per device, diperbarui di tempat (count++, lastAt=now) — bukan baris baru tiap paket.
  useBmsSocket((update) => {
    const now = Date.now();
    setPacketStats((prev) => {
      const next = new Map(prev);
      const existing = next.get(update.id);
      next.set(update.id, {
        deviceId: update.id,
        deviceLabel: deviceLabel(update.id),
        count: (existing?.count ?? 0) + 1,
        lastAt: now,
      });
      return next;
    });
  });

  // Transisi freshness & alarm dihitung di FE (tidak ada event WS khusus dari backend selain
  // "bms:update") dengan membandingkan summary sebelum/sesudah tiap tick.
  useEffect(() => {
    const now = Date.now();
    for (const [id, s] of summaries) {
      const prev = prevStateRef.current.get(id);
      const alarmIds = new Set(s.realAlarms.map((a) => a.id));
      if (prev) {
        if (prev.status !== s.freshness.status) {
          pushEvent({
            at: now,
            deviceId: id,
            deviceLabel: deviceLabel(id),
            kind: s.freshness.status,
            text: `${prev.status} → ${s.freshness.status}`,
          });
        }
        for (const aid of alarmIds) {
          if (!prev.alarmIds.has(aid)) {
            const alarm = s.realAlarms.find((a) => a.id === aid);
            pushEvent({ at: now, deviceId: id, deviceLabel: deviceLabel(id), kind: "alarm-new", text: alarm?.message ?? "Alarm baru" });
          }
        }
        for (const aid of prev.alarmIds) {
          if (!alarmIds.has(aid)) {
            pushEvent({ at: now, deviceId: id, deviceLabel: deviceLabel(id), kind: "alarm-clear", text: "Alarm reda" });
          }
        }
      }
      prevStateRef.current.set(id, { status: s.freshness.status, alarmIds });
    }
  }, [summaries]);

  const packetRows = Array.from(packetStats.values()).sort((a, b) => b.lastAt - a.lastAt);
  const isEmpty = events.length === 0 && packetRows.length === 0;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">Live Event Feed</h3>

      {isEmpty ? (
        <p className="py-8 text-center text-xs text-gray-400">Belum ada event.</p>
      ) : (
        <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
          {events.length > 0 && (
            <ul className="space-y-1.5">
              {events.map((e) => {
                const meta = KIND_META[e.kind];
                return (
                  <li key={e.id} className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 text-xs ${meta.row}`}>
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                    <span className="min-w-0 flex-1">
                      <Link href={`/devices/${e.deviceId}`} className="font-semibold text-gray-800 hover:text-brand-500 dark:text-gray-100">
                        {e.deviceLabel}
                      </Link>{" "}
                      <span className={`font-medium ${meta.text}`}>{e.text}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-gray-400">{formatAge(Math.max(0, nowMs - e.at))}</span>
                  </li>
                );
              })}
            </ul>
          )}

          {packetRows.length > 0 && (
            <div className={`space-y-1 ${events.length > 0 ? "border-t border-gray-100 pt-2 dark:border-gray-800" : ""}`}>
              {packetRows.map((p) => (
                <div key={p.deviceId} className="flex items-center justify-between gap-2 text-[11px] text-gray-400">
                  <Link href={`/devices/${p.deviceId}`} className="min-w-0 truncate hover:text-brand-500">
                    {p.deviceLabel}
                  </Link>
                  <span className="shrink-0 tabular-nums">
                    Packet masuk ×{p.count} · terakhir {formatAge(Math.max(0, nowMs - p.lastAt))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
