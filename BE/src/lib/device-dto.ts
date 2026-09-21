import type { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { DeviceRole } from "@/lib/device-role";
import {
  cellDeltaMv,
  deviceStats,
  isOnline,
  lastSeenAt,
  onlineThresholdSec,
  packVoltageV,
  type PackLike,
} from "@/lib/device-view";
import type { CollaboratorSchema, DeviceDetailSchema, DeviceListItemSchema } from "@/contracts/schemas";

export type DeviceListItemDto = z.infer<typeof DeviceListItemSchema>;
export type DeviceDetailDto = z.infer<typeof DeviceDetailSchema>;
export type CollaboratorDto = z.infer<typeof CollaboratorSchema>;

// Field Pack yang dibutuhkan untuk ringkasan/detail (cell diurutkan).
export const PACK_SELECT = {
  index: true,
  temperature: true,
  balancerConnected: true,
  current: true,
  power: true,
  recordedAt: true,
  receivedAt: true,
  updatedAt: true,
  cells: { select: { index: true, voltage: true }, orderBy: { index: "asc" } },
} satisfies Prisma.PackSelect;

export type PackRow = Prisma.PackGetPayload<{ select: typeof PACK_SELECT }>;

const packLike = (p: PackRow): PackLike => p;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

interface DeviceRowBase {
  id: string;
  serialNumber: string;
  name: string | null;
  verified: boolean;
  owner: { id: string; name: string | null } | null;
  packs: { receivedAt: Date | null; updatedAt: Date }[];
}

export function buildBase(device: DeviceRowBase, role: DeviceRole, now: Date) {
  const seen = lastSeenAt(device.packs);
  return {
    id: device.id,
    serialNumber: device.serialNumber,
    name: device.name,
    verified: device.verified,
    role,
    // Device yang bisa dilihat user selalu punya owner (owner atau collaborator); fallback aman bila data tidak konsisten.
    owner: device.owner ?? { id: "", name: null },
    online: isOnline(seen, now, onlineThresholdSec()),
    lastSeenAt: iso(seen),
    packCount: device.packs.length,
  };
}

// `summaryPacks` diberikan hanya untuk view=summary (butuh cell); tanpa itu hanya identitas + online/lastSeenAt.
export function toListItem(device: DeviceRowBase, role: DeviceRole, now: Date, summaryPacks?: PackRow[]): DeviceListItemDto {
  const base = buildBase(device, role, now);
  return summaryPacks ? { ...base, summary: deviceStats(summaryPacks.map(packLike)) } : base;
}

export function toCollaboratorDto(
  c: { userId: string; role: string; addedAt: Date; user: { name: string | null; email: string } },
  viewerIsOwner: boolean,
): CollaboratorDto {
  return {
    userId: c.userId,
    name: c.user.name,
    // Email HANYA untuk owner: collaborator lain tidak boleh melihat alamat email sesama anggota.
    email: viewerIsOwner ? c.user.email : null,
    role: c.role === "editor" ? "editor" : "viewer",
    addedAt: c.addedAt.toISOString(),
  };
}

export function toDetail(
  device: Omit<DeviceRowBase, "packs"> & { packs: PackRow[]; createdAt: Date; collaborators: Parameters<typeof toCollaboratorDto>[0][] },
  role: DeviceRole,
  now: Date,
): DeviceDetailDto {
  const packs = [...device.packs].sort((a, b) => a.index - b.index);
  return {
    ...buildBase(device, role, now),
    createdAt: device.createdAt.toISOString(),
    summary: deviceStats(packs.map(packLike)),
    packs: packs.map((p) => ({
      index: p.index,
      temperatureC: p.temperature,
      balancerConnected: p.balancerConnected,
      currentA: p.current,
      powerW: p.power,
      voltageV: packVoltageV(p.cells),
      cellDeltaMv: cellDeltaMv(p.cells),
      recordedAt: iso(p.recordedAt),
      receivedAt: iso(p.receivedAt),
      cells: p.cells.map((c) => ({ index: c.index, voltageV: c.voltage })),
    })),
    collaborators: device.collaborators.map((c) => toCollaboratorDto(c, role === "owner")),
  };
}
