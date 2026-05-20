import { beforeEach, describe, expect, it } from "./suite.ts";
import { createTerm, type Term } from "../term.ts";
import { close, fixed, grow, open, rgba, text } from "../ops.ts";
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
│    padded                            │
│                                      │
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
          padding: { left: 1, top: 1 },
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
      // deno-lint-ignore no-control-regex
      expect(out).not.toMatch(/\x1b\[\d+;\d+H/);
      expect(out.split("\n").length).toBe(5);
      expect(trim(print(out, 20, 5))).toEqual(`
┌──────────────────┐
│hello world       │
│                  │
│                  │
└──────────────────┘`.trim());

      if (Deno.build.os === "windows") {
        expect(out.startsWith("\x1b[?7l")).toBe(true);
        expect(out.endsWith("\x1b[?7h")).toBe(true);
      }
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

      if (Deno.build.os === "windows") {
        expect(second.startsWith("\x1b[?7l\x1b[H")).toBe(true);
        expect(second).toContain("\r\n");
        expect(second.endsWith("\x1b[?7h")).toBe(true);
      } else {
        expect(second.length).toBeLessThan(first.length);
      }
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
            padding: { left: 1, top: 1 },
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
