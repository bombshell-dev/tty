// deno-lint-ignore-file no-control-regex
import { beforeEach, describe, expect, it } from "./suite.ts";
import { createTerm, type Term } from "../term.ts";
import {
  close,
  fixed,
  grow,
  type Op,
  open,
  rgba,
  snapshot,
  text,
} from "../ops.ts";
import { print } from "./print.ts";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const trim = (s: string) => s.split("\n").map((l) => l.trimEnd()).join("\n");

describe("term", () => {
  let term: Term;

  beforeEach(async () => {
    term = await createTerm({ width: 40, height: 10 });
  });

  it("renders hello world", () => {
    let out = print(
      decode(
        term.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          text("Hello, World!"),
          close(),
        ]).output,
      ),
      40,
      10,
    );

    expect(out).toContain("Hello, World!");
  });

  it("text inherits parent background", () => {
    let ansi = decode(
      term.render([
        open("root", {
          layout: { width: grow(), height: grow(), direction: "ttb" },
          bg: rgba(255, 0, 0),
        }),
        text("hi"),
        close(),
      ]).output,
    );

    // the SGR active when "h" is emitted should include the
    // parent's red background (48;2;255;0;0), not terminal default
    let before = ansi.slice(0, ansi.indexOf("h"));
    expect(before).toContain("\x1b[48;2;255;0;0");
  });

  it("renders borders and padding", () => {
    let out = print(
      decode(
        term.render([
          open("box", {
            layout: {
              width: grow(),
              height: grow(),
              padding: { left: 5, top: 5 },
              direction: "ttb",
            },
            border: {
              color: rgba(0, 255, 0),
              left: 1,
              right: 1,
              top: 1,
              bottom: 1,
            },
            cornerRadius: { tl: 1, tr: 1, bl: 1, br: 1 },
          }),
          text("padded"),
          close(),
        ]).output,
      ),
      40,
      10,
    );

    expect(out).toEqual(`
╭──────────────────────────────────────╮
│                                      │
│                                      │
│                                      │
│                                      │
│                                      │
│     padded                           │
│                                      │
│                                      │
╰──────────────────────────────────────╯`.trim());
  });

  describe("line mode", () => {
    let box = (msg: string) => [
      open("root", {
        layout: { width: grow(), height: grow(), direction: "ttb" },
      }),
      open("box", {
        layout: {
          width: grow(),
          height: grow(),
          direction: "ttb",
        },
        border: {
          color: rgba(255, 255, 255),
          left: 1,
          right: 1,
          top: 1,
          bottom: 1,
        },
      }),
      text(msg),
      close(),
      close(),
    ];

    it("renders with newlines instead of CUP sequences", async () => {
      let term = await createTerm({ width: 20, height: 5 });

      let out = decode(
        term.render(box("hello world"), { mode: "line" }).output,
      );

      expect(out).not.toMatch(/\x1b\[\d+;\d+H/);
      expect(out.split("\n").length).toBe(5);
      expect(trim(print(out, 20, 5))).toEqual(`
┌──────────────────┐
│hello world       │
│                  │
│                  │
└──────────────────┘`.trim());
    });

    it("primes front buffer for subsequent diff render", async () => {
      let term = await createTerm({ width: 20, height: 5 });

      let first = decode(
        term.render(box("hello world"), { mode: "line" }).output,
      );
      let second = decode(term.render(box("goodbye")).output);

      expect(trim(print(first + second, 20, 5))).toEqual(`
┌──────────────────┐
│goodbye           │
│                  │
│                  │
└──────────────────┘`.trim());

      expect(second.length).toBeLessThan(first.length);
    });
  });

  describe("info", () => {
    it("returns bounds for named elements", async () => {
      let term = await createTerm({ width: 40, height: 10 });
      let result = term.render([
        open("root", {
          layout: { width: grow(), height: grow(), direction: "ttb" },
        }),
        open("child", {
          layout: { width: fixed(20), height: fixed(5) },
        }),
        close(),
        close(),
      ]);

      let root = result.info.get("root");
      expect(root).toBeDefined();
      expect(root!.bounds).toEqual({ x: 0, y: 0, width: 40, height: 10 });

      let child = result.info.get("child");
      expect(child).toBeDefined();
      expect(child!.bounds).toEqual({ x: 0, y: 0, width: 20, height: 5 });
    });

    it("returns undefined for unknown ids", async () => {
      let term = await createTerm({ width: 20, height: 5 });
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        close(),
      ]);

      let result = term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        close(),
      ]);

      expect(result.info.get("nonexistent")).toBeUndefined();
      expect(result.info.get("")).toBeUndefined();
    });
  });

  it("renders a floating frame with structured attach points", () => {
    let out = print(
      decode(
        term.render([
          open("root", {
            layout: { width: fixed(40), height: fixed(10), direction: "ttb" },
          }),
          open("frame", {
            layout: {
              width: fixed(12),
              height: fixed(5),
              direction: "ttb",
            },
            border: {
              color: rgba(255, 255, 255),
              left: 1,
              right: 1,
              top: 1,
              bottom: 1,
            },
            floating: {
              x: 3,
              y: 1,
              attachTo: "root",
              attachPoints: {
                element: "center-center",
                parent: "center-center",
              },
            },
          }),
          text("box"),
          close(),
          close(),
        ]).output,
      ),
      40,
      10,
    );

    expect(out).toContain("│box       │");
    expect(out).toContain("┌──────────┐");
  });

  describe("snapshot", () => {
    it("produces identical output to direct ops", async () => {
      let ops = [
        open("root", {
          layout: { width: grow(), height: grow(), direction: "ttb" },
          bg: rgba(0, 0, 128),
        }),
        open("child", {
          layout: {
            width: grow(),
            padding: { left: 1 },
            direction: "ttb",
          },
          border: {
            color: rgba(255, 255, 255),
            left: 1,
            right: 1,
            top: 1,
            bottom: 1,
          },
        }),
        text("snapshot test"),
        close(),
        close(),
      ];

      let direct = await createTerm({ width: 40, height: 10 });
      let snapped = await createTerm({ width: 40, height: 10 });

      let expected = direct.render(ops, { mode: "line" }).output;
      let actual = snapped.render([snapshot(ops)], { mode: "line" }).output;

      expect(decode(actual)).toEqual(decode(expected));
    });

    it("renders inside another element", async () => {
      let child = snapshot([
        open("child", {
          layout: { width: grow(), direction: "ttb" },
        }),
        text("inner"),
        close(),
      ]);

      let direct = await createTerm({ width: 20, height: 5 });
      let snapped = await createTerm({ width: 20, height: 5 });

      let wrapper = (content: Op[]) => [
        open("root", {
          layout: {
            width: grow(),
            height: grow(),
            direction: "ttb",
          },
          border: {
            color: rgba(255, 255, 255),
            left: 1,
            right: 1,
            top: 1,
            bottom: 1,
          },
        }),
        ...content,
        close(),
      ];

      let expected = direct.render(
        wrapper([
          open("child", {
            layout: { width: grow(), direction: "ttb" },
          }),
          text("inner"),
          close(),
        ]),
        { mode: "line" },
      ).output;

      let actual = snapped.render(
        wrapper([child]),
        { mode: "line" },
      ).output;

      expect(decode(actual)).toEqual(decode(expected));
      expect(trim(print(decode(actual), 20, 5))).toEqual(`
┌──────────────────┐
│inner             │
│                  │
│                  │
└──────────────────┘`.trim());
    });
  });

  describe("caret placement", () => {
    // These tests use `print()`, which marks the terminal's final
    // cursor position by appending U+0332 COMBINING LOW LINE to that
    // cell's base character (so the underlying char is preserved and
    // the underline spans its rendered width, including wide chars).

    it("renders the caret at the declared offset", async () => {
      let t = await createTerm({ width: 6, height: 1 });
      let ansi = decode(
        t.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          // caret at code-point 2 sits before the first 'l' — that 'l'
          // is the underlined cell.
          text("Hello", { caret: 2 }),
          close(),
        ]).output,
      );
      expect(trim(print(ansi, 6, 1))).toEqual("Hel̲lo");
    });

    it("uses the first caret declaration when multiple are present", async () => {
      let t = await createTerm({ width: 2, height: 2 });
      let ansi = decode(
        t.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          text("AA", { caret: 1 }),
          text("BB", { caret: 2 }),
          close(),
        ]).output,
      );
      // First caret wins: offset 1 of "AA" → underline the second 'A'.
      // No caret marker appears anywhere in "BB".
      expect(trim(print(ansi, 2, 2))).toEqual(`\
AA̲
BB`);
    });

    it("accounts for wide characters when positioning the caret", async () => {
      let t = await createTerm({ width: 5, height: 1 });
      let ansi = decode(
        t.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          // 中 is a 2-cell wide char. Caret at offset 1 sits after 中,
          // on 'h' at col 3. The extra space between 中 and h in the
          // grid is 中's trailing half (the emulator's grid stores each
          // codepoint in one cell regardless of wcwidth).
          text("中hi", { caret: 1 }),
          close(),
        ]).output,
      );
      expect(trim(print(ansi, 5, 1))).toEqual("中 h̲i");
    });

    it("places the caret on the correct wrapped line", async () => {
      let t = await createTerm({ width: 5, height: 2 });
      let ansi = decode(
        t.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          // "hello world" wraps to "hello" / "world" at width 5.
          // Code-point 7 is the second 'o' of "world" — caret on it.
          text("hello world", { caret: 7 }),
          close(),
        ]).output,
      );
      expect(trim(print(ansi, 5, 2))).toEqual(`\
hello
wo̲rld`);
    });

    it("snaps to the next wrapped line for a caret at the wrap seam", async () => {
      let t = await createTerm({ width: 5, height: 2 });
      let ansi = decode(
        t.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          // The space between "hello" and "world" is on the wrap seam.
          // Code-point 6 ('w') starts the second line; the caret lands
          // there rather than orphaned off the end of the first line.
          text("hello world", { caret: 6 }),
          close(),
        ]).output,
      );
      expect(trim(print(ansi, 5, 2))).toEqual(`\
hello
w̲orld`);
    });

    it("places the caret at the start of a wrapped line when whitespace is consumed", async () => {
      let t = await createTerm({ width: 6, height: 2 });
      let ansi = decode(
        t.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          // "abc def" wraps to "abc" / "def" at width 6. Code-point 4
          // ('d') starts the second line; the dropped space between
          // words is handled by the pre-check that snaps the caret to
          // the slice origin when the slice's first byte is past the
          // target.
          text("abc def", { caret: 4 }),
          close(),
        ]).output,
      );
      expect(trim(print(ansi, 6, 2))).toEqual(`\
abc
d̲ef`);
    });

    it("snaps to the next wrapped line before a wide char at the wrap seam", async () => {
      // "hi 中x" at width 4 wraps to "hi" / "中x". Caret before 中 snaps
      // through the dropped space to the origin of the wrapped line
      // and underlines the wide char.
      let t = await createTerm({ width: 4, height: 2 });
      let ansi = decode(
        t.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          text("hi 中x", { caret: 3 }),
          close(),
        ]).output,
      );
      expect(trim(print(ansi, 4, 2))).toEqual(`\
hi
中̲ x`);
    });

    it("advances past a wide char when placing the caret on a wrapped line", async () => {
      // "hi 中x" at width 4 wraps to "hi" / "中x". Caret at offset 4
      // (after 中, before x) — the render walk correctly advances by
      // wcwidth(中)=2 and underlines x's cell.
      let t = await createTerm({ width: 4, height: 2 });
      let ansi = decode(
        t.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          text("hi 中x", { caret: 4 }),
          close(),
        ]).output,
      );
      expect(trim(print(ansi, 4, 2))).toEqual(`\
hi
中 x̲`);
    });

    it("places the caret one past the last char after a wrapped wide-char line", async () => {
      // "hi 中x" at width 4 wraps to "hi" / "中x". Caret at offset 5
      // (end-of-content) — the trailing-cell fallback puts the caret
      // one cell past 'x' (underlining the trailing space).
      let t = await createTerm({ width: 4, height: 2 });
      let ansi = decode(
        t.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          text("hi 中x", { caret: 5 }),
          close(),
        ]).output,
      );
      expect(trim(print(ansi, 4, 2))).toEqual(`\
hi
中 x ̲`);
    });

    it("places the caret one cell past the last character when offset == length", async () => {
      let t = await createTerm({ width: 4, height: 1 });
      let ansi = decode(
        t.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          text("Hi", { caret: 2 }),
          close(),
        ]).output,
      );
      expect(trim(print(ansi, 4, 1))).toEqual("Hi ̲");
    });

    it("renders no caret when no caret has ever been declared", async () => {
      let t = await createTerm({ width: 4, height: 1 });
      let ansi = decode(
        t.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          text("Hi"),
          close(),
        ]).output,
      );
      // No caret marker anywhere in the grid; also no visibility bytes.
      expect(trim(print(ansi, 4, 1))).toEqual("Hi");
      expect(ansi).not.toContain("\x1b[?25h");
      expect(ansi).not.toContain("\x1b[?25l");
    });

    it("renders the caret at the text origin when content is empty and caret is 0", async () => {
      // Declaring a `caret` on empty content is a rendering commitment:
      // the renderer places the cursor at the cell the caret would
      // occupy if the content were a single space (row 1, col 1).
      let t = await createTerm({ width: 3, height: 1 });
      let ansi = decode(
        t.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          text("", { caret: 0 }),
          close(),
        ]).output,
      );
      expect(trim(print(ansi, 3, 1))).toEqual(" ̲");
    });

    it("hides the cursor when transitioning from caret-present to caret-absent", async () => {
      let t = await createTerm({ width: 3, height: 1 });
      let frame1 = decode(
        t.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          text("Hi", { caret: 1 }),
          close(),
        ]).output,
      );
      let frame2 = decode(
        t.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          text("Hi"),
          close(),
        ]).output,
      );
      // Streaming both frames through the emulator: frame 1 turns the
      // cursor on; frame 2 MUST emit `?25l` to turn it back off,
      // otherwise the caret marker would linger at frame 1's cell.
      expect(trim(print(frame1 + frame2, 3, 1))).toEqual("Hi");
    });
  });

  describe("row offset", () => {
    it("renders two frames at the offset position", async () => {
      let term = await createTerm({ width: 20, height: 5 });
      let box = (msg: string) => [
        open("root", {
          layout: { width: grow(), height: grow(), direction: "ttb" },
        }),
        open("box", {
          layout: {
            width: grow(),
            height: grow(),
            direction: "ttb",
          },
          border: {
            color: rgba(255, 255, 255),
            left: 1,
            right: 1,
            top: 1,
            bottom: 1,
          },
        }),
        text(msg),
        close(),
        close(),
      ];

      let header = await createTerm({ width: 20, height: 5 });
      let banner = decode(header.render(box("hello")).output);

      let first = decode(term.render(box("world"), { row: 6 }).output);
      expect(print(banner + first, 20, 10)).toEqual(`\
┌──────────────────┐
│hello             │
│                  │
│                  │
└──────────────────┘
┌──────────────────┐
│world             │
│                  │
│                  │
└──────────────────┘`);

      let second = decode(term.render(box("universe"), { row: 6 }).output);
      expect(print(banner + first + second, 20, 10)).toEqual(`\
┌──────────────────┐
│hello             │
│                  │
│                  │
└──────────────────┘
┌──────────────────┐
│universe          │
│                  │
│                  │
└──────────────────┘`);
    });
  });
});
