/**
 * cursor — the tile grid view for examples/cursor/index.ts.
 *
 * Each tile declares a different `pointerShape` (renderer-spec §7.9), so
 * hovering it asks the terminal to show that exact cursor. Tiles are
 * border-only rounded boxes — no painted fills — with the Bombshell brand
 * hues from bomb.sh. Hovering lights the tile's ring and name in its hue,
 * so the hover state reads even in terminals without OSC 22. The grab tile
 * is double-wide and shows grabbing while the pointer is held down on it,
 * returning to grab on release, staying orange throughout.
 */

import { close, fixed, grow, type Op, open, rgba, text } from "../../mod.ts";

// Brand hues from bomb.sh's CSS: --c-pink, --c-cyan, --c-green, --c-yellow,
// --c-purple, --c-orange, --c-blue, --c-red.
const BRAND = {
  pink: rgba(255, 53, 206),
  cyan: rgba(0, 227, 245),
  green: rgba(0, 239, 89),
  yellow: rgba(255, 226, 33),
  purple: rgba(135, 26, 255),
  orange: rgba(255, 145, 42),
  blue: rgba(0, 87, 246),
  red: rgba(255, 64, 75),
};
// Brand grays: --c-gray-60, --c-gray-20, --c-gray-30, --c-gray-50.
const borderIdle = rgba(108, 110, 122);
const heading = rgba(244, 245, 249);
const label = rgba(195, 199, 208);
const dim = rgba(137, 142, 156);

const TILE_W = 17;
const COLS = 3;
// Matches the grid width so the status line's left edge is stable: the
// hovered name changes length, and a fit-sized line would re-center and
// jitter under the root's alignX.
const STATUS_W = COLS * TILE_W + (COLS - 1);

export interface Ctx {
  entered: Set<string>;
  pointer: { x: number; y: number; down: boolean } | undefined;
  capsOn: boolean;
  /** The grab tile's toggled state: true shows grabbing, false grab. */
  grabbing: boolean;
}

// One tile per confirmed shape (verified against ghostty 1.3.1, which drops
// help/progress/wait/move/zoom-in/zoom-out/none; the full 32-name vocabulary
// is in renderer-spec §7.9 and POINTER_SHAPES). grab/grabbing share a
// double-wide tile that toggles on click; each tile carries its brand hue.
const TILES = [
  { shape: "default", hue: BRAND.pink },
  { shape: "pointer", hue: BRAND.cyan },
  { shape: "text", hue: BRAND.green },
  { shape: "crosshair", hue: BRAND.yellow },
  { shape: "grab", hue: BRAND.orange, toggle: "grabbing" },
  { shape: "not-allowed", hue: BRAND.red },
  { shape: "ew-resize", hue: BRAND.pink },
  { shape: "ns-resize", hue: BRAND.pink },
] as const;

type Tile = (typeof TILES)[number];

function tile(ops: Op[], t: Tile, ctx: Ctx): void {
  let id = `shape:${t.shape}`;
  let hovered = ctx.entered.has(id);
  let shape = "toggle" in t && ctx.grabbing ? t.toggle : t.shape;
  ops.push(
    open(id, {
      layout: {
        width: fixed("toggle" in t ? TILE_W * 2 + 1 : TILE_W),
        height: fixed(3),
        padding: { left: 2, right: 2 },
        alignX: "center",
        alignY: "center",
      },
      border: {
        color: hovered ? t.hue : borderIdle,
        left: 1,
        right: 1,
        top: 1,
        bottom: 1,
      },
      cornerRadius: { tl: 1, tr: 1, bl: 1, br: 1 },
      pointerShape: shape,
    }),
    text(shape, { color: hovered ? t.hue : label }),
    close(),
  );
}

export function frame(ctx: Ctx): Op[] {
  let ops: Op[] = [];

  ops.push(
    open("root", {
      layout: {
        width: grow(),
        height: grow(),
        direction: "ttb",
        alignX: "center",
        alignY: "center",
        gap: 1,
        padding: { left: 2, right: 2, top: 1, bottom: 1 },
      },
    }),
  );

  ops.push(
    open("header", { layout: { height: fixed(1) } }),
    text("cursor shapes — hover a tile", { color: heading }),
    close(),
  );

  // Pack tiles into rows of COLS units; the toggle tile spans two.
  let rows: Tile[][] = [];
  let row: Tile[] = [];
  let used = 0;
  for (let t of TILES) {
    let w = "toggle" in t ? 2 : 1;
    if (used + w > COLS) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(t);
    used += w;
  }
  if (row.length > 0) rows.push(row);

  for (let r of rows) {
    ops.push(
      open("", { layout: { direction: "ltr", gap: 1, height: fixed(3) } }),
    );
    for (let t of r) {
      tile(ops, t, ctx);
    }
    ops.push(close());
  }

  // Status: a muted bar whose hover label takes the hovered tile's hue, with
  // a grow spacer pinning the feature indicator to the right edge so both
  // ends stay put as the hovered name changes length.
  let hoveredTile = TILES.find((t) => ctx.entered.has(`shape:${t.shape}`));
  let hoveredShape: string | undefined;
  let hoveredHue = dim;
  if (hoveredTile) {
    hoveredShape = "toggle" in hoveredTile && ctx.grabbing
      ? hoveredTile.toggle
      : hoveredTile.shape;
    hoveredHue = hoveredTile.hue;
  }
  let indicator = ctx.capsOn ? "●" : "■";
  let indicatorColor = ctx.capsOn ? BRAND.green : BRAND.red;
  ops.push(
    open("status", {
      layout: {
        width: fixed(STATUS_W),
        height: fixed(1),
        direction: "ltr",
        padding: { top: 1 },
      },
    }),
    text("hover: ", { color: dim }),
    text(hoveredShape ?? "—", { color: hoveredShape ? hoveredHue : dim }),
    open("", { layout: { width: grow(), height: fixed(1) } }),
    close(),
    text(indicator, { color: indicatorColor }),
    text(` ${ctx.capsOn ? "feature supported" : "feature unsupported"}`, {
      color: dim,
    }),
    close(),
  );

  ops.push(
    open("hint", { layout: { height: fixed(1) } }),
    text("esc quits", { color: dim }),
    close(),
  );

  ops.push(close());

  return ops;
}
