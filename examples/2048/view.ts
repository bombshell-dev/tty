/**
 * view — pure state -> Op[] for the 2048 demo.
 *
 * Two distinct primitive showcases live here:
 *
 *   - The board tiles are floating elements positioned at pixel-cell offsets and
 *     keyed on their stable tile id. Changing a tile's (row, col) moves its
 *     floating x/y, and the `transition` on `["position", "bg"]` lets the layout
 *     engine interpolate the slide and recolor. Tiles are `square(...)` so they
 *     read as squares despite the ~1:2 cell aspect ratio.
 *
 *   - The surrounding chrome (New Game, Undo, board-size selector, the
 *     game-over "Play again") is built from the `button` primitive and driven by
 *     hover + focus state.
 */

import { close, fixed, grow, type Op, open, rgba, text } from "../../mod.ts";
import type { FocusRing } from "./primitives/focus.ts";
import { focusedId } from "./primitives/focus.ts";
import { square, squareCols } from "./primitives/square.ts";
import { button } from "./primitives/button.ts";
import type { GameState } from "./game.ts";

export const TILE_ROWS = 3;
export const TILE_COLS = squareCols(TILE_ROWS); // 6
export const GAP = 1;
export const PAD = 1;

export const BOARD_SIZES = [3, 4, 5] as const;

const ROOT_BG = rgba(20, 20, 26);
const STAT_BG = rgba(52, 52, 68);
const BOARD_BG = rgba(48, 44, 60);
const EMPTY_BG = rgba(64, 60, 78);
const TITLE = rgba(255, 214, 110);
const LABEL = rgba(170, 170, 190);
const HINT_KEY = rgba(255, 214, 110);
const HINT_TEXT = rgba(150, 150, 170);
const OVERLAY_BG = rgba(16, 16, 22);
const FPS_COLOR = rgba(120, 190, 140);
const KEYCAP_BG = rgba(70, 70, 92);
const KEYCAP_FG = rgba(235, 235, 245);

export interface ViewModel {
  game: GameState;
  /** Element ids currently under the pointer (hover). */
  entered: Set<string>;
  focus: FocusRing;
  canUndo: boolean;
  /** Smoothed render rate to display; 0 until the first animation runs. */
  fps: number;
  /** Recent key/click labels for the keycaster overlay (oldest first). */
  keys: string[];
}

/** Classic 2048 tile background by value. */
function tileBg(value: number): number {
  switch (value) {
    case 2:
      return rgba(238, 228, 218);
    case 4:
      return rgba(237, 224, 200);
    case 8:
      return rgba(242, 177, 121);
    case 16:
      return rgba(245, 149, 99);
    case 32:
      return rgba(246, 124, 95);
    case 64:
      return rgba(246, 94, 59);
    case 128:
      return rgba(237, 207, 114);
    case 256:
      return rgba(237, 204, 97);
    case 512:
      return rgba(237, 200, 80);
    case 1024:
      return rgba(237, 197, 63);
    case 2048:
      return rgba(237, 194, 46);
    default:
      return rgba(60, 58, 50);
  }
}

function tileFg(value: number): number {
  return value <= 4 ? rgba(118, 110, 101) : rgba(249, 246, 242);
}

export function boardWidth(size: number): number {
  return PAD * 2 + size * TILE_COLS + (size - 1) * GAP;
}

export function boardHeight(size: number): number {
  return PAD * 2 + size * TILE_ROWS + (size - 1) * GAP;
}

function cellX(col: number): number {
  return PAD + col * (TILE_COLS + GAP);
}

function cellY(row: number): number {
  return PAD + row * (TILE_ROWS + GAP);
}

function statBox(id: string, label: string, value: string): Op[] {
  return [
    open(id, {
      layout: {
        width: fixed(12),
        height: fixed(3),
        direction: "ttb",
        alignX: "center",
        alignY: "center",
      },
      bg: STAT_BG,
      cornerRadius: { tl: 1, tr: 1, bl: 1, br: 1 },
    }),
    text(label, { color: LABEL }),
    text(value, { color: rgba(255, 255, 255) }),
    close(),
  ];
}

function header(vm: ViewModel): Op[] {
  return [
    open("header", {
      layout: {
        width: grow(),
        height: fixed(3),
        direction: "ltr",
        gap: 2,
        alignY: "center",
      },
    }),
    open("title", { layout: { alignY: "center" } }),
    text("2048", { color: TITLE }),
    close(),
    open("title-spacer", { layout: { width: grow() } }),
    close(),
    ...statBox("stat:score", "SCORE", String(vm.game.score)),
    ...statBox("stat:best", "BEST", String(vm.game.best)),
    close(),
  ];
}

function toolbar(vm: ViewModel): Op[] {
  let hov = (id: string) => vm.entered.has(id);
  let foc = (id: string) => focusedId(vm.focus) === id;

  let ops: Op[] = [
    open("toolbar", {
      layout: {
        width: grow(),
        height: fixed(3),
        direction: "ltr",
        gap: 1,
        alignY: "center",
      },
    }),
    ...button("btn:new", "New Game (n)", {
      hovered: hov("btn:new"),
      focused: foc("btn:new"),
    }),
    ...button("btn:undo", "Undo (u)", {
      hovered: hov("btn:undo"),
      focused: foc("btn:undo"),
      disabled: !vm.canUndo,
    }),
    open("toolbar-spacer", { layout: { width: grow() } }),
    close(),
    open("size-label", { layout: { alignY: "center" } }),
    text("board", { color: LABEL }),
    close(),
  ];

  for (let n of BOARD_SIZES) {
    let id = `size:${n}`;
    ops.push(
      ...button(id, `${n}x${n}`, {
        hovered: hov(id),
        focused: foc(id),
        // The active size reads as "pressed" so it stays highlighted.
        pressed: vm.game.size === n,
      }),
    );
  }

  ops.push(close());
  return ops;
}

function boardCells(size: number): Op[] {
  let ops: Op[] = [];
  for (let r = 0; r < size; r++) {
    ops.push(
      open(`cellrow:${r}`, {
        layout: { direction: "ltr", height: fixed(TILE_ROWS), gap: GAP },
      }),
    );
    for (let c = 0; c < size; c++) {
      ops.push(
        open(`cell:${r}:${c}`, {
          layout: square(TILE_ROWS),
          bg: EMPTY_BG,
          cornerRadius: { tl: 1, tr: 1, bl: 1, br: 1 },
        }),
        close(),
      );
    }
    ops.push(close());
  }
  return ops;
}

function boardTiles(vm: ViewModel): Op[] {
  let ops: Op[] = [];
  for (let t of vm.game.tiles) {
    // Tiles are always full size and aligned to whole cells. Sliding animates
    // `position`; merges animate `bg`. We deliberately do not animate `size`:
    // the v1 renderer snaps cells to the integer grid, so a fractional/sub-cell
    // size pop renders as a misaligned short block rather than a smooth scale.
    // (Smooth sub-cell motion is what the upcoming raster path is for.)
    ops.push(
      open(`tile:${t.id}`, {
        layout: {
          width: fixed(TILE_COLS),
          height: fixed(TILE_ROWS),
          alignX: "center",
          alignY: "center",
        },
        bg: tileBg(t.value),
        floating: {
          x: cellX(t.col),
          y: cellY(t.row),
          attachTo: "parent",
          attachPoints: { element: "left-top", parent: "left-top" },
          pointerCaptureMode: "passthrough",
          zIndex: 1,
        },
        transition: {
          // A touch longer than feels necessary on a GPU terminal: it spans
          // more painted frames on slower (CPU-rendered) terminals, so the
          // slide reads as a glide rather than a couple of discrete jumps.
          duration: 0.18,
          easing: "easeInOut",
          properties: ["position", "bg"],
        },
      }),
      text(String(t.value), { color: tileFg(t.value) }),
      close(),
    );
  }
  return ops;
}

function board(vm: ViewModel): Op[] {
  let size = vm.game.size;
  return [
    open("board-area", {
      layout: {
        width: grow(),
        height: grow(),
        alignX: "center",
        alignY: "center",
      },
    }),
    open("board", {
      layout: {
        width: fixed(boardWidth(size)),
        height: fixed(boardHeight(size)),
        direction: "ttb",
        padding: { left: PAD, right: PAD, top: PAD, bottom: PAD },
        gap: GAP,
      },
      bg: BOARD_BG,
      cornerRadius: { tl: 1, tr: 1, bl: 1, br: 1 },
    }),
    ...boardCells(size),
    ...boardTiles(vm),
    close(), // board
    close(), // board-area
  ];
}

function footer(vm: ViewModel): Op[] {
  let status = vm.game.over
    ? "no moves left"
    : vm.game.won
    ? "you reached 2048!"
    : "arrows / wasd to move";
  return [
    open("footer", {
      layout: {
        width: grow(),
        height: fixed(1),
        direction: "ltr",
        gap: 2,
      },
    }),
    ...hint("tab", "focus"),
    ...hint("enter", "activate"),
    ...hint("u", "undo"),
    ...hint("n", "new"),
    ...hint("q", "quit"),
    open("footer-spacer", { layout: { width: grow() } }),
    close(),
    open("footer-fps", { layout: {} }),
    text(vm.fps > 0 ? `${vm.fps} fps` : "-- fps", { color: FPS_COLOR }),
    close(),
    open("footer-status", { layout: {} }),
    text(status, { color: HINT_TEXT }),
    close(),
    close(),
  ];
}

function hint(key: string, label: string): Op[] {
  return [
    open(`hint:${key}`, { layout: { direction: "ltr" } }),
    text(key, { color: HINT_KEY }),
    text(` ${label}`, { color: HINT_TEXT }),
    close(),
  ];
}

// Floating keycaster: a centered row of caps near the bottom that mirrors the
// player's recent key presses and button clicks. Purely a presentation overlay
// (passthrough pointer), so it never intercepts clicks on the board below.
function keycaster(vm: ViewModel): Op[] {
  if (vm.keys.length === 0) return [];
  let ops: Op[] = [
    open("keycaster", {
      layout: { direction: "ltr", gap: 1, alignY: "center" },
      floating: {
        attachTo: "root",
        attachPoints: { element: "center-bottom", parent: "center-bottom" },
        y: -3,
        zIndex: 50,
        pointerCaptureMode: "passthrough",
      },
    }),
  ];
  vm.keys.forEach((label, i) => {
    ops.push(
      open(`key:${i}`, {
        layout: {
          height: fixed(3),
          padding: { left: 2, right: 2 },
          alignX: "center",
          alignY: "center",
        },
        bg: KEYCAP_BG,
        cornerRadius: { tl: 1, tr: 1, bl: 1, br: 1 },
      }),
      text(label, { color: KEYCAP_FG }),
      close(),
    );
  });
  ops.push(close());
  return ops;
}

function modal(vm: ViewModel): Op[] {
  if (!vm.game.over) return [];
  return [
    open("modal", {
      layout: {
        width: fixed(34),
        height: fixed(9),
        direction: "ttb",
        padding: { left: 2, right: 2, top: 1, bottom: 1 },
        gap: 1,
        alignX: "center",
        alignY: "center",
      },
      bg: OVERLAY_BG,
      border: { color: TITLE, left: 1, right: 1, top: 1, bottom: 1 },
      cornerRadius: { tl: 2, tr: 2, bl: 2, br: 2 },
      floating: {
        attachTo: "root",
        attachPoints: { element: "center-center", parent: "center-center" },
        zIndex: 100,
      },
    }),
    open("modal-title", { layout: { alignX: "center" } }),
    text("Game over", { color: TITLE }),
    close(),
    open("modal-score", { layout: { alignX: "center" } }),
    text(`score ${vm.game.score}`, { color: rgba(230, 230, 240) }),
    close(),
    ...button("btn:again", "Play again", {
      hovered: vm.entered.has("btn:again"),
      focused: focusedId(vm.focus) === "btn:again",
    }, { width: fixed(16) }),
    close(),
  ];
}

export function view(vm: ViewModel): Op[] {
  return [
    open("root", {
      layout: {
        width: grow(),
        height: grow(),
        direction: "ttb",
        // Outer inset so the chrome breathes away from the terminal edges, plus
        // a row of air between each section so the header/toolbar don't pile up.
        padding: { top: 1, left: 3, right: 3, bottom: 1 },
        gap: 1,
      },
      bg: ROOT_BG,
    }),
    ...header(vm),
    ...toolbar(vm),
    ...board(vm),
    ...footer(vm),
    ...keycaster(vm),
    ...modal(vm),
    close(),
  ];
}
