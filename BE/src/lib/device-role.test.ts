import { describe, expect, it } from "vitest";
import { roleOf } from "./device-role";

const device = {
  ownerId: "u-owner",
  collaborators: [
    { userId: "u-editor", role: "editor" },
    { userId: "u-viewer", role: "viewer" },
    { userId: "u-legacy", role: "something-else" },
  ],
};

describe("roleOf", () => {
  it("mengenali owner, editor, viewer", () => {
    expect(roleOf(device, "u-owner")).toBe("owner");
    expect(roleOf(device, "u-editor")).toBe("editor");
    expect(roleOf(device, "u-viewer")).toBe("viewer");
  });
  it("nilai role tak dikenal diperlakukan sebagai viewer (paling sempit)", () => {
    expect(roleOf(device, "u-legacy")).toBe("viewer");
  });
  it("user asing tidak punya akses", () => {
    expect(roleOf(device, "u-stranger")).toBeNull();
  });
  it("device tanpa owner tidak memberi akses owner ke siapa pun", () => {
    expect(roleOf({ ownerId: null, collaborators: [] }, "u-owner")).toBeNull();
  });
});
