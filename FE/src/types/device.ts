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
  // null = device lama belum kirim field ini di payload MQTT.
  current: number | null; // Ampere — negatif = charging, positif = discharging
  power: number | null; // Watt, = voltage_pack x current
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
  // Waktu server terakhir menerima paket MQTT (sumber freshness). Null bila belum pernah.
  lastSeen: string | null;
  createdAt: string;
  packs: Pack[];
  collaborators: Collaborator[];
  owner: {
    id: string;
    name: string | null;
    email: string;
  } | null;
};

// --- History teragregasi (GET /api/devices/[id]/history?hours=&bucket=&cells=) ---
// Backend meng-agregasi per bucket waktu (date_bin) alih-alih mengirim row mentah.
export type HistoryBucket = {
  t: string; // ISO awal bucket
  cellMin: number | null;
  cellMax: number | null;
  cellAvg: number | null;
  deltaMv: number | null;
  tempAvg: number | null;
  currentAvg: number | null;
  powerAvg: number | null;
  energyWh: number | null; // net (signed)
  energyInWh: number | null; // charge (positif)
  energyOutWh: number | null; // discharge (positif)
  balancerOn: boolean;
};

export type PackCellSeries = {
  index: number;
  points: { t: string; vAvg: number }[];
};

export type PackHistorySeries = {
  index: number;
  buckets: HistoryBucket[];
  // Hanya ada bila diminta dengan ?cells=1.
  cells?: PackCellSeries[];
};

export type DeviceHistory = {
  from: string;
  to: string;
  hours: number;
  bucketSeconds: number;
  packs: PackHistorySeries[];
};

// --- Ringkasan fleet (GET /api/devices/summary) ---
export type DeviceSparkPoint = { t: string; deltaMv: number | null; powerW: number | null };
export type DeviceSummaryItem = {
  id: string;
  serialNumber: string;
  name: string | null;
  verified: boolean;
  lastSeen: string | null;
  packCount: number;
  cellCount: number;
  spark: DeviceSparkPoint[];
};
export type DevicesSummary = { hours: number; bucketSeconds: number; devices: DeviceSummaryItem[] };

// --- Real-time (payload event "bms:update" lewat WS /ws) ---
export type BmsUpdatePayload = {
  id: string;
  serialNumber: string;
  timestamp: number;
  packs: {
    index: number;
    temperature: number;
    balancerConnected: boolean;
    // Opsional: device lama belum kirim field ini.
    current?: number;
    power?: number;
    cells: { index: number; voltage: number }[];
  }[];
};
