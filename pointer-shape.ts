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

const INDEX: ReadonlyMap<unknown, number> = new Map(
  POINTER_SHAPES.map((shape, i) => [shape, i]),
);

export function pointerShapeIndex(shape: unknown): number | undefined {
  return INDEX.get(shape);
}

export const POINTER_SHAPE_RESET: Uint8Array = new TextEncoder().encode(
  "\x1b]22;default\x1b\\",
);
