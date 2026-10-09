/**
 * cursor — the tile grid view for examples/cursor/index.ts.
 *
 * Each tile declares a different `pointerShape` (renderer-spec §7.9), so
 * hovering it asks the terminal to show that exact cursor. The bevel is
 * drawn with half blocks: `▀` shades the top edge, `▄` the bottom edge.
 * Hovering presses the tile in — the edges swap — so the hover state reads
 * even in terminals without OSC 22.
 */

import { close, fixed, grow, type Op, open, rgba, text } from "../../mod.ts";

const page = rgba(18, 18, 26);
const face = rgba(52, 52, 70);
const faceHover = rgba(74, 74, 102);
const edgeLight = rgba(112, 112, 152);
const edgeDark = rgba(28, 28, 40);
const label = rgba(220, 220, 230);
const highlight = rgba(255, 214, 110);
const dim = rgba(100, 100, 120);

const TILE_W = 15;
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

function center(name: string, width: number): string {
  let pad = width - name.length;
  let left = Math.floor(pad / 2);
  return " ".repeat(left) + name + " ".repeat(pad - left);
}

function tile(ops: Op[], name: (typeof SHAPES)[number], ctx: Ctx): void {
  let hovered = ctx.entered.has(`shape:${name}`);
  // Pressed-in look: the bevel edges swap when the cursor is over the tile.
  let top = hovered ? edgeDark : edgeLight;
  let bottom = hovered ? edgeLight : edgeDark;
  ops.push(
    open(`shape:${name}`, {
      layout: { width: fixed(TILE_W), height: fixed(3), direction: "ttb" },
      bg: hovered ? faceHover : face,
      pointerShape: name,
    }),
    text("▀".repeat(TILE_W), { color: top }),
    text(center(name, TILE_W), { color: hovered ? highlight : label }),
    text("▄".repeat(TILE_W), { color: bottom }),
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
      bg: page,
    }),
  );

  ops.push(
    open("header", { layout: { height: fixed(1) } }),
    text("cursor shapes — hover a tile", { color: label }),
    close(),
  );

  for (let row = 0; row < SHAPES.length / COLS; row++) {
    ops.push(
      open("", { layout: { direction: "ltr", gap: 1, height: fixed(3) } }),
    );
    for (
      let col = row * COLS;
      col < (row + 1) * COLS && col < SHAPES.length;
      col++
    ) {
      tile(ops, SHAPES[col], ctx);
    }
    ops.push(close());
  }

  let hovered = [...ctx.entered].find((id) => id.startsWith("shape:"));
  let status = hovered
    ? `hover: ${hovered.slice("shape:".length)}`
    : "hover: —";
  ops.push(
    open("status", { layout: { height: fixed(1), padding: { top: 1 } } }),
    text(
      `${status} · pointer shapes: ${ctx.capsOn ? "on" : "off"} · ctrl+c quits`,
      { color: ctx.capsOn ? highlight : dim },
    ),
    close(),
  );

  ops.push(close());

  return ops;
}
