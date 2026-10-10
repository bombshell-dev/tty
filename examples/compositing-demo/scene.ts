// The compositing demo's scene (renderer-spec §7.9): a mixed backdrop —
// solid tiles, a gradient, prose text, and a file-manager panel — with
// a large translucent veil the user drives over it, and a fixed
// composited control bar. Shared by the interactive demo (index.ts) and
// the headless capture (capture.ts).
//
// Colors come from bomb.sh's :root CSS variables (the brand system):
// the eight chromatic accents plus the gray ramp used for surfaces and
// text.
import { close, fixed, type Op, open, rgba, text } from "../../mod.ts";

/* ── Bombshell brand colors (bomb.sh :root CSS vars) ─────────────── */

export const BRAND = {
  pink: rgba(255, 53, 206), // --c-pink: #ff35ce (accent)
  green: rgba(0, 239, 89), // --c-green: #00ef59
  yellow: rgba(255, 226, 33), // --c-yellow: #ffe221
  cyan: rgba(0, 227, 245), // --c-cyan: #00e3f5
  red: rgba(255, 64, 75), // --c-red: #ff404b
  blue: rgba(0, 87, 246), // --c-blue: #0057f6
  purple: rgba(135, 26, 255), // --c-purple: #871aff
  orange: rgba(255, 145, 42), // --c-orange: #ff912a
  // gray ramp: --c-gray-90 surface fill, -80 borders, -40 muted text,
  // -20 headings, -10 white
  surface: rgba(25, 27, 36), // --c-gray-90: #191b24
  border: rgba(42, 46, 57), // --c-gray-80: #2a2e39
  borderLight: rgba(72, 74, 85), // --c-gray-70: #484a55
  muted: rgba(137, 142, 156), // --c-gray-50: #898e9c
  textDim: rgba(169, 171, 183), // --c-gray-40: #a9abb7
  textMid: rgba(195, 199, 208), // --c-gray-30: #c3c7d0
  heading: rgba(244, 245, 249), // --c-gray-20: #f4f5f9
  white: rgba(255, 255, 255), // --c-gray-10 / --c-white
  // --c-gray-100 page fill #0a0a0d, used for the bar's tint base
  ink: rgba(10, 10, 13),
} as const;

/** The tier override folded through the 1/2/3 keys. -1 keeps the
 * terminal's own color evidence (color-encoding-spec §6.1). */
export const TIER_LABELS = ["terminal evidence", "256", "16"] as const;

/** The veil's candidate colors — the bomb.sh chromatic accents. Alpha
 * is applied separately (the -/+ keys). */
export const VEIL_COLORS = [
  BRAND.pink,
  BRAND.orange,
  BRAND.green,
  BRAND.blue,
  BRAND.purple,
];

export interface Veil {
  w: number;
  h: number;
  x: number;
  y: number;
  alpha: number; // 0–255
  colorIdx: number;
}

/** The user-driven translucent box: the point of the demo. Move it
 * with the arrows over the mixed backdrop and watch §7.9 composite it
 * over tiles, gradients, glyphs, and the reported background alike. */
export const VEIL: Veil = {
  w: 18,
  h: 7,
  x: 4,
  y: 3,
  alpha: 128,
  colorIdx: 0,
};

export function clampVeil(width: number, height: number): void {
  let maxX = Math.max(0, width - VEIL.w);
  let maxY = Math.max(0, height - 1 - VEIL.h); // the bar row is off-limits
  VEIL.x = Math.min(Math.max(VEIL.x, 0), maxX);
  VEIL.y = Math.min(Math.max(VEIL.y, 0), maxY);
}

function veilBg(): number {
  let c = VEIL_COLORS[VEIL.colorIdx];
  return rgba(
    (c >> 16) & 0xff,
    (c >> 8) & 0xff,
    c & 0xff,
    VEIL.alpha,
  );
}

/* ── Backdrop regions ─────────────────────────────────────────────── */

/** The tile backdrop: the bomb.sh chromatic accents in a fixed pattern,
 * with a checker offset so adjacent tiles differ. */
const TILES = [
  BRAND.pink,
  BRAND.green,
  BRAND.blue,
  BRAND.yellow,
  BRAND.purple,
  BRAND.cyan,
];

function tileColor(x: number, y: number): number {
  return TILES[((x / 4 | 0) + (y / 2 | 0)) % TILES.length];
}

function tilesPanel(w: number, h: number, id: string): Op[] {
  let ops: Op[] = [
    open(id, {
      layout: { width: fixed(w), height: fixed(h), direction: "ttb" },
    }),
  ];
  for (let y = 0; y + 2 <= h; y += 2) {
    ops.push(
      open(`${id}r${y}`, {
        layout: { width: fixed(w), height: fixed(2), direction: "ltr" },
      }),
    );
    for (let x = 0; x < w;) {
      let tw = Math.min(4, w - x);
      ops.push(
        open(`${id}t${x}-${y}`, {
          layout: { width: fixed(tw), height: fixed(2) },
          bg: tileColor(x, y),
        }),
        close(),
      );
      x += tw;
    }
    ops.push(close());
  }
  ops.push(close());
  return ops;
}

/** A horizontal two-stop gradient, one full-height column per cell.
 * Every column is its own explicit background, so the veil's tint
 * changes visibly cell by cell as it crosses. */
function gradientPanel(w: number, h: number, id: string): Op[] {
  let c1 = { r: 49, g: 46, b: 129 }; // indigo
  let c2 = { r: 38, g: 166, b: 154 }; // teal
  let ops: Op[] = [
    open(id, {
      layout: { width: fixed(w), height: fixed(h), direction: "ltr" },
    }),
  ];
  for (let x = 0; x < w; x++) {
    let t = w > 1 ? x / (w - 1) : 0;
    let lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
    ops.push(
      open(`${id}c${x}`, {
        layout: { width: fixed(1), height: fixed(h) },
        bg: rgba(lerp(c1.r, c2.r), lerp(c1.g, c2.g), lerp(c1.b, c2.b)),
      }),
      close(),
    );
  }
  ops.push(close());
  return ops;
}

const PROSE = [
  "Compositing is source-over, per",
  "channel, applied in draw order.",
  "The veil keeps this glyph and",
  "tints its foreground toward the",
  "veil color — text needs no bg",
  "for the tint to reach it.",
];

/** Prose over the terminal default background: no explicit bg anywhere,
 * so a default foreground still tints under the veil (§7.9 backgrounds)
 * while untouched cells keep emitting no color SGR. */
function textPanel(w: number, h: number, id: string): Op[] {
  let ops: Op[] = [
    open(id, {
      layout: {
        width: fixed(w),
        height: fixed(h),
        direction: "ttb",
        padding: { left: 2, top: 1 },
      },
    }),
    text("why it matters", {
      color: rgba(200, 205, 215),
      attrs: 0x01, // bold
    }),
  ];
  for (let line of PROSE.slice(0, Math.max(0, h - 1))) {
    ops.push(text(line.slice(0, Math.max(0, w - 2)), {
      color: rgba(160, 166, 178),
    }));
  }
  ops.push(close());
  return ops;
}

interface Row {
  name: string;
  size: string;
  selected?: boolean;
}

const FILES: Row[] = [
  { name: "▸ async/", size: "" },
  { name: "  main.ts", size: "4.2K" },
  { name: "▸ render.ts", size: "12.8K", selected: true },
  { name: "  mod.ts", size: "1.1K" },
  { name: "  bench/", size: "—" },
];

/** A file-manager panel: bordered box, bold header, a selected row with
 * an explicit background, right-aligned sizes, and a footer with a
 * block-glyph progress bar. Ordinary TUI content — and every glyph in
 * it tints under the veil as the veil passes over. */
function tuiPanel(w: number, h: number, id: string): Op[] {
  let ops: Op[] = [
    open(id, {
      layout: { width: fixed(w), height: fixed(h), direction: "ttb" },
      border: {
        color: rgba(120, 128, 140),
        left: 1,
        right: 1,
        top: 1,
        bottom: 1,
      },
      cornerRadius: { tl: 0, tr: 0, bl: 0, br: 0 },
    }),
  ];
  let inner = Math.max(0, w - 4); // border + 1-cell padding each side
  let rows = Math.max(0, h - 2);
  ops.push(
    text(` src/ · 5 items`.slice(0, inner).padEnd(inner), {
      color: rgba(220, 224, 230),
      attrs: 0x01,
    }),
  );
  for (let r of FILES.slice(0, rows - 2)) {
    let line =
      (r.name + " ".repeat(inner)).slice(0, inner - r.size.length - 1) +
      r.size.padStart(r.size.length + 1);
    if (r.selected) {
      // selected row: explicit background + bold light text
      ops.push(
        open(`${id}sel`, {
          layout: { width: fixed(inner), height: fixed(1) },
          bg: rgba(36, 90, 190),
        }),
        text(line, { color: rgba(240, 244, 250), attrs: 0x01 }),
        close(),
      );
    } else {
      ops.push(text(line, { color: rgba(160, 166, 178) }));
    }
  }
  if (rows >= 2) {
    // footer: track title + block-glyph progress
    let done = 6;
    let total = 10;
    ops.push(
      text(
        ` ♪ Nightcall  ${"█".repeat(done)}${"░".repeat(total - done)} 2:14`
          .slice(0, inner)
          .padEnd(inner),
        { color: rgba(255, 170, 80) },
      ),
    );
    ops.push(
      text(` 3.2G free`.slice(0, inner).padEnd(inner), {
        color: rgba(110, 116, 128),
      }),
    );
  }
  ops.push(close());
  return ops;
}

/* ── Frame assembly ───────────────────────────────────────────────── */

/** One demo frame. The top row mixes the tile mosaic and the gradient;
 * the bottom row mixes prose (no bg) and the file-manager panel. The
 * veil floats above all of it; the control bar floats above the veil.
 * `bare` drops the full-bleed fields so the veil composites over the
 * terminal's reported background instead (§7.9 chain). */
export function frame(
  width: number,
  height: number,
  tier: number,
  bare: boolean,
  reportedBg?: string,
): Op[] {
  let ops: Op[] = [
    open("root", {
      layout: { width: fixed(width), height: fixed(height), direction: "ttb" },
    }),
  ];

  // Upper band: tiles | gradient. In bare mode it collapses and the
  // lower band takes the whole area above the bar.
  let contentH = height - 1; // bar row
  let upperH = bare ? 0 : Math.min(8, Math.floor(contentH / 2));
  let lowerH = contentH - upperH;
  let leftW = Math.max(8, Math.floor(width * 0.55));

  if (upperH > 0) {
    ops.push(
      open("upper", {
        layout: {
          width: fixed(width),
          height: fixed(upperH),
          direction: "ltr",
        },
      }),
    );
    ops.push(...tilesPanel(leftW, upperH, "tiles"));
    ops.push(...gradientPanel(width - leftW, upperH, "grad"));
    ops.push(close());
  }

  ops.push(
    open("lower", {
      layout: { width: fixed(width), height: fixed(lowerH), direction: "ltr" },
    }),
  );
  ops.push(...textPanel(leftW, lowerH, "prose"));
  ops.push(...tuiPanel(width - leftW, lowerH, "files"));
  ops.push(close());

  // The veil: the user-driven translucent box, above the backdrop,
  // below the bar (boxes never render over the toolbar).
  ops.push(
    open("veil", {
      layout: { width: fixed(VEIL.w), height: fixed(VEIL.h) },
      bg: veilBg(),
      floating: { x: VEIL.x, y: VEIL.y, attachTo: "root", zIndex: 5 },
    }),
    close(),
  );

  // The control bar: fixed to the bottom row, padded, centered, and
  // alpha-composited over whatever is beneath it.
  let bgLabel = bare ? `bg: ${reportedBg ?? "fallback"}` : "tiles+gradient";
  let label =
    ` §7.9 · veil α${VEIL.alpha} · q quit · ⇧arrows jump · tab color · -/+ alpha · ${bgLabel} · 1/2/3 tier`;
  ops.push(
    open("bar", {
      layout: {
        width: fixed(width),
        height: fixed(1),
        padding: { left: 2, right: 2 },
        alignX: "center",
      },
      bg: rgba(20, 20, 28, 200),
      floating: { x: 0, y: height - 1, attachTo: "root", zIndex: 10 },
    }),
    text(label.slice(0, Math.max(0, width - 4)), {
      color: rgba(230, 230, 235),
    }),
    close(),
    close(),
  );
  return ops;
}
