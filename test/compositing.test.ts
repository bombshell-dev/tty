/**
 * Tests for specs/renderer-spec.md §7.9 Color compositing.
 */

import { close, fixed, grow, type Op, open, rgba, text } from "../ops.ts";
import { createTerm, type TermOptions } from "../term.ts";
import { print } from "./print.ts";
import { TRUECOLOR_INFO } from "./caps.ts";
import { describe, expect, it } from "./suite.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const trim = (s: string) => s.split("\n").map((l) => l.trimEnd()).join("\n");

type Rgb = readonly [number, number, number];

/** Legend for a color picture. `undefined` is the terminal default. */
type Legend = Record<string, Rgb | undefined>;

const W = 4;
const H = 2;

const BLUE = rgba(0, 0, 255);
const WHITE = rgba(255, 255, 255);
const RED_50 = rgba(255, 0, 0, 128);
const WHITE_50 = rgba(255, 255, 255, 128);

/** Render `ops` in line mode and return the raw ANSI. Compositing tests
 * run in the truecolor tier so the pictures parse 24-bit sequences. */
async function render(ops: Op[], options: Partial<TermOptions> = {}) {
  let term = await createTerm({
    width: W,
    height: H,
    terminfo: TRUECOLOR_INFO,
    ...options,
  });
  return decode(term.render(ops, { mode: "line" }).output);
}

/**
 * Draw one color channel of a line-mode frame as a picture, one legend
 * character per cell. Colors missing from the legend draw as `?`.
 */
function picture(
  ansi: string,
  channel: "fg" | "bg",
  legend: Legend,
): string {
  let rows: string[][] = Array.from({ length: H }, () => []);
  let fg: Rgb | undefined;
  let bg: Rgb | undefined;
  let y = 0;

  let glyph = (color: Rgb | undefined) => {
    for (let [key, value] of Object.entries(legend)) {
      if (value === color) return key;
      if (value && color && value.every((v, i) => v === color[i])) return key;
    }
    return "?";
  };

  for (let i = 0; i < ansi.length;) {
    if (ansi[i] === "\x1b" && ansi[i + 1] === "[") {
      let end = i + 2;
      while (end < ansi.length && !/[A-Za-z]/.test(ansi[end])) end++;
      let params = ansi.slice(i + 2, end).split(";").map(Number);
      if (ansi[end] === "m") {
        if (params.length === 1 && params[0] === 0) {
          fg = bg = undefined;
        } else if (params[0] === 38 && params[1] === 2) {
          fg = [params[2], params[3], params[4]];
        } else if (params[0] === 48 && params[1] === 2) {
          bg = [params[2], params[3], params[4]];
        }
      }
      i = end + 1;
      continue;
    }
    if (ansi[i] === "\n") {
      y++;
      i++;
      continue;
    }
    rows[y]?.push(glyph(channel === "fg" ? fg : bg));
    i += ansi.codePointAt(i)! > 0xffff ? 2 : 1;
  }

  return rows.map((r) => r.join("")).join("\n");
}

function root(props: Parameters<typeof open>[1] = {}, ...children: Op[]) {
  return [
    open("root", {
      layout: { width: grow(), height: grow(), direction: "ttb" },
      ...props,
    }),
    ...children,
    close(),
  ];
}

/** A 2×1 element floating over the root's top-left corner. */
function veil(bg: number): Op[] {
  return [
    open("veil", {
      layout: { width: fixed(2), height: fixed(1) },
      bg,
      floating: { attachTo: "root", zIndex: 1 },
    }),
    close(),
  ];
}

/** A 2×1 element in flow at the root's top-left corner. */
function patch(bg: number): Op[] {
  return [
    open("patch", { layout: { width: fixed(2), height: fixed(1) }, bg }),
    close(),
  ];
}

describe("color compositing", () => {
  describe("backgrounds", () => {
    it("replaces the background at α = 255", async () => {
      let ansi = await render(root({ bg: BLUE }, ...patch(rgba(255, 0, 0))));
      expect(picture(ansi, "bg", { B: [0, 0, 255], R: [255, 0, 0] })).toEqual(
        `
RRBB
BBBB`.trim(),
      );
    });

    it("leaves the cell unchanged at α = 0", async () => {
      let ansi = await render(
        root({ bg: BLUE }, ...patch(rgba(255, 0, 0, 0))),
      );
      expect(picture(ansi, "bg", { B: [0, 0, 255] })).toEqual(`
BBBB
BBBB`.trim());
    });

    it("composites a translucent element over its parent background", async () => {
      let ansi = await render(root({ bg: BLUE }, ...patch(RED_50)));
      expect(picture(ansi, "bg", { B: [0, 0, 255], m: [128, 0, 127] }))
        .toEqual(`
mmBB
BBBB`.trim());
    });

    it("composites a translucent text background", async () => {
      let ansi = await render(root({ bg: BLUE }, text("Hi", { bg: RED_50 })));
      expect(picture(ansi, "bg", { B: [0, 0, 255], m: [128, 0, 127] }))
        .toEqual(`
mmBB
BBBB`.trim());
    });

    it("treats a raw 0xRRGGBB number as fully transparent", async () => {
      let ansi = await render(root({ bg: BLUE }, text("Hi", { bg: 0xff0000 })));
      expect(picture(ansi, "bg", { B: [0, 0, 255] })).toEqual(`
BBBB
BBBB`.trim());
    });
  });

  describe("content beneath a translucent element", () => {
    it("keeps the glyph and tints its color", async () => {
      let ansi = await render(
        root({ bg: BLUE }, text("Hi", { color: WHITE }), ...veil(RED_50)),
      );
      expect(trim(print(ansi, W, H))).toEqual("Hi\n");
      expect(picture(ansi, "bg", { B: [0, 0, 255], m: [128, 0, 127] }))
        .toEqual(`
mmBB
BBBB`.trim());
      expect(
        picture(ansi, "fg", { ".": undefined, p: [255, 127, 127] }),
      ).toEqual(`
pp..
....`.trim());
    });

    it("tints a default-foreground glyph from the default foreground", async () => {
      let ansi = await render(
        root({ bg: BLUE }, text("Hi"), ...veil(RED_50)),
        { defaultTheme: { foreground: { r: 0, g: 0, b: 0 } } },
      );
      expect(
        picture(ansi, "fg", { ".": undefined, r: [128, 0, 0] }),
      ).toEqual(`
rr..
....`.trim());
    });

    it("replaces the glyph beneath an opaque element", async () => {
      let ansi = await render(
        root(
          { bg: BLUE },
          text("Hi", { color: WHITE }),
          ...veil(rgba(255, 0, 0)),
        ),
      );
      expect(trim(print(ansi, W, H))).toEqual("\n");
    });
  });

  describe("foregrounds", () => {
    it("composites translucent text against the cell background", async () => {
      let ansi = await render(
        root({ bg: BLUE }, text("Hi", { color: WHITE_50 })),
      );
      expect(
        picture(ansi, "fg", { ".": undefined, l: [128, 128, 255] }),
      ).toEqual(`
ll..
....`.trim());
    });

    it("keeps text attributes when the text color is translucent", async () => {
      let ansi = await render(
        root({ bg: BLUE }, text("Hi", { color: WHITE_50, attrs: 0x01 })),
      );
      expect(ansi).toContain("\x1b[1m");
      expect(ansi).toContain("\x1b[38;2;128;128;255m");
    });

    it("composites a border's color after its background", async () => {
      let term = await createTerm({
        width: 4,
        height: 3,
        terminfo: TRUECOLOR_INFO,
      });
      let ansi = decode(
        term.render([
          open("box", {
            layout: { width: fixed(4), height: fixed(3) },
            bg: BLUE,
            border: {
              color: WHITE_50,
              bg: RED_50,
              left: 1,
              right: 1,
              top: 1,
              bottom: 1,
            },
          }),
          close(),
        ], { mode: "line" }).output,
      );
      let corner = ansi.slice(0, ansi.indexOf("┌"));
      expect(corner).toContain("\x1b[48;2;128;0;127m");
      expect(corner).toContain("\x1b[38;2;192;128;191m");
    });
  });

  describe("terminal defaults", () => {
    it("emits untouched cells as the terminal default", async () => {
      let ansi = await render(root({}, ...patch(rgba(255, 0, 0, 0))));
      expect(ansi).not.toContain("\x1b[48;2;");
    });

    it("composites over a black background when nothing is known", async () => {
      let ansi = await render(root({}, ...patch(RED_50)));
      expect(picture(ansi, "bg", { ".": undefined, r: [128, 0, 0] })).toEqual(
        `
rr..
....`.trim(),
      );
    });

    it("composites translucent text over a black background when nothing is known", async () => {
      let ansi = await render(root({}, text("Hi", { color: WHITE_50 })));
      expect(
        picture(ansi, "fg", { ".": undefined, g: [128, 128, 128] }),
      ).toEqual(`
gg..
....`.trim());
    });

    it("composites over createTerm's defaultTheme", async () => {
      let ansi = await render(root({}, ...patch(RED_50)), {
        defaultTheme: { background: { r: 255, g: 255, b: 255 } },
      });
      expect(picture(ansi, "bg", { ".": undefined, p: [255, 127, 127] }))
        .toEqual(`
pp..
....`.trim());
    });

    it("prefers the reported background over defaultTheme", async () => {
      let term = await createTerm({
        width: W,
        height: H,
        terminfo: TRUECOLOR_INFO,
        defaultTheme: { background: { r: 0, g: 255, b: 0 } },
      });
      let out = term.update([{
        type: "capability",
        key: "background-color",
        value: { r: 255, g: 255, b: 255 },
      }]);
      expect(out).toEqual(new Uint8Array(0));
      let ansi = decode(
        term.render(root({}, ...patch(RED_50)), { mode: "line" }).output,
      );
      expect(picture(ansi, "bg", { ".": undefined, p: [255, 127, 127] }))
        .toEqual(`
pp..
....`.trim());
    });

    it("re-emits composited cells on the next render after a theme change", async () => {
      let term = await createTerm({
        width: W,
        height: H,
        terminfo: TRUECOLOR_INFO,
      });
      let frame = root({}, ...patch(RED_50));
      term.render(frame);
      expect(term.render(frame).output.length).toBe(0);

      term.update([{
        type: "capability",
        key: "background-color",
        value: { r: 255, g: 255, b: 255 },
      }]);
      let ansi = decode(term.render(frame).output);
      expect(ansi).toContain("\x1b[48;2;255;127;127m");
    });
  });
});
