"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Device } from "@/types/device";
import type { DeviceSummary } from "@/lib/deviceSummary";
import { useBmsSocket } from "@/hooks/useBmsSocket";
import { formatAge, FRESHNESS_META, type Freshness } from "@/lib/freshness";

type EventKind = "packet" | Freshness | "alarm-new" | "alarm-clear";

type FeedEvent = {
  id: string;
  at: number;
  deviceId: string;
  deviceLabel: string;
  kind: EventKind;
  text: string;
};

const MAX_EVENTS = 50;
// ~1 log "packet masuk" per siklus sampling (kontrak MQTT ~10s) per device, supaya feed tidak
// banjir saat banyak device live sekaligus.
const PACKET_THROTTLE_MS = 9_000;

const KIND_META: Record<EventKind, { dot: string; text: string }> = {
  packet: { dot: "bg-gray-300 dark:bg-gray-600", text: "text-gray-400" },
  live: { dot: FRESHNESS_META.live.dot, text: FRESHNESS_META.live.text },
  stale: { dot: FRESHNESS_META.stale.dot, text: FRESHNESS_META.stale.text },
  offline: { dot: FRESHNESS_META.offline.dot, text: FRESHNESS_META.offline.text },
  "alarm-new": { dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  "alarm-clear": { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
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
  const lastPacketLogRef = useRef(new Map<string, number>());
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

  useBmsSocket((update) => {
    const now = Date.now();
    const last = lastPacketLogRef.current.get(update.id) ?? 0;
    if (now - last < PACKET_THROTTLE_MS) return;
    lastPacketLogRef.current.set(update.id, now);
    pushEvent({ at: now, deviceId: update.id, deviceLabel: deviceLabel(update.id), kind: "packet", text: "Packet masuk" });
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

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">Live Event Feed</h3>

      {events.length === 0 ? (
        <p className="py-8 text-center text-xs text-gray-400">Belum ada event.</p>
      ) : (
        <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {events.map((e) => {
            const meta = KIND_META[e.kind];
            return (
              <li key={e.id} className="flex items-start gap-2 text-xs">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                <span className="min-w-0 flex-1">
                  <Link href={`/devices/${e.deviceId}`} className="font-medium text-gray-700 hover:text-brand-500 dark:text-gray-300">
                    {e.deviceLabel}
                  </Link>{" "}
                  <span className={meta.text}>{e.text}</span>
                </span>
                <span className="shrink-0 tabular-nums text-gray-400">{formatAge(Math.max(0, nowMs - e.at))}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
