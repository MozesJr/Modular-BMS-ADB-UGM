"use client";
import { ALARM_LABELS, type Alarm, type AlarmEpisode, type AlarmSeverity } from "@/lib/alertRules";

function sevClasses(sev: AlarmSeverity): { dot: string; text: string; badge: string } {
  return sev === "critical"
    ? { dot: "bg-red-500", text: "text-red-600 dark:text-red-400", badge: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400" }
    : { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", badge: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" };
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function AlarmTimeline({
  activeAlarms,
  episodes,
}: {
  activeAlarms: Alarm[];
  episodes: AlarmEpisode[];
}) {
  const hasAny = activeAlarms.length > 0 || episodes.length > 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="font-bold text-gray-800 dark:text-white/90">Alarm &amp; Event</h4>
          <p className="text-xs text-gray-500">Evaluasi rule di sisi FE (OV/UV/suhu/imbalance/offline).</p>
        </div>
        {activeAlarms.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-400">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            {activeAlarms.length} alarm aktif
          </span>
        )}
      </div>

      {!hasAny ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 py-8 text-center">
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Tidak ada alarm aktif</p>
          <p className="text-xs text-gray-400 mt-1">Semua parameter dalam batas aman pada rentang ini.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Alarm aktif (snapshot live) */}
          {activeAlarms.length > 0 && (
            <div className="space-y-2">
              <h5 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Aktif sekarang</h5>
              {activeAlarms.map((a) => {
                const s = sevClasses(a.severity);
                return (
                  <div key={a.id} className={`flex items-start gap-2.5 rounded-lg px-3 py-2 text-sm ${s.badge}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                    <div>
                      <span className="font-semibold">{ALARM_LABELS[a.rule]}</span>
                      <span className="text-gray-600 dark:text-gray-300"> — {a.message}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Timeline episode dari history */}
          {episodes.length > 0 && (
            <div>
              <h5 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">Riwayat (rentang terpilih)</h5>
              <ol className="relative ml-2 border-l border-gray-200 dark:border-gray-800">
                {episodes.slice(0, 20).map((ep, i) => {
                  const s = sevClasses(ep.severity);
                  const single = ep.from === ep.to;
                  return (
                    <li key={`${ep.rule}-${ep.packIndex}-${ep.from}-${i}`} className="mb-4 ml-4">
                      <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${s.dot}`} />
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className={`text-sm font-semibold ${s.text}`}>{ALARM_LABELS[ep.rule]}</span>
                        <span className="text-xs text-gray-500">Pack #{ep.packIndex}</span>
                        <span className="text-xs tabular-nums text-gray-400">
                          peak {ep.rule === "over_temperature" ? `${ep.peak.toFixed(1)} °C` : ep.rule === "imbalance" ? `${Math.round(ep.peak)} mV` : `${ep.peak.toFixed(3)} V`}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 tabular-nums">
                        {single ? fmtTime(ep.from) : `${fmtTime(ep.from)} — ${fmtTime(ep.to)}`}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
