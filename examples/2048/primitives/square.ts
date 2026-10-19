/**
 * square — an aspect-ratio helper.
 *
 * Terminal cells are roughly twice as tall as they are wide (~1:2 w:h; the
 * bombshell sneak peek measured a 16x34px cell). A box that should *read* as a
 * square therefore needs about two columns for every row. This helper hides the
 * manual fudge factor that demos otherwise hand-roll.
 *
 * Lift target: this is a candidate primitive for `bombshell-dev/ui`. When the
 * renderer exposes the real cell pixel size, `CELL_W_PER_H` can be replaced by
 * `cellHeightPx / cellWidthPx` instead of this 2:1 constant.
 */

import { fixed, type SizingAxis } from "../../../mod.ts";

/** Approximate columns-per-row for a visually square cell. */
export const CELL_W_PER_H = 2;

export interface SquareSize {
  width: SizingAxis;
  height: SizingAxis;
}

/** Number of columns that reads as square for the given row count. */
export function squareCols(rows: number): number {
  return Math.max(1, Math.round(rows * CELL_W_PER_H));
}

/**
 * Fixed sizing for a box that reads as a square `rows` cells tall.
 *
 * @example
 * open("tile", { layout: square(3) }) // 6 cols wide, 3 rows tall
 */
export function square(rows: number): SquareSize {
  return { width: fixed(squareCols(rows)), height: fixed(rows) };
}
