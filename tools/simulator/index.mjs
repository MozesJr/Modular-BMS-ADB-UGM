// BMS publisher simulator (dev lokal). Meniru kontrak payload MQTT firmware:
//   topic  bms/{serialNumber}/data
//   body   { timestamp, packs:[{ index, temperature, balancerConnected, current, power, cells:[{index,voltage}] }] }
// Variasi realistis LiFePO4: cell 3.25–3.45 V, fase charge (current negatif) & discharge
// bergantian, sesekali imbalance > 50 mV, suhu 26–40 °C. Tidak menyentuh broker/DB produksi.
import mqtt from "mqtt";

const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 10000);
const DEVICE_COUNT = Math.max(1, Math.min(3, Number(process.env.DEVICE_COUNT ?? 1)));

const rnd = (min, max) => min + Math.random() * (max - min);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// Definisi fleet: pack/cell berbeda antar device.
const FLEET = [
  { serial: "DEV-SIM-001", packs: [{ cells: 8 }] },
  { serial: "DEV-SIM-002", packs: [{ cells: 4 }, { cells: 4 }] },
  { serial: "DEV-SIM-003", packs: [{ cells: 16 }] },
].slice(0, DEVICE_COUNT);

// State per pack: level SoC-ish (0..1), fase, offset per-cell tetap (sumber imbalance dasar).
function initState(fleet) {
  return fleet.map((dev) => ({
    serial: dev.serial,
    packs: dev.packs.map(() => ({
      level: rnd(0.35, 0.75),
      phase: Math.random() < 0.5 ? "charge" : "discharge",
      ticksLeft: Math.floor(rnd(6, 14)),
      temp: rnd(27, 32),
      offsets: null, // diisi saat cell count diketahui
      cellCount: 0,
    })),
  }));
}

function stepPack(pack, cellCount) {
  if (pack.offsets == null || pack.cellCount !== cellCount) {
    // Offset tetap ±8 mV per cell → imbalance dasar konsisten.
    pack.offsets = Array.from({ length: cellCount }, () => rnd(-0.008, 0.008));
    pack.cellCount = cellCount;
  }

  // Ganti fase saat ticks habis (charge <-> discharge, sesekali idle).
  pack.ticksLeft -= 1;
  if (pack.ticksLeft <= 0) {
    const r = Math.random();
    pack.phase = r < 0.45 ? "charge" : r < 0.9 ? "discharge" : "idle";
    pack.ticksLeft = Math.floor(rnd(6, 16));
  }

  // Update level & arus sesuai fase (current negatif = charging).
  let current;
  if (pack.phase === "charge") {
    pack.level = clamp(pack.level + rnd(0.005, 0.02), 0.05, 0.98);
    current = -rnd(1.0, 4.0);
  } else if (pack.phase === "discharge") {
    pack.level = clamp(pack.level - rnd(0.005, 0.02), 0.05, 0.98);
    current = rnd(1.0, 4.0);
  } else {
    current = rnd(-0.03, 0.03);
  }

  const baseV = 3.25 + pack.level * 0.2; // 3.25..3.45
  // Imbalance event sesekali: satu cell menyimpang > 50 mV.
  const injectImbalance = Math.random() < 0.15;
  const badCell = injectImbalance ? Math.floor(rnd(0, cellCount)) : -1;

  const cells = [];
  for (let i = 0; i < cellCount; i++) {
    let v = baseV + pack.offsets[i] + rnd(-0.002, 0.002);
    if (i === badCell) v += (Math.random() < 0.5 ? 1 : -1) * rnd(0.055, 0.09);
    cells.push({ index: i + 1, voltage: Math.round(clamp(v, 2.5, 3.65) * 1000) / 1000 });
  }

  // Suhu random walk, naik sedikit saat arus besar.
  pack.temp = clamp(pack.temp + rnd(-0.4, 0.4) + Math.abs(current) * 0.05, 26, 40);

  const balancerConnected = injectImbalance || Math.random() < 0.6;
  const packVoltage = cells.reduce((s, c) => s + c.voltage, 0);
  const power = Math.round(packVoltage * current * 100) / 100;

  return {
    temperature: Math.round(pack.temp * 10) / 10,
    balancerConnected,
    current: Math.round(current * 100) / 100,
    power,
    cells,
  };
}

const state = initState(FLEET);
const client = mqtt.connect(MQTT_URL, { reconnectPeriod: 2000 });

client.on("connect", () => {
  console.log(`[sim] connected ${MQTT_URL} — ${FLEET.length} device, interval ${INTERVAL_MS}ms`);
  tick();
  setInterval(tick, INTERVAL_MS);
});
client.on("error", (err) => console.error("[sim] error", err.message));

function tick() {
  const timestamp = Date.now();
  for (let d = 0; d < FLEET.length; d++) {
    const dev = FLEET[d];
    const packs = dev.packs.map((p, pi) => {
      const built = stepPack(state[d].packs[pi], p.cells);
      return { index: pi + 1, ...built };
    });
    const payload = { timestamp, packs };
    const topic = `bms/${dev.serial}/data`;
    client.publish(topic, JSON.stringify(payload), { qos: 1 });
    console.log(`[sim] ${topic} packs=${packs.length} cell0=${packs[0].cells[0].voltage}V I=${packs[0].current}A`);
  }
}

process.on("SIGINT", () => {
  client.end(() => process.exit(0));
});
