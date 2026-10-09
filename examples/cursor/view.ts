/**
 * cursor — the tile grid view for examples/cursor/index.ts.
 *
 * Each tile declares a different `pointerShape` (renderer-spec §7.9), so
 * hovering it asks the terminal to show that exact cursor. Tiles are
 * border-only rounded boxes — no painted fills — with the Bombshell brand
 * hues from bomb.sh. Hovering lights the tile's ring and name in its hue,
 * so the hover state reads even in terminals without OSC 22.
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
// Matches the 3×3 grid width so the status line's left edge is stable: the
// hovered name changes length, and a fit-sized line would re-center and
// jitter under the root's alignX.
const STATUS_W = COLS * TILE_W + (COLS - 1);

// Shapes confirmed working in set-supporting terminals (verified against
// ghostty 1.3.1: it draws these and drops help/progress/wait/move/
// zoom-in/zoom-out/none). The full 32-name vocabulary is in renderer-spec
// §7.9 and POINTER_SHAPES.
export const SHAPES = [
  "default",
  "pointer",
  "text",
  "crosshair",
  "grab",
  "grabbing",
  "not-allowed",
  "ew-resize",
  "ns-resize",
] as const;

export interface Ctx {
  entered: Set<string>;
  pointer: { x: number; y: number; down: boolean } | undefined;
  capsOn: boolean;
}

// Per-shape hues: the grab family reads as a set (open hand orange, closed
// hand yellow, forbidden red), the resizers pair in pink, and the first row
// keeps its brand-cycle colors. The Record over SHAPES makes a missing
// shape a type error.
const HUES: Record<(typeof SHAPES)[number], number> = {
  default: BRAND.pink,
  pointer: BRAND.cyan,
  text: BRAND.green,
  crosshair: BRAND.yellow,
  grab: BRAND.orange,
  grabbing: BRAND.yellow,
  "not-allowed": BRAND.red,
  "ew-resize": BRAND.pink,
  "ns-resize": BRAND.pink,
};

const TILES = SHAPES.map((name) => ({ name, hue: HUES[name] }));

function tile(ops: Op[], t: (typeof TILES)[number], ctx: Ctx): void {
  let hovered = ctx.entered.has(`shape:${t.name}`);
  ops.push(
    open(`shape:${t.name}`, {
      layout: {
        width: fixed(TILE_W),
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
      pointerShape: t.name,
    }),
    text(t.name, { color: hovered ? t.hue : label }),
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

  for (let row = 0; row < TILES.length / COLS; row++) {
    ops.push(
      open("", { layout: { direction: "ltr", gap: 1, height: fixed(3) } }),
    );
    for (
      let col = row * COLS;
      col < (row + 1) * COLS && col < TILES.length;
      col++
    ) {
      tile(ops, TILES[col], ctx);
    }
    ops.push(close());
  }

  let hoveredTile = TILES.find((t) => ctx.entered.has(`shape:${t.name}`));
  let status = hoveredTile ? `hover: ${hoveredTile.name}` : "hover: —";
  let statusColor = hoveredTile ? hoveredTile.hue : dim;
  ops.push(
    open("status", {
      layout: {
        width: fixed(STATUS_W),
        height: fixed(1),
        padding: { top: 1 },
      },
    }),
    text(
      `${status} · pointer shapes: ${ctx.capsOn ? "on" : "off"} · esc quits`,
      { color: statusColor },
    ),
    close(),
  );

  ops.push(close());

  return ops;
}
