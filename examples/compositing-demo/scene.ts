// The compositing demo's scene: the tile backdrop, the drifting
// squares, and the frame layout (renderer-spec §7.9). Shared by the
// interactive demo (index.ts) and the headless capture (capture.ts).
import { close, fixed, type Op, open, rgba, text } from "../../mod.ts";

/** The tile backdrop: saturated hues tiled in a fixed pattern, with a
 * checker offset so adjacent tiles differ. */
export const TILES = [
  rgba(226, 60, 60),
  rgba(60, 178, 72),
  rgba(66, 118, 230),
  rgba(240, 200, 48),
  rgba(184, 78, 204),
  rgba(48, 200, 210),
];

export function tileColor(x: number, y: number): number {
  return TILES[((x / 4 | 0) + (y / 2 | 0)) % TILES.length];
}

export interface Square {
  w: number;
  h: number;
  color: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  vx0: number;
  vy0: number;
}

/** The drifting semi-transparent squares. Each composites over whatever
 * is beneath it every frame (renderer-spec §7.9). */
export const SQUARES: Square[] = [
  {
    w: 10,
    h: 5,
    color: rgba(255, 80, 80, 132),
    x: 2,
    y: 2,
    vx: 6,
    vy: 3,
    vx0: 6,
    vy0: 3,
  },
  {
    w: 8,
    h: 4,
    color: rgba(80, 255, 120, 140),
    x: 20,
    y: 6,
    vx: -4,
    vy: 5,
    vx0: -4,
    vy0: 5,
  },
  {
    w: 12,
    h: 3,
    color: rgba(120, 120, 255, 150),
    x: 8,
    y: 14,
    vx: 5,
    vy: -4,
    vx0: 5,
    vy0: -4,
  },
];

/** The tier override folded through the 1/2/3 keys. -1 keeps the
 * terminal's own color evidence (color-encoding-spec §6.1). */
export const TIER_LABELS = ["terminal evidence", "256", "16"] as const;

/** One demo frame. In tile mode the mosaic supplies explicit
 * backgrounds; in bare mode nothing draws a bg, so compositing
 * destinations resolve through the §7.9 chain — the terminal's reported
 * background (OSC 11 query) > createTerm defaultTheme > black. */
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

  if (!bare) {
    for (let y = 0; y + 2 <= height - 2; y += 2) {
      ops.push(
        open(`row${y}`, {
          layout: { width: fixed(width), height: fixed(2), direction: "ltr" },
        }),
      );
      for (let x = 0; x < width; x += 4) {
        ops.push(
          open(`tile${x}-${y}`, {
            layout: { width: fixed(4), height: fixed(2) },
            bg: tileColor(x, y),
          }),
          close(),
        );
      }
      ops.push(close());
    }
  }

  for (let i = 0; i < SQUARES.length; i++) {
    let s = SQUARES[i];
    ops.push(
      open(`square${i}`, {
        layout: { width: fixed(s.w), height: fixed(s.h) },
        bg: s.color,
        floating: {
          x: s.x,
          y: s.y,
          attachTo: "root",
          zIndex: 1 + i,
        },
      }),
      close(),
    );
  }

  let bgLabel = bare ? reportedBg ?? "black/white fallback" : "tiles";
  let label = ` §7.9 compositing · tier: ${
    TIER_LABELS[tier + 1]
  } · bg: ${bgLabel} · t tiles · 1/2/3 tier · arrows · tab · a · q`;
  // The control bar floats at the bottom row, so it holds a fixed
  // position no matter what the flow content above it does (toggling
  // the tiles changes their row count). Padding gives the label an
  // inset; childAlignment centers it. The bar's translucent background
  // composites over whatever passes beneath it — tiles, the reported
  // background, and squares sliding under (zIndex above the squares',
  // so boxes never render over the toolbar).
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
