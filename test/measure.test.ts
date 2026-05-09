import { describe, expect, it } from "./suite.ts";
import {
  close,
  createTerm,
  fixed,
  grow,
  measureCellWidth,
  measureWrappedHeight,
  open,
  text,
  wrapText,
} from "../mod.ts";
import { createTermNative } from "../term-native.ts";
import { print } from "./print.ts";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function makeOversizedDocument(memoryBytes: number) {
  let targetBytes = memoryBytes * 2 + 65_536;
  let encoder = new TextEncoder();
  let lines: string[] = [];
  let bytes = 0;
  for (let i = 0; bytes < targetBytes; i++) {
    let line = `line-${i.toString().padStart(6, "0")} 🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂`;
    lines.push(line);
    bytes += encoder.encode(line + "\n").length;
  }
  return { content: lines.join("\n"), lines, bytes };
}

describe("text measurement helpers", () => {
  it("exports helpers that can be called without creating a Term", () => {
    expect(measureCellWidth("hello")).toBe(5);
    expect(wrapText("hello world", 5).map((l) => l.text)).toEqual([
      "hello",
      "world",
    ]);
    expect(measureWrappedHeight("hello world", 5)).toBe(2);
  });

  it("measures ASCII, combining marks, and wide characters", () => {
    expect(measureCellWidth("hello")).toBe(5);
    expect(measureCellWidth("e\u0301")).toBe(1);
    expect(measureCellWidth("文字")).toBe(4);
    expect(measureCellWidth("🙂")).toBe(2);
  });

  it("supports words, newlines, and none wrap modes", () => {
    expect(wrapText("hello world", 5)).toEqual([
      { text: "hello", width: 5 },
      { text: "world", width: 5 },
    ]);
    expect(wrapText("hello world", 5, { mode: "words" })).toEqual(
      wrapText("hello world", 5),
    );

    expect(wrapText("hello world\nwide", 5, { mode: "newlines" })).toEqual([
      { text: "hello world", width: 11 },
      { text: "wide", width: 4 },
    ]);

    expect(wrapText("hello\nworld", 5, { mode: "none" })).toEqual([
      { text: "helloworld", width: 10 },
    ]);
  });

  it("keeps measureWrappedHeight equal to wrapText length", () => {
    for (let mode of ["words", "newlines", "none"] as const) {
      let input = "one two three\nfour five";
      expect(measureWrappedHeight(input, 7, { mode })).toBe(
        wrapText(input, 7, { mode }).length,
      );
    }
  });

  it("handles empty input deterministically", () => {
    expect(measureCellWidth("")).toBe(0);
    expect(wrapText("", 10)).toEqual([]);
    expect(measureWrappedHeight("", 10)).toBe(0);
  });

  it("rejects invalid widths", () => {
    for (let width of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => wrapText("x", width)).toThrow(RangeError);
      expect(() => measureWrappedHeight("x", width)).toThrow(RangeError);
    }
  });

  it("does not instantiate WebAssembly or UTF-8 encode as a precondition for measurement", () => {
    let instantiate = WebAssembly.instantiate;
    let encode = TextEncoder.prototype.encode;
    try {
      WebAssembly.instantiate = (() => {
        throw new Error("unexpected wasm instantiate");
      }) as typeof WebAssembly.instantiate;
      TextEncoder.prototype.encode = function () {
        throw new Error("unexpected text encode");
      };

      expect(measureCellWidth("hello 🙂")).toBe(8);
      expect(measureWrappedHeight("hello world", 5)).toBe(2);
      expect(wrapText("hello world", 5).length).toBe(2);
    } finally {
      WebAssembly.instantiate = instantiate;
      TextEncoder.prototype.encode = encode;
    }
  });

  it("renders a visible window from a UTF-8 document larger than 2x renderer memory", async () => {
    let native = await createTermNative(80, 24);
    let document = makeOversizedDocument(native.memory.buffer.byteLength);
    expect(document.bytes).toBeGreaterThan(native.memory.buffer.byteLength * 2);

    let term = await createTerm({ width: 80, height: 24 });
    let error: unknown;
    try {
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        text(document.content),
        close(),
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toMatch(
      /transfer buffer|capacity|packing/,
    );
    expect((error as Error).message).not.toBe("offset is out of bounds");
    expect((error as Error).message).toMatch(
      /smaller visible slice|reduce frame content/,
    );

    expect(measureWrappedHeight(document.content, 80, { mode: "newlines" }))
      .toBe(document.lines.length);

    let start = Math.floor(document.lines.length / 2);
    let visible = document.lines.slice(start, start + 3).join("\n");
    let out = print(
      decode(
        term.render([
          open("root", {
            layout: { width: fixed(80), height: fixed(24), direction: "ttb" },
          }),
          text(visible),
          close(),
        ]).output,
      ),
      80,
      24,
    );

    let marker = (index: number) => document.lines[index].slice(0, 11);
    expect(out).toContain(marker(start));
    expect(out).toContain(marker(start + 2));
    expect(out).not.toContain(marker(start - 1));
    expect(out).not.toContain(marker(start + 3));
  });
});
