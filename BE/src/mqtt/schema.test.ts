import { describe, expect, it } from "vitest";
import { parseBmsMessage, parseDeviceIdFromTopic, MAX_PAYLOAD_BYTES } from "./schema";
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
    ["suhu di luar rentang", (p: any) => (p.packs[0].temperature = 500)],
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
