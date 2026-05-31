import { describe, expect, it } from "./suite.ts";
import { close, open, pack, text } from "../ops.ts";

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
});
