// Logger JSON satu-baris (mudah di-grep / dikirim ke agregator). Jangan pernah memasukkan
// secret, token, password, atau isi payload mentah ke `fields`.
type Level = "info" | "warn" | "error";

function serializeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { message: String(err) };
}

function emit(level: Level, event: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
    ...(fields && "err" in fields ? { err: serializeError(fields.err) } : {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
