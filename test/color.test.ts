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

describe("hex color strings", () => {
  it("renders text bg from a 3-digit hex string", async () => {
    let term = await createTerm({ width: 20, height: 1 });
    let ansi = decode(
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        text("Hi", { bg: "#f80" }),
        close(),
      ]).output,
    );

    expect(ansi).toContain("\x1b[48;2;255;136;0m");
  });

  it("renders text fg from a 6-digit hex string", async () => {
    let term = await createTerm({ width: 20, height: 1 });
    let ansi = decode(
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        text("Hi", { color: "#ff8800" }),
        close(),
      ]).output,
    );

    expect(ansi).toContain("\x1b[38;2;255;136;0m");
  });

  it("matches hex case-insensitively", async () => {
    let term = await createTerm({ width: 20, height: 1 });
    let ansi = decode(
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        text("Hi", { color: "#FF8800", bg: "#F80" }),
        close(),
      ]).output,
    );

    expect(ansi).toContain("\x1b[38;2;255;136;0m");
    expect(ansi).toContain("\x1b[48;2;255;136;0m");
  });

  it("expands 4- and 8-digit hex with doubled digits", async () => {
    let term = await createTerm({ width: 20, height: 1 });
    let ansi = decode(
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        text("Hi", { color: "#ff8800aa", bg: "#f80a" }),
        close(),
      ]).output,
    );

    expect(ansi).toContain("\x1b[38;2;255;136;0m");
    expect(ansi).toContain("\x1b[48;2;255;136;0m");
  });

  it("fills element bg from a hex string", async () => {
    let term = await createTerm({ width: 8, height: 2 });
    let ansi = decode(
      term.render([
        open("root", {
          layout: { width: fixed(8), height: fixed(2) },
          bg: "#ff8800",
        }),
        text("Hi"),
        close(),
      ]).output,
    );

    expect(ansi).toContain("\x1b[48;2;255;136;0m");
  });

  it("rejects invalid hex at render time with a TypeError", async () => {
    let term = await createTerm({ width: 20, height: 1 });
    let error: unknown;
    try {
      term.render([text("Hi", { bg: "#ff8800a" as string })]);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain("#ff8800a");
  });
});

describe("CSS color strings", () => {
  it("renders fg and bg from CSS color functions and names", async () => {
    let term = await createTerm({ width: 20, height: 1 });
    let ansi = decode(
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        text("Hi", { color: "rebeccapurple", bg: "hsl(120 100% 50%)" }),
        close(),
      ]).output,
    );

    expect(ansi).toContain("\x1b[38;2;102;51;153m");
    expect(ansi).toContain("\x1b[48;2;0;255;0m");
  });

  it("checks color string literals at compile time", () => {
    let valid = [
      text("a", { color: "#f80" }),
      text("a", { color: "RebeccaPurple" }),
      text("a", { color: "transparent" }),
      text("a", { color: "oklch(0.7 0.1 30)" }),
      text("a", { color: "RGB(255 0 0)" }),
      open("a", { bg: "hsl(0 0% 0%)", border: { color: "red" } }),
      open("a", { color: "currentcolor" }),
      open("a", { bg: "CurrentColor", border: {} }),
      text("a", { color: "currentColor", bg: "currentcolor" }),
    ];
    // @ts-expect-error invalid hex digit count
    text("a", { color: "#ff8800a" });
    // @ts-expect-error misspelled named color
    text("a", { color: "rebeccapurpel" });
    // @ts-expect-error unsupported color function
    text("a", { color: "color(srgb 1 0 0)" });
    // @ts-expect-error misspelled currentcolor
    open("a", { bg: "currentcolour" });
    expect(valid).toHaveLength(9);
  });
});

describe("system colors", () => {
  let palette: [string, number | "default"][] = [
    ["Canvas", "default"],
    ["ButtonFace", "default"],
    ["Field", "default"],
    ["CanvasText", "default"],
    ["ButtonText", "default"],
    ["FieldText", "default"],
    ["ActiveText", 1],
    ["Mark", 3],
    ["LinkText", 4],
    ["Highlight", 4],
    ["SelectedItem", 4],
    ["VisitedText", 5],
    ["AccentColor", 6],
    ["GrayText", 8],
    ["ButtonBorder", 8],
    ["HighlightText", 15],
    ["SelectedItemText", 15],
    ["MarkText", 0],
    ["AccentColorText", 0],
  ];

  let sgr = (index: number, base: number, bright: number) =>
    `\x1b[${index < 8 ? base + index : bright + index - 8}m`;

  async function textFrame(props: Parameters<typeof text>[1]) {
    let term = await createTerm({ width: 8, height: 1 });
    return decode(term.render([text("Hi", props)], { mode: "line" }).output);
  }

  it("maps each keyword to its palette entry or the default in fg and bg", async () => {
    let plain = await textFrame({});
    for (let [keyword, index] of palette) {
      let fg = await textFrame({ color: keyword });
      let bg = await textFrame({ bg: keyword });
      if (index === "default") {
        expect([keyword, fg]).toEqual([keyword, plain]);
        expect([keyword, bg]).toEqual([keyword, plain]);
      } else {
        expect([keyword, fg]).toEqual([
          keyword,
          `\x1b[0m${sgr(index, 30, 90)}Hi\x1b[0m      `,
        ]);
        expect([keyword, bg]).toEqual([
          keyword,
          `\x1b[0m${sgr(index, 40, 100)}Hi\x1b[0m      `,
        ]);
      }
    }
  });

  it("matches keywords case-insensitively", async () => {
    expect(await textFrame({ color: "linktext", bg: "MARK" })).toBe(
      "\x1b[0m\x1b[34m\x1b[43mHi\x1b[0m      ",
    );
    expect(await textFrame({ color: "LINKTEXT", bg: "graytext" })).toBe(
      "\x1b[0m\x1b[34m\x1b[100mHi\x1b[0m      ",
    );
  });

  it("combines palette colors with text attributes", async () => {
    expect(await textFrame({ color: "VisitedText", attrs: 0x01 })).toBe(
      "\x1b[0m\x1b[1m\x1b[35mHi\x1b[0m      ",
    );
  });

  it("fills element bg from a palette keyword", async () => {
    let term = await createTerm({ width: 4, height: 1 });
    let ansi = decode(
      term.render([
        open("box", {
          layout: { width: fixed(4), height: fixed(1) },
          bg: "Highlight",
        }),
        close(),
      ], { mode: "line" }).output,
    );

    expect(ansi).toBe("\x1b[0m\x1b[44m    ");
  });

  it("overwrites an enclosing bg with an explicit Canvas element bg", async () => {
    let term = await createTerm({ width: 8, height: 1 });
    let ansi = decode(
      term.render([
        open("outer", {
          layout: { width: fixed(8), height: fixed(1) },
          bg: "#ff0000",
        }),
        open("inner", {
          layout: { width: fixed(4), height: fixed(1) },
          bg: "Canvas",
        }),
        close(),
        close(),
      ], { mode: "line" }).output,
    );

    expect(ansi).toBe("\x1b[0m    \x1b[0m\x1b[48;2;255;0;0m    ");
  });

  it("overwrites an enclosing bg with a default keyword in a text bg", async () => {
    let render = async (bg?: string) => {
      let term = await createTerm({ width: 4, height: 1 });
      return decode(
        term.render([
          open("box", {
            layout: { width: fixed(4), height: fixed(1) },
            bg: "Mark",
          }),
          text("Hi", bg === undefined ? {} : { bg }),
          close(),
        ], { mode: "line" }).output,
      );
    };

    expect(await render()).toBe("\x1b[0m\x1b[43mHi  ");
    expect(await render("Canvas")).toBe("\x1b[0mHi\x1b[0m\x1b[43m  ");
    expect(await render("CanvasText")).toBe("\x1b[0mHi\x1b[0m\x1b[43m  ");
  });

  it("re-emits cells whose color changes between palette, default, and sRGB", async () => {
    let term = await createTerm({ width: 4, height: 1 });
    let frame = (color: number | string) =>
      decode(term.render([text("Hi", { color })]).output);

    expect(frame("LinkText")).toContain("\x1b[34m\x1b[1;1HHi");
    expect(frame("LinkText")).not.toContain("Hi");
    expect(frame(rgba(0, 1, 4))).toContain("\x1b[38;2;0;1;4m\x1b[1;1HHi");
    expect(frame("LinkText")).toContain("\x1b[34m\x1b[1;1HHi");
    expect(frame("Mark")).toContain("\x1b[33m\x1b[1;1HHi");
    expect(frame("CanvasText")).toContain("\x1b[0m\x1b[1;1HHi");
    expect(frame("CanvasText")).not.toContain("Hi");
    expect(frame("GrayText")).toContain("\x1b[90m\x1b[1;1HHi");
  });

  it("re-emits cells whose bg changes between palette, default, and sRGB", async () => {
    let term = await createTerm({ width: 4, height: 1 });
    let frame = (bg: number | string) =>
      decode(
        term.render([
          open("box", {
            layout: { width: fixed(4), height: fixed(1) },
            bg,
          }),
          close(),
        ]).output,
      );

    expect(frame("Highlight")).toContain("\x1b[44m\x1b[1;1H    ");
    expect(frame("Highlight")).not.toContain("    ");
    expect(frame(rgba(0, 0, 0, 128))).toContain(
      "\x1b[48;2;0;0;0m\x1b[1;1H    ",
    );
    expect(frame("Canvas")).toContain("\x1b[0m\x1b[1;1H    ");
    expect(frame("Canvas")).not.toContain("    ");
    expect(frame("HighlightText")).toContain("\x1b[107m\x1b[1;1H    ");
  });

  it("paints a probed default foreground as a truecolor text bg once the theme reports it", async () => {
    let term = await createTerm({ width: 4, height: 1 });
    let before = decode(
      term.render([text("Hi", { bg: "CanvasText" })]).output,
    );
    expect(before).not.toContain("48;2;");

    term.update([
      {
        type: "capability",
        key: "foreground-color",
        value: { r: 10, g: 20, b: 30 },
      },
    ]);
    let after = decode(
      term.render([text("Hi", { bg: "CanvasText" })]).output,
    );
    expect(after).toContain("48;2;10;20;30");
  });

  it("paints a probed default foreground as a truecolor element bg once the theme reports it", async () => {
    let term = await createTerm({ width: 4, height: 1 });
    term.update([
      {
        type: "capability",
        key: "foreground-color",
        value: { r: 10, g: 20, b: 30 },
      },
    ]);
    let ansi = decode(
      term.render([
        open("box", {
          layout: { width: fixed(4), height: fixed(1) },
          bg: "CanvasText",
        }),
        close(),
      ], { mode: "line" }).output,
    );
    expect(ansi).toContain("48;2;10;20;30");
  });

  it("paints a probed default background as a truecolor border side fg", async () => {
    let term = await createTerm({ width: 4, height: 1 });
    term.update([
      {
        type: "capability",
        key: "background-color",
        value: { r: 200, g: 210, b: 220 },
      },
    ]);
    let ansi = decode(
      term.render([
        open("box", {
          layout: { width: fixed(4), height: fixed(1) },
          border: { color: "Canvas", top: { width: 1 } },
        }),
        close(),
      ], { mode: "line" }).output,
    );
    expect(ansi).toContain("38;2;200;210;220");
  });

  it("checks system color literals at compile time", () => {
    let valid = [
      text("a", { color: "LinkText", bg: "canvas" }),
      open("a", {
        bg: "HIGHLIGHT",
        border: { color: "GrayText", top: { width: 1, bg: "Mark" } },
      }),
    ];
    // @ts-expect-error misspelled system color
    text("a", { color: "Canvass" });
    expect(valid).toHaveLength(2);
  });
});

describe("foreground inheritance and currentcolor", () => {
  it("inherits an ancestor open's color through nested opens to text", async () => {
    let term = await createTerm({ width: 10, height: 1 });
    let ansi = decode(
      term.render([
        open("outer", { color: "#ff0000" }),
        open("inner", { layout: { width: grow(), height: grow() } }),
        text("Hi"),
        close(),
        close(),
      ]).output,
    );

    expect(ansi).toContain("\x1b[38;2;255;0;0m");
  });

  it("overrides the inherited color for itself and its descendants", async () => {
    let term = await createTerm({ width: 10, height: 1 });
    let ansi = decode(
      term.render([
        open("outer", { color: "#ff0000" }),
        open("inner", {
          color: "#00ff00",
          layout: { width: grow(), height: grow() },
        }),
        text("Hi"),
        close(),
        close(),
      ]).output,
    );

    expect(ansi).toContain("\x1b[38;2;0;255;0m");
    expect(ansi).not.toContain("\x1b[38;2;255;0;0m");
  });

  it("does not carry a closed sibling's color into the next one", async () => {
    let term = await createTerm({ width: 10, height: 1 });
    let ansi = decode(
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        open("a", { color: "#ff0000" }),
        text("Hi"),
        close(),
        open("b", { layout: { width: grow(), height: grow() } }),
        text("Yo"),
        close(),
        close(),
      ]).output,
    );

    let betweenHiAndYo = ansi.slice(ansi.indexOf("Hi") + 2, ansi.indexOf("Yo"));
    expect(betweenHiAndYo).not.toContain("\x1b[38;2;255;0;0m");
  });

  it("treats color: currentcolor as inherit, same as omitting color", async () => {
    let withKeyword = decode(
      (await createTerm({ width: 10, height: 1 })).render([
        open("outer", { color: "#ff0000" }),
        open("inner", { color: "currentcolor" }),
        text("Hi"),
        close(),
        close(),
      ]).output,
    );
    let omitted = decode(
      (await createTerm({ width: 10, height: 1 })).render([
        open("outer", { color: "#ff0000" }),
        open("inner"),
        text("Hi"),
        close(),
        close(),
      ]).output,
    );

    expect(withKeyword).toBe(omitted);
  });

  it("resolves text bg currentcolor to the inherited color", async () => {
    let term = await createTerm({ width: 10, height: 1 });
    let ansi = decode(
      term.render([
        open("outer", { color: "#ff0000" }),
        text("Hi", { bg: "currentcolor" }),
        close(),
      ]).output,
    );

    expect(ansi).toContain("\x1b[48;2;255;0;0m");
  });

  it("resolves text bg currentcolor to the element's own explicit color over an ancestor's", async () => {
    let term = await createTerm({ width: 10, height: 1 });
    let ansi = decode(
      term.render([
        open("outer", { color: "#ff0000" }),
        text("Hi", { color: "#00ff00", bg: "currentcolor" }),
        close(),
      ]).output,
    );

    expect(ansi).toContain("\x1b[48;2;0;255;0m");
  });

  it("resolves open bg currentcolor to its own color", async () => {
    let term = await createTerm({ width: 4, height: 1 });
    let ansi = decode(
      term.render([
        open("box", {
          layout: { width: fixed(4), height: fixed(1) },
          color: "#ff0000",
          bg: "currentcolor",
        }),
        close(),
      ], { mode: "line" }).output,
    );

    expect(ansi).toContain("\x1b[48;2;255;0;0m");
  });

  it("packs text bg currentcolor like the field's own default without an ancestor color or theme", async () => {
    let currentcolor = decode(
      (await createTerm({ width: 4, height: 1 })).render([
        text("Hi", { bg: "currentcolor" }),
      ]).output,
    );
    let fieldDefault = decode(
      (await createTerm({ width: 4, height: 1 })).render([
        text("Hi", { bg: "CanvasText" }),
      ]).output,
    );

    expect(currentcolor).toBe(fieldDefault);
  });

  it("resolves text bg currentcolor to the probed theme foreground once reported", async () => {
    let term = await createTerm({ width: 4, height: 1 });
    term.update([
      {
        type: "capability",
        key: "foreground-color",
        value: { r: 10, g: 20, b: 30 },
      },
    ]);
    let ansi = decode(
      term.render([text("Hi", { bg: "currentcolor" })]).output,
    );

    expect(ansi).toContain("48;2;10;20;30");
  });

  it("resolves text bg currentcolor to an inherited palette color unchanged", async () => {
    let term = await createTerm({ width: 4, height: 1 });
    let ansi = decode(
      term.render([
        open("outer", { color: "Mark" }),
        text("Hi", { bg: "currentcolor" }),
        close(),
      ]).output,
    );

    expect(ansi).toContain("\x1b[43m");
  });
});
