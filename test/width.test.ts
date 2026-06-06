import { beforeEach, describe, expect, it } from "./suite.ts";
import { createTerm, type Term } from "../term.ts";
import { close, fixed, grow, open, pack, text } from "../ops.ts";
import { createTermNative } from "../term-native.ts";
import { print } from "./print.ts";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

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
    let native = await createTermNative(10, 3);

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

    native.reduce(native.statePtr, native.opsBuf, len, 0, 1, 0);
    let out = new Uint8Array(
      native.memory.buffer,
      native.output(native.statePtr),
      native.length(native.statePtr),
    );

    // the invalid sequence must never reach the terminal
    expect(indexOfSeq(out, [0xed, 0xa0, 0x80])).toBe(-1);
    expect(print(decode(out), 10, 3)).toContain("a�b");
  });
});

describe("wide characters", () => {
  let term: Term;
  beforeEach(async () => {
    term = await createTerm({ width: 12, height: 1 });
  });

  it("overlay on a wide char's trailing column clears the orphaned lead to a space", () => {
    // X is floated onto col 1, the trailing column of 你 (cols 0-1).
    let out = print(
      decode(
        term.render([
          open("root", { layout: { width: grow(), height: grow() } }),
          text("你好"),
          open("ov", {
            floating: { x: 1, y: 0, attachTo: "root" },
            layout: { width: fixed(1), height: fixed(1) },
          }),
          text("X"),
          close(),
          close(),
        ]).output,
      ),
      12,
      1,
    );
    // half-overwritten 你 collapses to a space, X lands at col 1, 好 untouched at 2-3.
    expect(out).toBe(" X好         ");
  });

  it("emits an explicit byte for an overlay landing on a placeholder column", () => {
    let ansi = decode(
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        text("你好"),
        open("ov", {
          floating: { x: 1, y: 0, attachTo: "root" },
          layout: { width: fixed(1), height: fixed(1) },
        }),
        text("X"),
        close(),
        close(),
      ]).output,
    );
    // the overlay glyph reaches the byte stream rather than being swallowed by the column skip.
    expect(ansi).toContain("X");
  });
});
