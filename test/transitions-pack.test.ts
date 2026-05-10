import { describe, expect, it } from "./suite.ts";
import { close, open, pack } from "../mod.ts";

describe("pack transition", () => {
  it("encodes a transition without throwing", () => {
    let mem = new ArrayBuffer(4096);
    let len = pack(
      [
        open("a", {
          transition: {
            duration: 0.2,
            easing: "easeOut",
            properties: ["x", "bg"],
          },
        }),
        close(),
      ],
      mem,
      0,
      4096,
    );
    expect(len).toBeGreaterThan(0);
  });

  it("writes a longer buffer when a transition is present", () => {
    let mem1 = new ArrayBuffer(4096);
    let withoutLen = pack([open("a", {}), close()], mem1, 0, 4096);
    let mem2 = new ArrayBuffer(4096);
    let withLen = pack(
      [
        open("a", { transition: { duration: 0.2, properties: ["x"] } }),
        close(),
      ],
      mem2,
      0,
      4096,
    );
    expect(withLen).toBeGreaterThan(withoutLen);
    // The transition block is exactly 8 bytes = 2 words.
    expect(withLen - withoutLen).toBe(2);
  });
});
