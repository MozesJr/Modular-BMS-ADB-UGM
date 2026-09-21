// npm run mqtt:schema -> menulis ../docs/mqtt-payload.schema.json (untuk tim firmware).
import { writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { BmsDevicePayloadSchema } from "../src/mqtt/schema";

const schema = z.toJSONSchema(BmsDevicePayloadSchema, { io: "input" });
const out = path.resolve(__dirname, "../../docs/mqtt-payload.schema.json");
writeFileSync(out, JSON.stringify(schema, null, 2) + "\n");
console.log("ditulis:", out);
