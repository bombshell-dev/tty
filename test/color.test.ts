import { close, fixed, grow, open, rgba, text } from "../ops.ts";
import { createTerm } from "../term.ts";
import { describe, expect, it } from "./suite.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

type BgColor = {
  value: number;
  sgr: string;
};

type Cell = {
  ch: string;
  bg?: string;
};

function randomBgColor(): BgColor {
  let r = 0;
  let g = 0;
  let b = 0;

  do {
    r = Math.floor(Math.random() * 256);
    g = Math.floor(Math.random() * 256);
    b = Math.floor(Math.random() * 256);
  } while (
    (r === 255 && g === 0 && b === 0) ||
    (r === 0 && g === 255 && b === 0) ||
    (r === 0 && g === 0 && b === 255)
  );

  return {
    value: rgba(r, g, b),
    sgr: `\x1b[48;2;${r};${g};${b}`,
  };
}

function cells(ansi: string): Cell[] {
  let result: Cell[] = [];
  let bg: string | undefined;

  for (let i = 0; i < ansi.length;) {
    if (ansi[i] === "\x1b" && ansi[i + 1] === "[") {
      let end = i + 2;
      while (end < ansi.length && !/[A-Za-z]/.test(ansi[end])) {
        end++;
      }

      let seq = ansi.slice(i, end + 1);
      if (seq === "\x1b[0m") {
        bg = undefined;
      } else if (seq.startsWith("\x1b[48;2;") && seq.endsWith("m")) {
        bg = seq.slice(0, -1);
      }

      i = end + 1;
      continue;
    }

    result.push({ ch: ansi[i], bg });
    i++;
  }

  return result;
}

function firstCell(cells: Cell[], ch: string): Cell {
  let cell = cells.find((c) => c.ch === ch);
  expect(cell).toBeDefined();
  return cell!;
}

describe("foreground", () => {
  it("emits uncolored text with no foreground", async () => {
    let term = await createTerm({ width: 12, height: 1 });
    let ansi = decode(term.render([text("hi")]).output);

    expect(ansi).toContain("hi");
    expect(ansi).not.toContain("\x1b[38;2;255;255;255");
  });
});

describe("background", () => {
  it("fills border cells with the requested border-level bg", async () => {
    let term = await createTerm({ width: 12, height: 4 });
    let bg = randomBgColor();
    let ansi = decode(
      term.render([
        open("box", {
          layout: { width: fixed(8), height: fixed(3), direction: "ttb" },
          border: {
            color: rgba(255, 255, 255),
            bg: bg.value,
            left: 1,
            right: 1,
            top: 1,
            bottom: 1,
          },
        }),
        text("Hi"),
        close(),
      ], { mode: "line" }).output,
    );

    expect(ansi).toContain(`${bg.sgr}m┌`);

    let rendered = cells(ansi);
    expect(firstCell(rendered, "┌").bg).toBe(bg.sgr);
    expect(firstCell(rendered, "─").bg).toBe(bg.sgr);
    expect(firstCell(rendered, "┐").bg).toBe(bg.sgr);
    expect(firstCell(rendered, "│").bg).toBe(bg.sgr);
  });

  it("leaves existing border-cell bg unchanged when border bg is omitted", async () => {
    let term = await createTerm({ width: 12, height: 4 });
    let bg = randomBgColor();
    let ansi = decode(
      term.render([
        open("box", {
          layout: { width: fixed(8), height: fixed(3), direction: "ttb" },
          bg: bg.value,
          border: {
            color: rgba(255, 255, 255),
            left: 1,
            right: 1,
            top: 1,
            bottom: 1,
          },
        }),
        text("Hi"),
        close(),
      ], { mode: "line" }).output,
    );

    let rendered = cells(ansi);
    expect(firstCell(rendered, "┌").bg).toBe(bg.sgr);
    expect(firstCell(rendered, "─").bg).toBe(bg.sgr);
    expect(firstCell(rendered, "┐").bg).toBe(bg.sgr);
    expect(firstCell(rendered, "│").bg).toBe(bg.sgr);
  });

  it("fills glyph cells with the requested text-level bg", async () => {
    let term = await createTerm({ width: 20, height: 1 });
    let bg = randomBgColor();
    let ansi = decode(
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        text("Hi", { bg: bg.value }),
        close(),
      ]).output,
    );

    let beforeH = ansi.slice(0, ansi.indexOf("H"));
    expect(beforeH).toContain(bg.sgr);
  });

  it("resets border bg on subsequent frames without border bg", async () => {
    let term = await createTerm({ width: 12, height: 4 });
    let bg = randomBgColor();

    // Frame 1: border with bg
    term.render([
      open("box", {
        layout: { width: fixed(8), height: fixed(3), direction: "ttb" },
        border: {
          color: rgba(255, 255, 255),
          bg: bg.value,
          left: 1,
          right: 1,
          top: 1,
          bottom: 1,
        },
      }),
      text("Hi"),
      close(),
    ]);

    // Frame 2: same border, no bg
    let ansi = decode(
      term.render([
        open("box", {
          layout: { width: fixed(8), height: fixed(3), direction: "ttb" },
          border: {
            color: rgba(255, 255, 255),
            left: 1,
            right: 1,
            top: 1,
            bottom: 1,
          },
        }),
        text("Hi"),
        close(),
      ]).output,
    );

    expect(ansi).not.toContain(bg.sgr);
    expect(firstCell(cells(ansi), "┌").bg).toBeUndefined();
  });

  it("resets the background before writing trailing cells", async () => {
    let term = await createTerm({ width: 20, height: 1 });
    let bg = randomBgColor();
    let ansi = decode(
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        text("Hi", { bg: bg.value }),
        close(),
      ]).output,
    );

    let beforeH = ansi.slice(0, ansi.indexOf("H"));
    expect(beforeH).toContain(bg.sgr);

    let hi = ansi.indexOf("Hi");
    expect(hi).toBeGreaterThanOrEqual(0);

    let afterHi = ansi.slice(hi + 2);
    expect(afterHi).not.toContain(bg.sgr);
    expect(afterHi.startsWith("\x1b[0m ")).toBe(true);
  });
});
