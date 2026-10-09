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

// Brand hues from bomb.sh: --c-pink, --c-cyan, --c-green, --c-yellow,
// --c-purple, --c-orange, --c-blue, --c-red.
const BRAND = [
  rgba(255, 53, 206),
  rgba(0, 227, 245),
  rgba(0, 239, 89),
  rgba(255, 226, 33),
  rgba(135, 26, 255),
  rgba(255, 145, 42),
  rgba(0, 87, 246),
  rgba(255, 64, 75),
];
// Brand grays: --c-gray-60, --c-gray-20, --c-gray-30, --c-gray-50.
const borderIdle = rgba(108, 110, 122);
const heading = rgba(244, 245, 249);
const label = rgba(195, 199, 208);
const dim = rgba(137, 142, 156);

const TILE_W = 17;
const COLS = 4;

// One representative per interaction family; the full 32-name vocabulary is
// in renderer-spec §7.9 and POINTER_SHAPES.
export const SHAPES = [
  "default",
  "pointer",
  "text",
  "crosshair",
  "help",
  "progress",
  "wait",
  "move",
  "grab",
  "grabbing",
  "not-allowed",
  "zoom-in",
  "zoom-out",
  "ew-resize",
  "ns-resize",
  "none",
] as const;

export interface Ctx {
  entered: Set<string>;
  pointer: { x: number; y: number; down: boolean } | undefined;
  capsOn: boolean;
}

const TILES = SHAPES.map((name, i) => ({ name, hue: BRAND[i % BRAND.length] }));

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
    open("status", { layout: { height: fixed(1), padding: { top: 1 } } }),
    text(
      `${status} · pointer shapes: ${ctx.capsOn ? "on" : "off"} · ctrl+c quits`,
      { color: statusColor },
    ),
    close(),
  );

  ops.push(close());

  return ops;
}
