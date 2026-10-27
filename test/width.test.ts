import { describe, expect, it } from "./suite.ts";
import { createTerm } from "../term.ts";
import { close, fixed, grow, open, pack, text } from "../ops.ts";
import { createTermNative } from "../term-native.ts";
import { print } from "./print.ts";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const trim = (s: string) =>
  s.split("\n").map((line) => line.trimEnd()).join("\n");

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
  let frame = (content: string) => [
    open("root", {
      layout: { width: grow(), height: grow(), direction: "ttb" },
    }),
    text(content),
    close(),
  ];

  it("cleans up wide cells after unchanged frames and repeated narrow replacements", async () => {
    let term = await createTerm({ width: 6, height: 1 });
    let ansi = "";
    for (let i = 0; i < 3; i++) {
      ansi += decode(term.render(frame("中中")).output);
      let unchanged = term.render(frame("中中"));
      expect(unchanged.output.length).toBe(0);
      ansi += decode(term.render(frame("ab")).output);
      expect(trim(print(ansi, 6, 1))).toEqual("ab");
      expect(term.render(frame("ab")).output.length).toBe(0);
    }
  });

  it("uses a wide line-mode frame as the baseline for CUP diffs", async () => {
    let term = await createTerm({ width: 6, height: 1 });
    let ansi = decode(term.render(frame("中中"), { mode: "line" }).output);
    expect(term.render(frame("中中")).output.length).toBe(0);
    ansi += decode(term.render(frame("abcd")).output);
    expect(trim(print(ansi, 6, 1))).toEqual("abcd");

    ansi += decode(term.render(frame("a")).output);
    expect(trim(print(ansi, 6, 1))).toEqual("a");
    expect(term.render(frame("a")).output.length).toBe(0);
  });

  it("blanks a wide glyph at the terminal edge and accepts its narrow replacement", async () => {
    for (let mode of [undefined, "line"] as const) {
      let term = await createTerm({ width: 3, height: 1 });
      let edge = (content: string) => [
        open("root", {
          layout: { width: fixed(8), height: fixed(1) },
        }),
        text(content),
        close(),
      ];
      let ansi = decode(term.render(edge("ab中"), { mode }).output);
      expect(trim(print(ansi, 3, 1))).toEqual("ab");
      expect(term.render(edge("ab中")).output.length).toBe(0);
      ansi += decode(term.render(edge("abc")).output);
      expect(trim(print(ansi, 3, 1))).toEqual("abc");
    }
  });

  it("keeps a wide glyph outside a clip from overwriting its sibling", async () => {
    let term = await createTerm({ width: 6, height: 1 });
    let clipped = (content: string) => [
      open("root", {
        layout: { width: grow(), height: grow(), direction: "ltr" },
      }),
      open("clip", {
        layout: { width: fixed(2), height: fixed(1) },
        clip: { horizontal: true, vertical: true },
      }),
      open("content", {
        layout: { width: fixed(8), height: fixed(1) },
      }),
      text(content),
      close(),
      close(),
      open("sibling", { layout: { width: fixed(1), height: fixed(1) } }),
      text("!"),
      close(),
      close(),
    ];
    let ansi = decode(term.render(clipped("ab中")).output);
    expect(trim(print(ansi, 6, 1))).toEqual("ab!");
    expect(term.render(clipped("ab中")).output.length).toBe(0);
    ansi += decode(term.render(clipped("x")).output);
    expect(trim(print(ansi, 6, 1))).toEqual("x !");
  });

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
});
