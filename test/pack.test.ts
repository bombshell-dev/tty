import { describe, expect, it } from "./suite.ts";
import { close, open, pack, text } from "../ops.ts";
import { createTerm } from "../term.ts";
import { createTermNative } from "../term-native.ts";

describe("pack", () => {
  it("throws a descriptive RangeError when text exceeds the transfer buffer", () => {
    let memory = new ArrayBuffer(64);
    let error: unknown;

    try {
      pack(
        [
          open("root"),
          text("x".repeat(128)),
          close(),
        ],
        memory,
        0,
        memory.byteLength,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toMatch(
      /transfer buffer|capacity|packing/,
    );
    expect((error as Error).message).toContain("text content");
    expect((error as Error).message).not.toBe("offset is out of bounds");
    expect((error as Error).message).toMatch(
      /smaller visible slice|reduce frame content/,
    );
  });

  it("throws a descriptive RangeError when an element id exceeds the transfer buffer", () => {
    let memory = new ArrayBuffer(16);
    let error: unknown;

    try {
      pack([open("x".repeat(64)), close()], memory, 0, memory.byteLength);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toMatch(
      /transfer buffer|capacity|packing/,
    );
    expect((error as Error).message).toContain("element id");
    expect((error as Error).message).not.toBe("offset is out of bounds");
  });

  it("packs a replay without copying its element's text into the transfer buffer", async () => {
    let term = await createTerm({ width: 8, height: 1 });
    let ops = [open("element"), text("x".repeat(256)), close()];
    let replay = term.render(ops).info.get("element")!.replay;
    let buffer = new ArrayBuffer(64);
    expect(() => pack(ops, buffer, 0, buffer.byteLength)).toThrow(RangeError);
    expect(() => pack([replay], buffer, 0, buffer.byteLength)).not.toThrow();
  });

  it("returns metadata and replay for an id that fills the packing budget", async () => {
    let native = await createTermNative(8, 1, {
      syncOutput: false,
      pointerShape: false,
    });
    let overhead = pack([open(""), close()], new ArrayBuffer(64), 0) * 4;
    let id = "x".repeat(native.opsCapacity - overhead);
    let term = await createTerm({ width: 8, height: 1 });
    let first = term.render([open(id), close()]).info.get(id);
    expect(first).toBeDefined();
    let next = term.render([first!.replay]);
    expect(next.output.length).toBe(0);
    expect(next.errors).toEqual([]);
    expect(next.info.get(id)?.bounds).toEqual(first!.bounds);
  });
});
