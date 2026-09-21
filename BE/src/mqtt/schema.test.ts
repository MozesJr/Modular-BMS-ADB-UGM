import { describe, expect, it } from "vitest";
import { parseBmsMessage, parseDeviceIdFromTopic, MAX_PAYLOAD_BYTES, normalizeTemperatures } from "./schema";
import { resolveRecordedAt, MAX_CLOCK_SKEW_MS } from "./timestamp";

const validPayload = () => ({
  timestamp: 1_790_000_000_000,
  packs: [
    {
      index: 0,
      temperature: 27.5,
      balancerConnected: true,
      current: -1.25,
      power: -67.3,
      cells: [
        { index: 0, voltage: 3.31 },
        { index: 1, voltage: 3.32 },
      ],
    },
  ],
});
const buf = (o: unknown) => Buffer.from(JSON.stringify(o));
const TOPIC = "bms/GAMA-BMS-PACK-001/data";

describe("parseDeviceIdFromTopic", () => {
  it("menerima topik valid", () => expect(parseDeviceIdFromTopic(TOPIC)).toBe("GAMA-BMS-PACK-001"));
  it.each(["bms//data", "bms/a/b/data", "bms/a b/data", "x/abc/data", "bms/abc/status", "bms/#/data", "bms/+/data"])(
    "menolak %s",
    (t) => expect(parseDeviceIdFromTopic(t)).toBeNull(),
  );
  it("menolak device_id > 64 karakter", () =>
    expect(parseDeviceIdFromTopic(`bms/${"a".repeat(65)}/data`)).toBeNull());
});

describe("parseBmsMessage", () => {
  it("menerima payload valid", () => {
    const r = parseBmsMessage(TOPIC, buf(validPayload()));
    expect(r.ok).toBe(true);
  });
  it("current/power opsional dan null dianggap tidak ada", () => {
    const p = validPayload();
    delete (p.packs[0] as Record<string, unknown>).power;
    (p.packs[0] as Record<string, unknown>).current = null;
    const r = parseBmsMessage(TOPIC, buf(p));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.packs[0].current).toBeUndefined();
      expect(r.payload.packs[0].power).toBeUndefined();
    }
  });
  it("membuang field asing dari hasil parse", () => {
    const p = { ...validPayload(), evil: "x" } as Record<string, unknown>;
    (p.packs as Record<string, unknown>[])[0].extra = 1;
    const r = parseBmsMessage(TOPIC, buf(p));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload).not.toHaveProperty("evil");
      expect(r.payload.packs[0]).not.toHaveProperty("extra");
    }
  });
  it("menolak JSON rusak", () => {
    const r = parseBmsMessage(TOPIC, Buffer.from("{oops"));
    expect(r).toMatchObject({ ok: false, reason: "json" });
  });
  it("menolak payload terlalu besar", () => {
    const r = parseBmsMessage(TOPIC, Buffer.alloc(MAX_PAYLOAD_BYTES + 1, 32));
    expect(r).toMatchObject({ ok: false, reason: "too_large" });
  });
  it("menolak topik tidak valid sebelum parse", () => {
    expect(parseBmsMessage("bms/x/y/data", buf(validPayload()))).toMatchObject({ ok: false, reason: "topic" });
  });
  it.each([
    ["timestamp hilang", (p: any) => delete p.timestamp],
    ["timestamp bukan integer", (p: any) => (p.timestamp = 1.5)],
    ["packs kosong", (p: any) => (p.packs = [])],
    ["packs bukan array", (p: any) => (p.packs = "x")],
    ["voltage negatif", (p: any) => (p.packs[0].cells[0].voltage = -1)],
    ["voltage tidak masuk akal", (p: any) => (p.packs[0].cells[0].voltage = 1e9)],
    ["suhu bukan angka", (p: any) => (p.packs[0].temperature = "hot")],
    ["cells kosong", (p: any) => (p.packs[0].cells = [])],
    ["index cell duplikat", (p: any) => (p.packs[0].cells[1].index = 0)],
    ["index pack duplikat", (p: any) => p.packs.push({ ...p.packs[0] })],
    ["balancerConnected bukan boolean", (p: any) => (p.packs[0].balancerConnected = "yes")],
    ["arus di luar rentang", (p: any) => (p.packs[0].current = 99999)],
  ])("menolak: %s", (_name, mutate) => {
    const p = validPayload();
    mutate(p);
    expect(parseBmsMessage(TOPIC, buf(p))).toMatchObject({ ok: false, reason: "schema" });
  });
  it("menolak lebih dari 64 cell per pack", () => {
    const p = validPayload();
    p.packs[0].cells = Array.from({ length: 65 }, (_, i) => ({ index: i, voltage: 3.3 }));
    expect(parseBmsMessage(TOPIC, buf(p)).ok).toBe(false);
  });
});

describe("suhu nullable + sensor fault (M0)", () => {
  const withTemp = (t: unknown) => {
    const p = validPayload();
    (p.packs[0] as Record<string, unknown>).temperature = t;
    return p;
  };
  const parse = (t: unknown) => {
    const r = parseBmsMessage(TOPIC, buf(withTemp(t)));
    if (!r.ok) throw new Error(`${r.reason}: ${r.detail}`);
    return r;
  };

  it("-127 (DS18B20 terlepas) -> temperature null, pesan TIDAK ditolak, tegangan cell tetap ada", () => {
    const r = parse(-127);
    expect(r.payload.packs[0].temperature).toBeNull();
    expect(r.sensorFaults).toBe(1);
    expect(r.payload.packs[0].cells).toHaveLength(2);
    expect(r.payload.packs[0].cells[0].voltage).toBe(3.31);
  });
  it.each([500, 150.5, -60.5, -1000])("%s di luar rentang -> sensor fault", (t) => {
    const r = parse(t);
    expect(r.payload.packs[0].temperature).toBeNull();
    expect(r.sensorFaults).toBe(1);
  });
  it.each([-60, 0, 25.5, 85, 150])("%s dalam rentang -> dipertahankan, bukan fault", (t) => {
    const r = parse(t);
    expect(r.payload.packs[0].temperature).toBe(t);
    expect(r.sensorFaults).toBe(0);
  });
  it("null atau dihilangkan = tidak ada pembacaan (bukan fault)", () => {
    const a = parse(null);
    expect(a.payload.packs[0].temperature).toBeNull();
    expect(a.sensorFaults).toBe(0);
    const p = validPayload();
    delete (p.packs[0] as Record<string, unknown>).temperature;
    const b = parseBmsMessage(TOPIC, buf(p));
    expect(b.ok && b.payload.packs[0].temperature).toBeNull();
  });
  it("menghitung fault per pack", () => {
    const p = validPayload();
    p.packs.push({ ...p.packs[0], index: 1, temperature: -127 } as (typeof p.packs)[number]);
    p.packs.push({ ...p.packs[0], index: 2, temperature: 999 } as (typeof p.packs)[number]);
    const r = parseBmsMessage(TOPIC, buf(p));
    expect(r.ok && r.sensorFaults).toBe(2);
  });
  it("normalizeTemperatures tidak mengubah objek asal", () => {
    const r = parse(25);
    const before = JSON.stringify(r.payload);
    normalizeTemperatures(r.payload);
    expect(JSON.stringify(r.payload)).toBe(before);
  });
});

describe("resolveRecordedAt", () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  it("memakai jam device bila selisih wajar", () => {
    const r = resolveRecordedAt(now.getTime() - 2000, now);
    expect(r.source).toBe("device");
    expect(r.recordedAt.getTime()).toBe(now.getTime() - 2000);
  });
  it("memakai waktu server bila jam device jauh tertinggal (mis. 1970 / millis boot)", () => {
    expect(resolveRecordedAt(123456, now)).toEqual({ recordedAt: now, source: "server" });
  });
  it("memakai waktu server bila jam device jauh di masa depan", () => {
    expect(resolveRecordedAt(now.getTime() + MAX_CLOCK_SKEW_MS + 1, now).source).toBe("server");
  });
  it("batas tepat 5 menit masih dipercaya", () => {
    expect(resolveRecordedAt(now.getTime() - MAX_CLOCK_SKEW_MS, now).source).toBe("device");
  });
});
