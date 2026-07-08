/**
 * 2048 — a motion-first showcase for `@bomb.sh/tty` transitions and a proving
 * ground for `bombshell-dev/ui` primitives.
 *
 * - The board tiles slide and recolor via the v1 `transition` field (position,
 *   bg), keyed on stable tile ids (see `game.ts` / `view.ts`).
 * - The chrome is built from the `button` primitive and is fully usable by both
 *   mouse (hover + click) and keyboard (Tab to focus, Enter/Space to activate),
 *   closing the focus gap tty leaves open (see `primitives/`).
 *
 * Controls: arrows or WASD to move, Tab/Shift+Tab to move focus, Enter/Space to
 * activate the focused button, n new game, u undo, q or Ctrl+C to quit.
 *
 * Run: `deno run examples/2048/index.ts`
 */

import {
  createChannel,
  createSignal,
  each,
  ensure,
  main,
  race,
  resource,
  sleep,
  spawn,
  type Stream,
  until,
} from "effection";
import { createTerm, type InputEvent, type PointerEvent } from "../../mod.ts";
import {
  alternateBuffer,
  cursor,
  mouseTracking,
  settings,
} from "../../settings.ts";
import { useInput } from "../use-input.ts";
import { useStdin } from "../use-stdin.ts";
import {
  clearFlags,
  cloneGame,
  type Direction,
  type GameState,
  move,
  newGame,
} from "./game.ts";
import {
  focusBy,
  focusedId,
  type FocusRing,
  focusRing,
  focusTo,
  isActivate,
  tabDirection,
} from "./primitives/focus.ts";
import { BOARD_SIZES, view, type ViewModel } from "./view.ts";

const TOOLBAR_ITEMS = [
  "btn:new",
  "btn:undo",
  ...BOARD_SIZES.map((n) => `size:${n}`),
];

/** A single press shown by the on-screen keycaster, with the time it landed. */
interface KeyChip {
  label: string;
  at: number;
}

interface App {
  game: GameState;
  history: GameState[];
  entered: Set<string>;
  pointer: { x: number; y: number; down: boolean } | undefined;
  focus: FocusRing;
  /** Sliding-window count of frames produced in the last second (see `draw`). */
  fps: number;
  /** Recent presses for the keycaster overlay (oldest first). */
  keys: KeyChip[];
}

/** How long a keycaster chip stays on screen after its press, in ms. */
const KEY_WINDOW_MS = 1600;
/** Most chips shown at once; older ones drop off the left. */
const KEY_MAX = 12;

/** Display label for a key press, or `null` to ignore it (e.g. quit keys). */
function keyLabel(e: InputEvent): string | null {
  if (e.type !== "keydown") return null;
  if (e.ctrl && e.key === "c") return null;
  switch (e.key) {
    case "ArrowUp":
      return "↑";
    case "ArrowDown":
      return "↓";
    case "ArrowLeft":
      return "←";
    case "ArrowRight":
      return "→";
    case "Enter":
    case "NumpadEnter":
      return "⏎";
    case " ":
      return "Space";
    case "Tab":
      return e.shift ? "⇧Tab" : "Tab";
    case "Backtab":
      return "⇧Tab";
    case "Escape":
      return "Esc";
  }
  if (e.code === "Tab") return e.shift ? "⇧Tab" : "Tab";
  if (typeof e.key === "string" && e.key.length === 1) {
    return e.key.toUpperCase();
  }
  return null;
}

/** Display label for a clicked control, or `null` if it isn't a tracked one. */
function clickLabel(id: string): string | null {
  switch (id) {
    case "btn:new":
      return "New";
    case "btn:again":
      return "Again";
    case "btn:undo":
      return "Undo";
    case "size:3":
      return "3x3";
    case "size:4":
      return "4x4";
    case "size:5":
      return "5x5";
  }
  return null;
}

function ringItems(game: GameState): string[] {
  return game.over ? ["btn:again", ...TOOLBAR_ITEMS] : TOOLBAR_ITEMS;
}

function syncFocus(app: App): void {
  let items = ringItems(app.game);
  let id = focusedId(app.focus);
  let index = id ? items.indexOf(id) : -1;
  app.focus = focusRing(items, index === -1 ? 0 : index);
}

function startGame(app: App, size: number): void {
  app.game = newGame(size, app.game.best);
  app.history = [];
  syncFocus(app);
}

function undo(app: App): void {
  let previous = app.history.pop();
  if (!previous) return;
  app.game = previous;
  syncFocus(app);
}

function activate(app: App, id: string | undefined): void {
  switch (id) {
    case "btn:new":
    case "btn:again":
      startGame(app, app.game.size);
      break;
    case "btn:undo":
      undo(app);
      break;
    case "size:3":
    case "size:4":
    case "size:5":
      startGame(app, Number(id.slice(5)));
      break;
  }
  if (id) app.focus = focusTo(app.focus, id);
}

function doMove(app: App, dir: Direction): void {
  if (app.game.over) return;
  let snapshot = cloneGame(clearFlags(app.game));
  let { state, moved } = move(snapshot, dir);
  if (!moved) return;
  app.history.push(snapshot);
  app.game = state;
  syncFocus(app);
}

function model(app: App): ViewModel {
  return {
    game: app.game,
    entered: app.entered,
    focus: app.focus,
    canUndo: app.history.length > 0,
    fps: Math.round(app.fps),
    keys: app.keys.map((k) => k.label),
  };
}

function ticker(
  flag: { animating: boolean; keysVisible: boolean },
): Stream<void, void> {
  return resource(function* (provide) {
    let ch = createChannel<void, void>();
    yield* spawn(function* () {
      while (true) {
        if (flag.animating) {
          // ~125fps. We deliberately produce faster than a 60Hz refresh: our
          // frame timer isn't synced to the display's vsync, so over-producing
          // means every refresh has a fresh frame ready instead of occasionally
          // landing between two of ours (judder). A render is ~0.08ms, so the
          // extra frames are essentially free.
          //
          // We tried throttling this to ~60fps (16ms) to avoid handing a slow
          // terminal more frames than it can paint, but it looked choppier, not
          // smoother — capping at the refresh rate makes unsynced judder worse,
          // not better. Over-producing is the safer default.
          yield* sleep(8);
          yield* ch.send();
        } else if (flag.keysVisible) {
          // Nothing is moving, but keycaster chips are on screen and need to
          // expire on their own. A lazy ~10fps tick is enough to retire them.
          yield* sleep(100);
          yield* ch.send();
        } else {
          yield* sleep(50);
        }
      }
    });
    let sub = yield* ch;
    yield* race([provide(sub), drain(ch)]);
  });
}

function merge<A, B, TClose>(
  a: Stream<A, TClose>,
  b: Stream<B, TClose>,
): Stream<A | B, TClose> {
  return resource(function* (provide) {
    let sub = { a: yield* a, b: yield* b };
    return yield* provide({
      *next() {
        return yield* race([sub.a.next(), sub.b.next()]);
      },
    });
  });
}

function* drain<T, TClose>(stream: Stream<T, TClose>) {
  for (let _ of yield* each(stream)) {
    yield* each.next();
  }
}

const DIRECTIONS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};

// Wipe the whole screen. The renderer diffs against its own buffer, so on
// resize we must clear physically-stale cells (out-of-bounds when shrinking,
// reflowed when growing) ourselves before the fresh term repaints.
const CLEAR_SCREEN = new TextEncoder().encode("\x1b[2J\x1b[H");

function consoleSize(): { width: number; height: number } {
  let { columns, rows } = Deno.stdout.isTerminal()
    ? Deno.consoleSize()
    : { columns: 80, rows: 24 };
  return { width: columns, height: rows };
}

await main(function* () {
  let { width, height } = consoleSize();

  Deno.stdin.setRaw(true);
  yield* ensure(() => Deno.stdin.setRaw(false));

  let stdin = yield* useStdin();
  let input = useInput(stdin);

  let term = yield* until(createTerm({ width, height }));

  let tty = settings(alternateBuffer(), cursor(false), mouseTracking());
  Deno.stdout.writeSync(tty.apply);
  yield* ensure(() => {
    Deno.stdout.writeSync(tty.revert);
  });

  // The native term has fixed-size buffers, and the input parser never emits
  // resize events, so we bridge SIGWINCH into the event stream ourselves. The
  // payload is just a wake-up; the handler reads the live size.
  let resizes = createSignal<{ type: "resize" }, void>();
  let onWinch = () => resizes.send({ type: "resize" });
  if (Deno.build.os !== "windows") {
    Deno.addSignalListener("SIGWINCH", onWinch);
    yield* ensure(() => Deno.removeSignalListener("SIGWINCH", onWinch));
  }

  let app: App = {
    game: newGame(3),
    history: [],
    entered: new Set(),
    pointer: undefined,
    focus: focusRing(TOOLBAR_ITEMS),
    fps: 0,
    keys: [],
  };

  let flag = { animating: false, keysVisible: false };
  let pointerEvents = createChannel<PointerEvent, void>();

  // Frames-per-second is a sliding-window count of frames we push to stdout in
  // the last second. This is the rate we *produce* frames, not the rate the
  // terminal *paints* them: writeSync returns once bytes reach the pty, and a
  // CPU-rendered terminal can coalesce/drop frames downstream where we can't
  // observe it. So a low number here means we're slow; a high number does not
  // guarantee the terminal kept up.
  let frameTimes: number[] = [];

  function draw(): PointerEvent[] {
    let now = performance.now();
    frameTimes.push(now);
    while (frameTimes.length > 0 && now - frameTimes[0] > 1000) {
      frameTimes.shift();
    }
    app.fps = frameTimes.length;

    // Retire keycaster chips that have outlived their window, then cap the row.
    app.keys = app.keys.filter((k) => now - k.at < KEY_WINDOW_MS);
    if (app.keys.length > KEY_MAX) app.keys = app.keys.slice(-KEY_MAX);
    flag.keysVisible = app.keys.length > 0;

    let { output, animating, events } = term.render(view(model(app)), {
      pointer: app.pointer,
    });

    for (let ev of events) {
      if (ev.type === "pointerenter") {
        app.entered = new Set([...app.entered, ev.id]);
      } else if (ev.type === "pointerleave") {
        let next = new Set(app.entered);
        next.delete(ev.id);
        app.entered = next;
      } else if (ev.type === "pointerclick") {
        let label = clickLabel(ev.id);
        if (label) app.keys.push({ label, at: now });
        if (ringItems(app.game).includes(ev.id)) activate(app, ev.id);
      }
    }

    Deno.stdout.writeSync(output);
    flag.animating = animating;

    return events;
  }

  draw();

  let ticks = ticker(flag);
  let events = merge(merge(merge(input, pointerEvents), ticks), resizes);

  for (let ev of yield* each(events)) {
    if (ev !== undefined && typeof ev === "object" && "type" in ev) {
      // Resize: rebuild the term at the new size, wipe stale cells, repaint.
      // A drag-resize fires many SIGWINCHes; we read the live size each time
      // and skip when unchanged, so only real size changes rebuild the term.
      if ((ev as { type: string }).type === "resize") {
        let next = consoleSize();
        if (next.width !== width || next.height !== height) {
          width = next.width;
          height = next.height;
          term = yield* until(createTerm({ width, height }));
          Deno.stdout.writeSync(CLEAR_SCREEN);
          draw();
        }
        yield* each.next();
        continue;
      }

      let e = ev as InputEvent | PointerEvent;

      if (e.type === "keydown") {
        if (e.ctrl && e.key === "c") break;
        if (e.key === "q") break;

        let label = keyLabel(e);
        if (label) app.keys.push({ label, at: performance.now() });

        let tab = tabDirection(e);
        if (tab !== null) {
          app.focus = focusBy(app.focus, tab);
        } else if (isActivate(e)) {
          activate(app, focusedId(app.focus));
        } else if (e.key === "n") {
          activate(app, "btn:new");
        } else if (e.key === "u") {
          activate(app, "btn:undo");
        } else {
          let dir = DIRECTIONS[e.key];
          if (dir) doMove(app, dir);
        }
      }

      if ("x" in e && "y" in e && typeof e.x === "number") {
        app.pointer = {
          x: e.x,
          y: e.y,
          down: e.type === "mousedown",
        };
      }
    }

    let pevents = draw();
    for (let pev of pevents) {
      yield* pointerEvents.send(pev);
    }

    yield* each.next();
  }
});
