// Headless capture for the compositing demo (renderer-spec §7.9).
//
// Renders demo frames through the real renderer in each color-encoding
// tier — truecolor, 256, and 16 (color-encoding-spec §6.1: compositing
// happens before encoding, so composited results narrow) — and converts
// the ANSI output to HTML with the exact CSS colors, producing
// compositing-demo.html for viewing.
//
// Run with: deno run --allow-read --allow-write examples/compositing-demo/capture.ts
import { createTerm, type TerminalInfo } from "../../mod.ts";
import { frame, SQUARES } from "./scene.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

function evidence(colors: number, trueColor: boolean): TerminalInfo {
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

const WIDTH = 80;
const HEIGHT = 24;

/** Two drift arrangements for the squares (capture-side only). */
function arrange(moves: Array<[number, number]>): void {
  SQUARES.forEach((s, i) => {
    s.x = moves[i][0];
    s.y = moves[i][1];
  });
}

const escapeHtml = (s: string) =>
  s.replaceAll("&", "&").replaceAll("<", "<").replaceAll(">", ">");

/** The 256-color palette (indices 0-15 nominal, 16-231 cube, 232-255
 * grayscale ramp) as RGB — mirrors the renderer's mapping. */
function paletteRgb(i: number): [number, number, number] {
  const NOMINAL = [
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
  const CUBE = [0, 95, 135, 175, 215, 255];
  if (i < 16) {
    return [
      (NOMINAL[i] >> 16) & 255,
      (NOMINAL[i] >> 8) & 255,
      NOMINAL[i] & 255,
    ];
  }
  if (i < 232) {
    let n = i - 16;
    return [
      CUBE[Math.floor(n / 36)],
      CUBE[Math.floor(n / 6) % 6],
      CUBE[n % 6],
    ];
  }
  let v = 8 + 10 * (i - 232);
  return [v, v, v];
}

/** The nominal 16-color palette the renderer maps 4-bit indices to. */
const NOMINAL_16 = [
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

const css = (r: number, g: number, b: number) => `rgb(${r},${g},${b})`;

interface Style {
  fg?: [number, number, number];
  bg?: [number, number, number];
  bold: boolean;
}

/** Convert one line-mode ANSI frame to HTML spans per SGR run. */
function ansiToHtml(ansi: string): string {
  let style: Style = { bold: false };
  let out = "";
  let i = 0;
  while (i < ansi.length) {
    if (ansi[i] === "\x1b" && ansi[i + 1] === "[") {
      let end = i + 2;
      while (end < ansi.length && !/[A-Za-z]/.test(ansi[end])) end++;
      let kind = ansi[end];
      let params = ansi.slice(i + 2, end).split(";").filter((p) => p !== "");
      i = end + 1;
      if (kind !== "m") continue;
      if (params.length === 1 && params[0] === "0") {
        style = { bold: false };
        continue;
      }
      for (let k = 0; k < params.length; k++) {
        let p = Number(params[k]);
        if (p === 1) {
          style.bold = true;
        } else if (p === 38 || p === 48) {
          if (params[k + 1] === "2") {
            let rgb: [number, number, number] = [
              Number(params[k + 2]),
              Number(params[k + 3]),
              Number(params[k + 4]),
            ];
            k += 4;
            if (p === 38) style.fg = rgb;
            else style.bg = rgb;
          } else if (params[k + 1] === "5") {
            let rgb = paletteRgb(Number(params[k + 2]));
            k += 2;
            if (p === 38) style.fg = rgb;
            else style.bg = rgb;
          }
        } else if (p >= 30 && p <= 37 || p >= 90 && p <= 97) {
          let idx = p >= 90 ? p - 90 + 8 : p - 30;
          let v = NOMINAL_16[idx];
          style.fg = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
        } else if (p >= 40 && p <= 47 || p >= 100 && p <= 107) {
          let idx = p >= 100 ? p - 100 + 8 : p - 40;
          let v = NOMINAL_16[idx];
          style.bg = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
        }
      }
      continue;
    }
    if (ansi[i] === "\n") {
      out += "\n";
      i++;
      continue;
    }
    // One styled run: consecutive plain characters sharing the style.
    let run = "";
    while (
      i < ansi.length && ansi[i] !== "\x1b" && ansi[i] !== "\n"
    ) {
      run += ansi[i];
      i++;
    }
    let parts: string[] = [];
    if (style.fg) parts.push(`color:${css(...style.fg)}`);
    if (style.bg) parts.push(`background:${css(...style.bg)}`);
    if (style.bold) parts.push("font-weight:bold");
    out += `<span style="${parts.length ? parts.join(";") : ""}">${
      escapeHtml(run)
    }</span>`;
  }
  return out;
}

const TIERS: Array<
  { label: string; note: string; colors: number; tc: boolean }
> = [
  {
    label: "truecolor",
    note: "truecolor evidence — composited results encoded as 24-bit SGR",
    colors: 256,
    tc: true,
  },
  {
    label: "256",
    note:
      "no truecolor evidence — composited results narrow to the 256 palette",
    colors: 256,
    tc: false,
  },
  {
    label: "16",
    note: "colors: 16 — composited results narrow to the nominal 16 palette",
    colors: 16,
    tc: false,
  },
];

const MOVES: Array<Array<[number, number]>> = [
  [[3, 1], [40, 8], [14, 16]],
  [[30, 2], [8, 10], [50, 14]],
];

let sections = "";
for (let t of TIERS) {
  let frames = "";
  for (let m of MOVES) {
    arrange(m);
    let term = await createTerm({
      width: WIDTH,
      height: HEIGHT,
      terminfo: evidence(t.colors, t.tc),
    });
    let ansi = decode(
      term.render(frame(WIDTH, HEIGHT, -1), {
        mode: "line",
      }).output,
    );
    frames += `<h3>frame · squares at ${
      m.map((p) => `(${p[0]},${p[1]})`)
        .join(", ")
    }</h3>\n<pre>${ansiToHtml(ansi)}</pre>\n`;
  }
  sections +=
    `<section><h2>tier: ${t.label}</h2><p>${t.note}</p>${frames}</section>\n`;
}

let html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Compositing demo — renderer-spec §7.9</title>
<style>
  body { background: #0b0b10; color: #ccc; font-family: system-ui, sans-serif; margin: 2rem; }
  h1, h2, h3 { color: #eee; font-weight: 600; }
  p { color: #888; max-width: 60rem; }
  pre { font: 12px/1 "SF Mono", Menlo, monospace; margin: 1rem 0 2rem; }
  section { border-top: 1px solid #26262e; padding-top: 1rem; }
</style>
</head>
<body>
<h1>Color compositing demo</h1>
<p>Frames rendered headless through the real renderer (examples/compositing-demo):
a mosaic of colorful tiles with drifting semi-transparent squares compositing
over them per renderer-spec §7.9, and a translucent status bar compositing over
whatever the squares leave beneath it. Each tier shows two drift arrangements.</p>
${sections}
</body>
</html>
`;

await Deno.writeTextFile(
  new URL(import.meta.resolve("./compositing-demo.html")).pathname,
  html,
);
console.log(
  "wrote examples/compositing-demo/compositing-demo.html",
);
