"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Device } from "@/types/device";
import { useTheme } from "@/context/ThemeContext";

// Command palette ⌘K / Ctrl+K memakai search bar header. Lompat ke device (nama/ID), ke halaman,
// toggle dark mode. Keyboard-first, fokus dikembalikan saat ditutup. Dibuka via event "cmdk:open"
// (dispatch dari input header) atau shortcut. Satu-satunya global keydown = ⌘/Ctrl+K (preventDefault).
type Command = { id: string; label: string; hint?: string; run: () => void };

export default function CommandPalette() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    // Kembalikan fokus ke elemen pemicu.
    prevFocus.current?.focus?.();
  }, []);

  const openPalette = useCallback(() => {
    prevFocus.current = document.activeElement as HTMLElement | null;
    setOpen(true);
    setQuery("");
    setActive(0);
  }, []);

  // Shortcut global (hanya ⌘/Ctrl+K) + event dari header.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (!v) prevFocus.current = document.activeElement as HTMLElement | null;
          return !v;
        });
      }
    };
    const onOpen = () => openPalette();
    document.addEventListener("keydown", onKey);
    window.addEventListener("cmdk:open", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("cmdk:open", onOpen);
    };
  }, [openPalette]);

  // Muat device saat pertama dibuka.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      if (devices.length === 0) api.get<Device[]>("/devices").then(setDevices).catch(() => {});
    }
  }, [open, devices.length]);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: "nav-dashboard", label: "Buka Dashboard", hint: "Halaman", run: () => router.push("/") },
      { id: "nav-devices", label: "Buka My Devices", hint: "Halaman", run: () => router.push("/devices") },
      { id: "toggle-theme", label: `Ganti tema ke ${theme === "light" ? "Dark" : "Light"}`, hint: "Aksi", run: toggleTheme },
    ];
    const deviceCmds: Command[] = devices.map((d) => ({
      id: `dev-${d.id}`,
      label: d.name || d.serialNumber,
      hint: `Device · ${d.serialNumber}`,
      run: () => router.push(`/devices/${d.id}`),
    }));
    return [...base, ...deviceCmds];
  }, [devices, theme, toggleTheme, router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  const runActive = () => {
    const cmd = filtered[active];
    if (cmd) {
      close();
      cmd.run();
    }
  };

  return (
    <div className="fixed inset-0 z-[100000] flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={close} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              runActive();
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
          placeholder="Cari device, halaman, atau aksi…"
          aria-label="Cari perintah"
          className="w-full border-b border-gray-100 bg-transparent px-4 py-3.5 text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:border-gray-800 dark:text-white/90"
        />
        <ul className="max-h-[320px] overflow-y-auto py-1" role="listbox" aria-label="Hasil">
          {filtered.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-400">Tidak ada hasil.</li>}
          {filtered.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onClick={runActive}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm ${
                  i === active ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "text-gray-700 dark:text-gray-300"
                }`}
              >
                <span className="truncate font-medium">{c.label}</span>
                {c.hint && <span className="ml-3 shrink-0 text-xs text-gray-400">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400 dark:border-gray-800">
          <span>↑↓ navigasi · ↵ pilih · esc tutup</span>
          <span>⌘K</span>
        </div>
      </div>
    </div>
  );
}
