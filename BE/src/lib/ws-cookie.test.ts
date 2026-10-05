import { describe, expect, it } from "vitest";
import { decode, encode } from "next-auth/jwt";
import { extractSessionCookie } from "./ws-auth";

const secret = "s".repeat(40);

describe("cookie sesi Auth.js untuk /ws", () => {
  it("JWT yang diterbitkan Auth.js (salt = nama cookie) bisa didekode seperti di ws-runtime", async () => {
    for (const name of ["authjs.session-token", "__Secure-authjs.session-token"]) {
      const token = await encode({ token: { id: "u1", tv: 2 }, secret, salt: name, maxAge: 60 });
      const header = `foo=bar; ${name}=${token}; baz=1`;
      const found = extractSessionCookie(header);
      expect(found?.name).toBe(name);
      const decoded = await decode({ token: found!.value, secret, salt: found!.name });
      expect(decoded?.id).toBe("u1");
      expect(decoded?.tv).toBe(2);
      expect(typeof decoded?.exp).toBe("number");
    }
  });
  it("secret salah atau salt salah -> tidak valid", async () => {
    const token = await encode({ token: { id: "u1" }, secret, salt: "authjs.session-token", maxAge: 60 });
    await expect(decode({ token, secret: "x".repeat(40), salt: "authjs.session-token" })).rejects.toThrow();
    await expect(decode({ token, secret, salt: "__Secure-authjs.session-token" })).rejects.toThrow();
  });
  it("cookie yang dipecah (.0/.1) digabung; tanpa cookie sesi -> null", () => {
    expect(extractSessionCookie("authjs.session-token.0=abc; authjs.session-token.1=def")).toEqual({
      name: "authjs.session-token",
      value: "abcdef",
    });
    expect(extractSessionCookie("a=b; c=d")).toBeNull();
    expect(extractSessionCookie(undefined)).toBeNull();
  });
});
