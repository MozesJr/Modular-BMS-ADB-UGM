// FE/src/types/device.ts
export type Cell = {
  id: string;
  index: number;
  voltage: number;
  updatedAt: string;
};

export type Pack = {
  id: string;
  index: number;
  temperature: number | null;
  balancerConnected: boolean;
  cells: Cell[];
  updatedAt: string;
};

export type Collaborator = {
  id: string;
  role: "viewer" | "editor";
  user: {
    id: string;
    name: string | null;
    email: string;
  };
};

export type Device = {
  id: string;
  // ID/lisensi fisik perangkat, sama dengan device_id di topik MQTT ("bms/{serialNumber}/data").
  // Ini yang seharusnya ditampilkan ke user sebagai "Device ID", BUKAN `id` (PK internal).
  serialNumber: string;
  name: string | null;
  // null = device belum diklaim siapapun (auto-provisioned dari data MQTT sebelum didaftarkan).
  ownerId: string | null;
  verified: boolean;
  createdAt: string;
  packs: Pack[];
  collaborators: Collaborator[];
  owner: {
    id: string;
    name: string | null;
    email: string;
  } | null;
};

// --- History (buat grafik tren, lihat GET /api/devices/[id]/history) ---
export type PackTemperaturePoint = {
  recordedAt: string;
  temperature: number | null;
  balancerConnected: boolean;
};

export type CellVoltagePoint = {
  recordedAt: string;
  voltage: number;
};

export type CellHistorySeries = {
  index: number;
  voltage: CellVoltagePoint[];
};

export type PackHistorySeries = {
  index: number;
  temperature: PackTemperaturePoint[];
  cells: CellHistorySeries[];
};

export type DeviceHistory = {
  from: string;
  to: string;
  hours: number;
  packs: PackHistorySeries[];
};

// --- Real-time (payload event "bms:update" lewat WS /ws) ---
export type BmsUpdatePayload = {
  id: string;
  serialNumber: string;
  timestamp: number;
  packs: {
    index: number;
    temperature: number;
    balancerConnected: boolean;
    cells: { index: number; voltage: number }[];
  }[];
};
