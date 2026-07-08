/**
 * Pure 2048 game logic — no rendering, no IO.
 *
 * The defining trait for the transitions demo is *tile identity*: every logical
 * tile carries a stable numeric `id` that survives slides and merges. The
 * renderer keys each tile's element on that id, so when a tile's (row, col)
 * changes between frames the layout engine interpolates its position instead of
 * teleporting it. Merged-away tiles are dropped immediately (v1 has no exit
 * transitions); the surviving tile is flagged `merged` so the view can pop it.
 */

export type Direction = "up" | "down" | "left" | "right";

export interface Tile {
  id: number;
  row: number;
  col: number;
  value: number;
  /** This tile is the result of a merge on the most recent move (pop hint). */
  merged: boolean;
  /** This tile was spawned by the most recent move (pop hint). */
  spawned: boolean;
}

export interface GameState {
  size: number;
  tiles: Tile[];
  score: number;
  best: number;
  /** A 2048 tile has appeared at least once. */
  won: boolean;
  /** No legal move remains. */
  over: boolean;
  nextId: number;
}

export function cloneGame(state: GameState): GameState {
  return {
    ...state,
    tiles: state.tiles.map((t) => ({ ...t })),
  };
}

function emptyCells(size: number, tiles: Tile[]): Array<[number, number]> {
  let occupied = new Set(tiles.map((t) => t.row * size + t.col));
  let cells: Array<[number, number]> = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!occupied.has(r * size + c)) cells.push([r, c]);
    }
  }
  return cells;
}

function spawn(state: GameState): void {
  let cells = emptyCells(state.size, state.tiles);
  if (cells.length === 0) return;
  let [row, col] = cells[Math.floor(Math.random() * cells.length)];
  let value = Math.random() < 0.9 ? 2 : 4;
  state.tiles.push({
    id: state.nextId++,
    row,
    col,
    value,
    merged: false,
    spawned: true,
  });
}

export function newGame(size: number, best = 0): GameState {
  let state: GameState = {
    size,
    tiles: [],
    score: 0,
    best,
    won: false,
    over: false,
    nextId: 1,
  };
  spawn(state);
  spawn(state);
  // Freshly dealt tiles read as "spawned"; that is the intended first-frame pop.
  return state;
}

/** Lines are traversed from the edge the tiles move toward. */
function lineOrder(
  size: number,
  dir: Direction,
): { lines: number[]; cells: (line: number) => Array<[number, number]> } {
  let indices = Array.from({ length: size }, (_, i) => i);
  return {
    lines: indices,
    cells(line: number) {
      let out: Array<[number, number]> = [];
      for (let i = 0; i < size; i++) {
        switch (dir) {
          case "left":
            out.push([line, i]);
            break;
          case "right":
            out.push([line, size - 1 - i]);
            break;
          case "up":
            out.push([i, line]);
            break;
          case "down":
            out.push([size - 1 - i, line]);
            break;
        }
      }
      return out;
    },
  };
}

function place(
  dir: Direction,
  line: number,
  slot: number,
  size: number,
): [number, number] {
  switch (dir) {
    case "left":
      return [line, slot];
    case "right":
      return [line, size - 1 - slot];
    case "up":
      return [slot, line];
    case "down":
      return [size - 1 - slot, line];
  }
}

export interface MoveResult {
  state: GameState;
  moved: boolean;
}

export function move(prev: GameState, dir: Direction): MoveResult {
  let size = prev.size;
  // Work on fresh tile objects so `prev` (and anything holding it, e.g. the undo
  // history) is never mutated. Index them by cell to walk lines, and remember
  // each tile's origin to detect whether anything actually shifted.
  let working = prev.tiles.map((t) => ({
    ...t,
    merged: false,
    spawned: false,
  }));
  let origin = new Map<number, [number, number]>();
  let grid: (Tile | null)[][] = Array.from(
    { length: size },
    () => Array.from({ length: size }, () => null),
  );
  for (let t of working) {
    grid[t.row][t.col] = t;
    origin.set(t.id, [t.row, t.col]);
  }

  let survivors: Tile[] = [];
  let removed = 0;
  let gained = 0;
  let { lines, cells } = lineOrder(size, dir);

  for (let line of lines) {
    let incoming: Tile[] = [];
    for (let [r, c] of cells(line)) {
      let t = grid[r][c];
      if (t) incoming.push(t);
    }

    let merged: Tile[] = [];
    let lockedLast = false;
    for (let t of incoming) {
      let last = merged[merged.length - 1];
      if (last && !lockedLast && last.value === t.value) {
        last.value *= 2;
        last.merged = true;
        gained += last.value;
        lockedLast = true;
        removed++;
        // `t` is consumed by the merge: it is not carried forward.
      } else {
        merged.push(t);
        lockedLast = false;
      }
    }

    for (let slot = 0; slot < merged.length; slot++) {
      let t = merged[slot];
      let [row, col] = place(dir, line, slot, size);
      t.row = row;
      t.col = col;
      survivors.push(t);
    }
  }

  let moved = removed > 0;
  if (!moved) {
    for (let t of survivors) {
      let o = origin.get(t.id)!;
      if (o[0] !== t.row || o[1] !== t.col) {
        moved = true;
        break;
      }
    }
  }

  let next: GameState = {
    ...prev,
    tiles: survivors,
    score: prev.score + gained,
  };

  if (moved) {
    spawn(next);
  }

  next.best = Math.max(prev.best, next.score);
  next.won = next.won || next.tiles.some((t) => t.value >= 2048);
  next.over = !hasMoves(next);

  return { state: next, moved };
}

function hasMoves(state: GameState): boolean {
  let { size, tiles } = state;
  if (emptyCells(size, tiles).length > 0) return true;

  let grid: (number | null)[][] = Array.from(
    { length: size },
    () => Array.from({ length: size }, () => null),
  );
  for (let t of tiles) grid[t.row][t.col] = t.value;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      let v = grid[r][c];
      if (v === null) continue;
      if (c + 1 < size && grid[r][c + 1] === v) return true;
      if (r + 1 < size && grid[r + 1][c] === v) return true;
    }
  }
  return false;
}

/** Strip the per-move pop hints so the next move starts clean. */
export function clearFlags(state: GameState): GameState {
  return {
    ...state,
    tiles: state.tiles.map((t) => ({ ...t, merged: false, spawned: false })),
  };
}
