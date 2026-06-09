import { close, grow, open, rgba, text } from "../ops.ts";
import { createTerm } from "../term.ts";
import { describe, expect, it } from "./suite.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

type TextBgColor = {
  value: number;
  sgr: string;
};

function randomTextBgColor(): TextBgColor {
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

describe("foreground", () => {
  it("emits uncolored text with no foreground", async () => {
    let term = await createTerm({ width: 12, height: 1 });
    let ansi = decode(term.render([text("hi")]).output);

    expect(ansi).toContain("hi");
    expect(ansi).not.toContain("\x1b[38;2;255;255;255");
  });
});

describe("background", () => {
  it("fills glyph cells with the requested text-level bg", async () => {
    let term = await createTerm({ width: 20, height: 1 });
    let bg = randomTextBgColor();
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

  it("resets the background before writing trailing cells", async () => {
    let term = await createTerm({ width: 20, height: 1 });
    let bg = randomTextBgColor();
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
