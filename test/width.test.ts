import { describe, expect, it } from "./suite.ts";
import { createTerm } from "../term.ts";
import { close, grow, type Op, open, pack, text } from "../ops.ts";
import { createTermNative } from "../term-native.ts";
import { print } from "./print.ts";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const trim = (s: string) => s.split("\n").map((l) => l.trimEnd()).join("\n");

// Two distinct strings whose measurement-cache hashes collide under the
// default text config. Each must still measure and draw as itself.
const SHORT = "synthetic sample synthetic sample synthetic sample 022aa2";
const LONG =
  "synthetic sample synthetic sample synthetic sample synthetic sample synthetic sample 01fda4";

// Clay_ErrorType value, mirrored by ERROR_TYPES in term.ts
const TEXT_MEASUREMENT_CAPACITY_EXCEEDED = 3;

function boxes(contents: string[]): Op[] {
  return [
    open("root", {
      layout: { width: grow(), height: grow(), direction: "ttb" },
    }),
    ...contents.flatMap((content, i) => [
      open(`box-${i}`),
      text(content),
      close(),
    ]),
    close(),
  ];
}

// The visible picture of boxes(contents) on a w x h grid.
function picture(contents: string[], w: number, h: number): string {
  let lines = contents.slice(0, h).map((c) => c.slice(0, w));
  while (lines.length < h) lines.push("");
  return lines.join("\n");
}

function indexOfSeq(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

describe("width", () => {
  it("measures non-printable codepoints as one replacement cell", async () => {
    let term = await createTerm({ width: 20, height: 4 });

    // U+FDD0 is a noncharacter: wcwidth() reports it non-printable and the
    // renderer emits it as U+FFFD in a single cell, so measurement must
    // count it as one cell too or fit-sized boxes end up too narrow.
    let result = term.render([
      open("root", {
        layout: { width: grow(), height: grow(), direction: "ttb" },
      }),
      open("box"),
      text("a﷐b"),
      close(),
      close(),
    ]);

    expect(result.info.get("box")?.bounds.width).toBe(3);
  });

  it("renders a noncharacter as a single replacement cell", async () => {
    let term = await createTerm({ width: 20, height: 4 });

    let out = print(
      decode(
        term.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          text("a﷐b"),
          close(),
        ]).output,
      ),
      20,
      4,
    );

    expect(out).toContain("a�b");
  });

  it("replaces surrogate codepoints from malformed UTF-8 with U+FFFD", async () => {
    let native = await createTermNative(10, 3, {
      syncOutput: false,
      pointerShape: false,
    });

    // TextEncoder never produces surrogate bytes, so pack a placeholder
    // (U+1234 = E1 88 B4) and patch it to CESU-8 U+D800 (ED A0 80) to
    // reach the decoder the way a malformed C-side buffer would.
    let ops = [
      open("root", {
        layout: { width: grow(), height: grow(), direction: "ttb" },
      }),
      text("aሴb"),
      close(),
    ];
    let len = pack(
      ops,
      native.memory.buffer,
      native.opsBuf,
      native.memory.buffer.byteLength,
    );
    // pack() returns a length in 32-bit words
    let buf = new Uint8Array(native.memory.buffer, native.opsBuf, len * 4);
    let at = indexOfSeq(buf, [0xe1, 0x88, 0xb4]);
    expect(at).toBeGreaterThan(-1);
    buf[at] = 0xed;
    buf[at + 1] = 0xa0;
    buf[at + 2] = 0x80;

    native.reduce(native.statePtr, native.opsBuf, len, 0, 1, 0, 0, 0, 0);
    let out = new Uint8Array(
      native.memory.buffer,
      native.output(native.statePtr),
      native.length(native.statePtr),
    );

    // the invalid sequence must never reach the terminal
    expect(indexOfSeq(out, [0xed, 0xa0, 0x80])).toBe(-1);
    expect(print(decode(out), 10, 3)).toContain("a�b");
  });

  describe("measurement cache", () => {
    it("measures colliding strings as themselves in one frame", async () => {
      let term = await createTerm({ width: 100, height: 3 });
      let result = term.render(boxes([SHORT, LONG]));

      expect(SHORT.length).toBe(57);
      expect(LONG.length).toBe(91);
      expect(result.info.get("box-0")?.bounds.width).toBe(57);
      expect(result.info.get("box-1")?.bounds.width).toBe(91);
      expect(trim(print(decode(result.output), 100, 3))).toEqual(
        [SHORT, LONG, ""].join("\n"),
      );
    });

    it("measures colliding strings as themselves across renders", async () => {
      let term = await createTerm({ width: 100, height: 3 });
      let screen = "";

      for (let content of [SHORT, LONG, SHORT]) {
        let result = term.render(boxes([content]));
        screen += decode(result.output);
        expect(result.info.get("box-0")?.bounds.width).toBe(content.length);
        expect(trim(print(screen, 100, 3))).toEqual(
          picture([content], 100, 3),
        );
      }
    });

    it("reuses text across renders that exhaust retained key storage", async () => {
      let term = await createTerm({ width: 186, height: 40 });
      let pass = (n: number) =>
        Array.from(
          { length: 390 },
          (_, i) => `${n}-${String(i).padStart(4, "0")}${"x".repeat(4994)}`,
        );

      // each pass retains ~2MB of distinct text; the second cannot fit
      // beside the first, and the third reuses the second
      let screen = "";
      for (let contents of [pass(0), pass(1), pass(1), pass(0)]) {
        let result = term.render(boxes(contents));
        screen += decode(result.output);
        expect(result.errors).toEqual([]);
        expect(result.info.get("box-0")?.bounds.width).toBe(5000);
        expect(result.info.get("box-389")?.bounds.width).toBe(5000);
        expect(trim(print(screen, 186, 40))).toEqual(
          picture(contents, 186, 40),
        );
      }

      let result = term.render(boxes([SHORT, LONG]));
      expect(result.info.get("box-0")?.bounds.width).toBe(57);
      expect(result.info.get("box-1")?.bounds.width).toBe(91);
    });

    it("lays out a frame larger than retained key storage after a resize", async () => {
      let term = await createTerm({ width: 400, height: 100 });
      term.update([{ type: "resize", width: 186, height: 40 }]);
      let contents = Array.from(
        { length: 430 },
        (_, i) => `${i}${"x".repeat(5000)}`,
      );

      let screen = "";
      for (let round = 0; round < 2; round++) {
        let result = term.render(boxes(contents));
        screen += decode(result.output);
        expect(result.errors).toEqual([]);
        expect(result.info.get("box-429")?.bounds.width).toBe(5003);
        expect(trim(print(screen, 186, 40))).toEqual(
          picture(contents, 186, 40),
        );
      }

      let result = term.render(boxes([SHORT, LONG]));
      screen += decode(result.output);
      expect(result.info.get("box-0")?.bounds.width).toBe(57);
      expect(result.info.get("box-1")?.bounds.width).toBe(91);
      expect(trim(print(screen, 186, 40))).toEqual(
        picture([SHORT, LONG], 186, 40),
      );
    });

    it("leaves the packed frame intact when measurement capacity runs out", async () => {
      let native = await createTermNative(186, 40, {
        syncOutput: false,
        pointerShape: false,
      });
      let ops = [
        open("root", { layout: { direction: "ttb" } }),
        open("words"),
        text("a ".repeat(20000)),
        close(),
        open("long"),
        text("z".repeat(1100000)),
        close(),
        close(),
      ];
      let len = pack(
        ops,
        native.memory.buffer,
        native.opsBuf,
        native.memory.buffer.byteLength,
      );
      // pack() returns a length in 32-bit words
      let before = new Uint8Array(native.memory.buffer, native.opsBuf, len * 4)
        .slice();

      native.reduce(native.statePtr, native.opsBuf, len, 0, 1, 0, 0, 0, 0);

      let after = new Uint8Array(native.memory.buffer, native.opsBuf, len * 4);
      expect(after).toEqual(before);
      let count = native.errorCount(native.statePtr);
      for (let i = 0; i < count; i++) {
        expect(native.errorType(native.statePtr, i)).toBe(
          TEXT_MEASUREMENT_CAPACITY_EXCEEDED,
        );
      }

      let replacement = await createTerm({ width: 100, height: 3 });
      let result = replacement.render(boxes([SHORT, LONG]));
      expect(result.info.get("box-0")?.bounds.width).toBe(57);
      expect(result.info.get("box-1")?.bounds.width).toBe(91);
    });
  });
});
