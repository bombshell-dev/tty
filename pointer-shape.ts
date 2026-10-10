import type { Op } from "./ops.ts";

export const POINTER_SHAPES = [
  "default",
  "none",
  "context-menu",
  "help",
  "pointer",
  "progress",
  "wait",
  "cell",
  "crosshair",
  "text",
  "vertical-text",
  "alias",
  "copy",
  "move",
  "no-drop",
  "not-allowed",
  "grab",
  "grabbing",
  "e-resize",
  "n-resize",
  "ne-resize",
  "nw-resize",
  "s-resize",
  "se-resize",
  "sw-resize",
  "w-resize",
  "ew-resize",
  "ns-resize",
  "nesw-resize",
  "nwse-resize",
  "zoom-in",
  "zoom-out",
] as const;

/**
 * A mouse pointer shape, named with the CSS `cursor` keyword vocabulary used
 * by the OSC 22 pointer shape protocol.
 *
 * @see {@link https://sw.kovidgoyal.net/kitty/pointer-shapes/ | kitty pointer shapes}
 */
export type PointerShape = typeof POINTER_SHAPES[number];

const KNOWN: ReadonlySet<string> = new Set(POINTER_SHAPES);

export function resolvePointerShape(
  ops: readonly Op[],
  over: readonly string[],
): PointerShape {
  let best = -1;
  let shape: PointerShape = "default";
  for (let op of ops) {
    if ("data" in op) {
      if (!op.shapes) continue;
      for (let [id, value] of op.shapes) {
        if (!KNOWN.has(value)) continue;
        let i = over.lastIndexOf(id);
        if (i > best) {
          best = i;
          shape = value as PointerShape;
        }
      }
    } else if ("pointerShape" in op && op.pointerShape !== undefined) {
      if (!KNOWN.has(op.pointerShape)) continue;
      let i = over.lastIndexOf(op.id);
      if (i > best) {
        best = i;
        shape = op.pointerShape;
      }
    }
  }
  return shape;
}

const encoder = new TextEncoder();

export function osc22(shape: PointerShape): Uint8Array {
  return encoder.encode(`\x1b]22;${shape}\x1b\\`);
}
