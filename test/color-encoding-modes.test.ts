import { describe, expect, it } from "./suite.ts";
import { createTerm } from "../term.ts";
import type { InputEvent } from "../input.ts";
import type { TerminalInfo } from "../terminfo.ts";
import { close, fixed, grow, type Op, open, rgba, text } from "../ops.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/** Static capability evidence with a chosen `colors` value and optional
 * truecolor grant. The renderer resolves its emission tier from these
 * fields alone (color-encoding-spec §6.1). */
function info(colors: number, trueColor = false): TerminalInfo {
  return Object.freeze({
    capabilities: Object.freeze({
      colors,
      trueColor,
      bce: true,
      autoMargin: true,
      xenl: true,
      altScreen: true,
      styledUnderline: false,
    }),
    probe: new Uint8Array(0),
    keys: new Uint8Array(0),
  });
}

/** Frame: one full-screen text node carrying the given color/bg. */
function coloredText(
  color?: number,
  bg?: number,
): Op[] {
  return [
    open("root", { layout: { width: grow(), height: grow() } }),
    text("X", { color, bg }),
    close(),
  ];
}

/** The SGR bytes emitted before the glyph. */
function beforeGlyph(ansi: string): string {
  return ansi.slice(0, ansi.indexOf("X"));
}

describe("color encoding modes", () => {
  describe("16-color tier", () => {
    it("downgrades standard red foreground to the 4-bit code", async () => {
      let term = await createTerm({ width: 4, height: 1, terminfo: info(16) });
      let ansi = decode(term.render(coloredText(rgba(255, 0, 0))).output);

      let before = beforeGlyph(ansi);
      // pins: standard-palette red maps to 4-bit \x1b[31m
      expect(before).toContain("\x1b[31m");
      // pins: the 24-bit sequence must not survive the downgrade
      expect(before).not.toContain("\x1b[38;2;255;0;0");
    });

    it("downgrades standard red background to the 4-bit code", async () => {
      let term = await createTerm({ width: 4, height: 1, terminfo: info(16) });
      let ansi = decode(
        term.render(coloredText(undefined, rgba(255, 0, 0))).output,
      );

      let before = beforeGlyph(ansi);
      expect(before).toContain("\x1b[41m");
      expect(before).not.toContain("\x1b[48;2;255;0;0");
    });

    it("maps bright palette colors to aixterm codes", async () => {
      let term = await createTerm({ width: 4, height: 1, terminfo: info(16) });
      let ansi = decode(term.render(coloredText(rgba(255, 85, 85))).output);

      // #ff5555 is nominal index 9 → bright red foreground
      expect(beforeGlyph(ansi)).toContain("\x1b[91m");
    });

    it("maps non-palette colors to the nearest nominal entry", async () => {
      let term = await createTerm({ width: 4, height: 1, terminfo: info(16) });
      // #aa0000 is nearer nominal red (index 1) than any other entry
      let ansi = decode(term.render(coloredText(rgba(170, 0, 0))).output);

      expect(beforeGlyph(ansi)).toContain("\x1b[31m");
    });
  });

  describe("256-color tier", () => {
    it("downgrades standard red foreground to its palette index", async () => {
      let term = await createTerm({ width: 4, height: 1, terminfo: info(256) });
      let ansi = decode(term.render(coloredText(rgba(255, 0, 0))).output);

      // pins: standard-palette red maps to index 1
      expect(beforeGlyph(ansi)).toContain("\x1b[38;5;1m");
      expect(beforeGlyph(ansi)).not.toContain("\x1b[38;2;255;0;0");
    });

    it("downgrades standard red background to its palette index", async () => {
      let term = await createTerm({ width: 4, height: 1, terminfo: info(256) });
      let ansi = decode(
        term.render(coloredText(undefined, rgba(255, 0, 0))).output,
      );

      expect(beforeGlyph(ansi)).toContain("\x1b[48;5;1m");
      expect(beforeGlyph(ansi)).not.toContain("\x1b[48;2;255;0;0");
    });

    it("round-trips exact cube colors", async () => {
      let term = await createTerm({ width: 4, height: 1, terminfo: info(256) });
      // #5f5f5f is cube (1,1,1) → index 16 + 36 + 6 + 1 = 59
      let ansi = decode(term.render(coloredText(rgba(95, 95, 95))).output);

      expect(beforeGlyph(ansi)).toContain("\x1b[38;5;59m");
    });

    it("maps equal-channel grays onto the grayscale ramp", async () => {
      let term = await createTerm({ width: 4, height: 1, terminfo: info(256) });
      // (100,100,100): nearest ramp value is 98 (i=9) → index 241
      let ansi = decode(term.render(coloredText(rgba(100, 100, 100))).output);

      expect(beforeGlyph(ansi)).toContain("\x1b[38;5;241m");
    });

    it("maps non-palette colors to the nearest cube value per channel", async () => {
      let term = await createTerm({ width: 4, height: 1, terminfo: info(256) });
      // (250,10,10) → cube steps (5,0,0) → index 196
      let ansi = decode(term.render(coloredText(rgba(250, 10, 10))).output);

      expect(beforeGlyph(ansi)).toContain("\x1b[38;5;196m");
    });
  });

  describe("truecolor tier", () => {
    it("emits byte-identical historical sequences", async () => {
      let term = await createTerm({
        width: 4,
        height: 1,
        terminfo: info(256, true),
      });
      let ansi = decode(
        term.render(coloredText(rgba(255, 0, 0), rgba(0, 0, 255))).output,
      );

      let before = beforeGlyph(ansi);
      expect(before).toContain("\x1b[38;2;255;0;0m");
      expect(before).toContain("\x1b[48;2;0;0;255m");
      expect(before).not.toContain("38;5;");
    });
  });

  describe("tier resolution", () => {
    it("resolves the 256-color baseline without evidence", async () => {
      let term = await createTerm({ width: 4, height: 1 });
      let ansi = decode(term.render(coloredText(rgba(255, 0, 0))).output);

      expect(beforeGlyph(ansi)).toContain("\x1b[38;5;1m");
    });

    it("resolves the 16-color tier at and below 16 colors", async () => {
      for (let colors of [8, 16]) {
        let term = await createTerm({
          width: 4,
          height: 1,
          terminfo: info(colors),
        });
        let ansi = decode(term.render(coloredText(rgba(255, 0, 0))).output);
        expect(beforeGlyph(ansi)).toContain("\x1b[31m");
      }
    });

    it("resolves the 256-color tier above 16 colors", async () => {
      let term = await createTerm({ width: 4, height: 1, terminfo: info(17) });
      let ansi = decode(term.render(coloredText(rgba(255, 0, 0))).output);

      expect(beforeGlyph(ansi)).toContain("\x1b[38;5;1m");
    });

    it("resolves the truecolor tier on a granted truecolor flag", async () => {
      let term = await createTerm({
        width: 4,
        height: 1,
        terminfo: info(16, true),
      });
      let ansi = decode(term.render(coloredText(rgba(255, 0, 0))).output);

      expect(beforeGlyph(ansi)).toContain("\x1b[38;2;255;0;0m");
    });
  });

  describe("dynamic evidence", () => {
    it("applies a colordepth event from the next render", async () => {
      let term = await createTerm({ width: 4, height: 1 });
      let ops = coloredText(rgba(255, 0, 0));

      expect(decode(term.render(ops).output)).toContain("\x1b[38;5;1m");

      // The update transaction itself emits no bytes (renderer-spec §7.7)
      let bytes = term.update([
        { type: "capability", key: "colordepth", value: "truecolor" },
      ]);
      expect(bytes.length).toBe(0);

      // The next render encodes in the new tier
      expect(decode(term.render(ops).output)).toContain("\x1b[38;2;255;0;0m");
    });

    it("redraws the complete frame after a tier change", async () => {
      let term = await createTerm({ width: 4, height: 1 });
      let ops = coloredText(rgba(255, 0, 0));

      term.render(ops);
      // no redraw while the tier is stable
      expect(term.render(ops).output.length).toBe(0);

      term.update([
        { type: "capability", key: "colordepth", value: "truecolor" },
      ]);
      let out = term.render(ops).output;
      // CI-5: the frame after a tier change is a complete redraw
      expect(out.length).toBeGreaterThan(0);
      expect(decode(out)).toContain("X");

      // the tier has settled: diffing resumes
      expect(term.render(ops).output.length).toBe(0);
    });

    it("downgrades on a colordepth denial event", async () => {
      let term = await createTerm({
        width: 4,
        height: 1,
        terminfo: info(256, true),
      });
      let ops = coloredText(rgba(255, 0, 0));

      expect(decode(term.render(ops).output)).toContain("\x1b[38;2;255;0;0m");

      term.update([{ type: "capability", key: "colordepth", value: "256" }]);
      expect(decode(term.render(ops).output)).toContain("\x1b[38;5;1m");
    });
  });

  describe("default colors", () => {
    it("emits no color SGR for default fg/bg in any tier", async () => {
      for (let caps of [info(16), info(256), info(256, true)]) {
        let term = await createTerm({ width: 4, height: 1, terminfo: caps });
        let ansi = decode(term.render(coloredText()).output);

        expect(ansi).toContain("X");
        expect(ansi).not.toMatch(/\x1b\[(3\d|4\d|9\d|10\d|38|48)/);
      }
    });
  });

  describe("palette round-trip", () => {
    it("maps every 256-palette entry to an index of the same color", async () => {
      let NOMINAL = [
        0x000000,
        0xff0000,
        0x00ff00,
        0xffff00,
        0x0000ff,
        0xff00ff,
        0x00ffff,
        0xc0c0c0,
        0x808080,
        0xff5555,
        0x55ff55,
        0xffff55,
        0x5555ff,
        0xff55ff,
        0x55ffff,
        0xffffff,
      ];
      let CUBE = [0, 95, 135, 175, 215, 255];
      let rgbOf = (i: number): number => {
        if (i < 16) return NOMINAL[i];
        if (i < 232) {
          let n = i - 16;
          return (CUBE[Math.floor(n / 36)] << 16) |
            (CUBE[Math.floor(n / 6) % 6] << 8) |
            CUBE[n % 6];
        }
        let v = 8 + 10 * (i - 232);
        return (v << 16) | (v << 8) | v;
      };

      // A 16x16 grid whose cell k carries palette color k.
      let term = await createTerm({ width: 16, height: 16 });
      let ops: Op[] = [
        open("root", {
          layout: { width: grow(), height: grow(), direction: "ttb" },
        }),
      ];
      for (let row = 0; row < 16; row++) {
        ops.push(
          open(`row${row}`, {
            layout: { width: grow(), height: fixed(1), direction: "ltr" },
          }),
        );
        for (let col = 0; col < 16; col++) {
          let rgb = rgbOf(row * 16 + col);
          ops.push(text(".", {
            bg: rgba((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff),
          }));
        }
        ops.push(close());
      }
      ops.push(close());

      let ansi = decode(term.render(ops).output);
      let indices = [...ansi.matchAll(/\x1b\[48;5;(\d+)m/g)].map((m) =>
        Number(m[1])
      );
      expect(indices.length).toBe(256);
      for (let k = 0; k < 256; k++) {
        // The emitted index must represent the identical color (CI-4).
        expect(rgbOf(indices[k])).toBe(rgbOf(k));
      }
    });
  });
});
