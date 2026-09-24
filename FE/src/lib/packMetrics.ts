// Sumber tunggal derivasi statistik cell/pack (min, max, avg, delta, SoC estimasi).
// SEMUA tempat (gauge PackCard, analytics history, kartu fleet, digital twin) wajib pakai
// fungsi ini supaya angka tidak beda-beda (mis. delta 95 mV di gauge vs 100 mV di analytics).

export const NOMINAL_LIFEPO4_V_PER_CELL = 3.2;

// Tabel OCV→SoC LiFePO4 (per cell, kondisi rest). Kurva sangat datar 20–90%, jadi estimasi
// voltage-based di rentang itu kasar — ini tetap indikatif, BUKAN coulomb counting.
// Taruh di satu tempat agar mudah dikalibrasi ulang dari data sel sebenarnya.
// [tegangan cell (V), SoC (%)] menaik.
export const LIFEPO4_OCV_SOC: readonly (readonly [number, number])[] = [
  [2.50, 0],
  [2.90, 5],
  [3.10, 10],
  [3.20, 20],
  [3.25, 30],
  [3.28, 40],
  [3.30, 50],
  [3.32, 60],
  [3.33, 70],
  [3.34, 80],
  [3.35, 90],
  [3.40, 99],
  [3.45, 100],
];

// SoC dianggap tidak andal (arus signifikan) di atas ambang ini — tegangan terbebani menyimpang
// dari OCV rest.
export const SOC_LOAD_THRESHOLD_A = 0.2;

export type CellReading = { index: number; voltage: number };

export type CellStats = {
  count: number;
  // Cell diurutkan numerik berdasarkan index (fix bug urutan 21,22,23,24,1,2...).
  sortedCells: CellReading[];
  packVoltage: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  // Delta selalu dalam milivolt, dibulatkan konsisten di satu tempat.
  deltaMv: number | null;
  minIndex: number | null;
  maxIndex: number | null;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Derivasi dari satu snapshot cell (bukan deret waktu). Analytics pun memakai snapshot
// terbaru dari history lewat fungsi yang sama agar konsisten dengan gauge live.
export function deriveCellStats(cells: readonly CellReading[]): CellStats {
  const sortedCells = [...cells].sort((a, b) => a.index - b.index);
  const count = sortedCells.length;
  const packVoltage = sortedCells.reduce((sum, c) => sum + c.voltage, 0);

  if (count === 0) {
    return {
      count: 0,
      sortedCells,
      packVoltage: 0,
      min: null,
      max: null,
      avg: null,
      deltaMv: null,
      minIndex: null,
      maxIndex: null,
    };
  }

  let min = sortedCells[0].voltage;
  let max = sortedCells[0].voltage;
  let minIndex = sortedCells[0].index;
  let maxIndex = sortedCells[0].index;
  for (const cell of sortedCells) {
    if (cell.voltage < min) {
      min = cell.voltage;
      minIndex = cell.index;
    }
    if (cell.voltage > max) {
      max = cell.voltage;
      maxIndex = cell.index;
    }
  }
  const avg = packVoltage / count;
  // Dibulatkan ke integer mV di sumber tunggal ini.
  const deltaMv = Math.round((max - min) * 1000);

  return { count, sortedCells, packVoltage, min, max, avg, deltaMv, minIndex, maxIndex };
}

// Interpolasi linier SoC dari tegangan satu cell lewat tabel OCV.
export function socFromCellVoltage(cellVoltage: number): number {
  const table = LIFEPO4_OCV_SOC;
  if (cellVoltage <= table[0][0]) return table[0][1];
  const lastIdx = table.length - 1;
  if (cellVoltage >= table[lastIdx][0]) return table[lastIdx][1];
  for (let i = 0; i < lastIdx; i++) {
    const [v0, s0] = table[i];
    const [v1, s1] = table[i + 1];
    if (cellVoltage >= v0 && cellVoltage <= v1) {
      const t = (cellVoltage - v0) / (v1 - v0);
      return s0 + t * (s1 - s0);
    }
  }
  return table[lastIdx][1];
}

// Estimasi SoC pack (0–100) dari rata-rata tegangan cell via tabel OCV LiFePO4. Null jika tak ada cell.
export function estimateSocPercent(packVoltage: number, cellCount: number): number | null {
  if (cellCount <= 0) return null;
  const avgCellV = packVoltage / cellCount;
  return clamp(socFromCellVoltage(avgCellV), 0, 100);
}

// SoC andal hanya saat arus mendekati nol (rest). Di atas ambang, tandai "tidak andal".
export function isSocReliable(current: number | null | undefined): boolean {
  if (current == null) return true; // device lama tak kirim arus — anggap tak terbebani
  return Math.abs(current) <= SOC_LOAD_THRESHOLD_A;
}

// Deviasi tiap cell dari rata-rata pack, dalam mV. Dipakai diverging bar & digital twin.
export function cellDeviationsMv(
  cells: readonly CellReading[],
): { index: number; voltage: number; deviationMv: number }[] {
  const { avg, sortedCells } = deriveCellStats(cells);
  if (avg == null) return [];
  return sortedCells.map((c) => ({
    index: c.index,
    voltage: c.voltage,
    deviationMv: Math.round((c.voltage - avg) * 1000),
  }));
}

// Arah arus: current negatif = charging (kontrak sensor ACS712). |I| ~ 0 dianggap idle.
export const CURRENT_IDLE_THRESHOLD_A = 0.05;

export type CurrentDirection = "charging" | "discharging" | "idle";

export function currentDirection(current: number | null | undefined): CurrentDirection {
  if (current == null) return "idle";
  if (Math.abs(current) < CURRENT_IDLE_THRESHOLD_A) return "idle";
  return current < 0 ? "charging" : "discharging";
}
