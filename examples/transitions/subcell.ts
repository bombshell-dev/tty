/**
 * Sub-cell rect smoothing demo.
 *
 * A 2x3 grid of filled boxes (no borders) that animate between slots. Because
 * the boxes are rectangle fills, their leading/trailing edges land on
 * fractional cells mid-transition and render as block glyphs instead of
 * snapping cell to cell:
 *
 *   s — shuffle within rows  horizontal: eighth-block columns (▏▎▍▌▋▊▉)
 *   v — swap each column     vertical:   eighth-block rows (▁▂▃▄▅▆▇)
 *   d — slide diagonally     diagonal:   both ramps at once (corner cells
 *                            stay blank — see clayterm.c)
 *   w — toggle wide/narrow (animates width)
 *   q or Ctrl+C — quit
 *
 * Filled, border-free boxes are deliberate: a border would emit a separate
 * (still integer-snapped) command that overdraws the fill's fractional edge.
 * easeInOut's shallow ends are where the snapping was worst, so it's also
 * where the sub-cell ramp is easiest to see.
 */

import {
  createChannel,
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
import {
  close,
  createTerm,
  fixed,
  grow,
  type InputEvent,
  type Op,
  open,
  rgba,
  text,
} from "../../mod.ts";
import {
  alternateBuffer,
  cursor,
  mouseTracking,
  settings,
} from "../../settings.ts";
import { useInput } from "../use-input.ts";
import { useStdin } from "../use-stdin.ts";

const PALETTE = [
  rgba(225, 138, 50),
  rgba(111, 173, 162),
  rgba(184, 87, 134),
  rgba(87, 134, 184),
  rgba(134, 184, 87),
  rgba(184, 134, 87),
];

const ROOT_BG = rgba(18, 18, 22);
const HINT_BG = rgba(40, 40, 55);
const KEY_COLOR = rgba(255, 220, 120);
const LABEL_COLOR = rgba(200, 200, 220);

interface Box {
  id: number;
  color: number;
}

interface State {
  boxes: Box[];
  wide: boolean;
}

const COLS = 3;

function shuffleRows<T>(arr: T[]): T[] {
  let out = arr.slice();
  for (let lo = 0; lo < out.length; lo += COLS) {
    let hi = Math.min(lo + COLS, out.length);
    for (let i = hi - 1; i > lo; i--) {
      let j = lo + Math.floor(Math.random() * (i - lo + 1));
      let tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
  }
  return out;
}

/* Swap the two boxes in every column: vertical movement only. */
function swapColumns<T>(arr: T[]): T[] {
  let out = arr.slice();
  for (let c = 0; c < COLS; c++) {
    let tmp = out[c];
    out[c] = out[c + COLS];
    out[c + COLS] = tmp;
  }
  return out;
}

/* Flip every box to the other row and shift it one column: row and column
 * both change, so x and y lerp together and the corners composite. */
function slideDiagonal<T>(arr: T[]): T[] {
  let out: T[] = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let r = Math.floor(i / COLS);
    let c = i % COLS;
    out[(1 - r) * COLS + ((c + 1) % COLS)] = arr[i];
  }
  return out;
}

function hint(key: string, label: string): Op[] {
  return [
    text(key, { color: KEY_COLOR }),
    text(` ${label}   `, { color: LABEL_COLOR }),
  ];
}

function view(state: State): Op[] {
  let ops: Op[] = [];

  ops.push(
    open("root", {
      layout: { width: grow(), height: grow(), direction: "ttb" },
      bg: ROOT_BG,
    }),
  );

  ops.push(
    open("hintbar", {
      layout: {
        width: grow(),
        height: fixed(1),
        direction: "ltr",
        padding: { left: 2, right: 2, top: 0, bottom: 0 },
        alignY: "center",
      },
      bg: HINT_BG,
    }),
    ...hint("s", "shuffle"),
    ...hint("v", "vertical"),
    ...hint("d", "diagonal"),
    ...hint("w", "wide/narrow"),
    ...hint("q", "quit"),
    close(),
  );

  ops.push(
    open("grid", {
      layout: {
        width: grow(),
        height: grow(),
        direction: "ttb",
        padding: { left: 2, right: 2, top: 1, bottom: 1 },
        gap: 1,
      },
    }),
  );

  for (let r = 0; r < 2; r++) {
    ops.push(
      open(`row:${r}`, {
        layout: {
          width: grow(),
          height: grow(),
          direction: "ltr",
          gap: 2,
          alignX: "center",
          alignY: "center",
        },
      }),
    );
    for (let c = 0; c < COLS; c++) {
      let b = state.boxes[r * COLS + c];
      ops.push(
        open(`box:${b.id}`, {
          layout: {
            width: state.wide ? grow() : fixed(7),
            height: fixed(5),
          },
          bg: b.color,
          transition: {
            duration: 0.5,
            easing: "easeInOut",
            properties: ["width", "position"],
          },
        }),
        close(),
      );
    }
    ops.push(close());
  }

  ops.push(close());
  ops.push(close());

  return ops;
}

function ticker(flag: { animating: boolean }): Stream<void, void> {
  return resource(function* (provide) {
    let ch = createChannel<void, void>();
    yield* spawn(function* () {
      while (true) {
        if (flag.animating) {
          yield* sleep(2);
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
    let sub = {
      a: yield* a,
      b: yield* b,
    };
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

await main(function* () {
  let { columns, rows } = Deno.stdout.isTerminal()
    ? Deno.consoleSize()
    : { columns: 80, rows: 24 };

  Deno.stdin.setRaw(true);
  yield* ensure(() => Deno.stdin.setRaw(false));

  let stdin = yield* useStdin();
  let input = useInput(stdin);

  let term = yield* until(createTerm({ width: columns, height: rows }));

  let tty = settings(alternateBuffer(), cursor(false), mouseTracking());
  Deno.stdout.writeSync(tty.apply);
  yield* ensure(() => {
    Deno.stdout.writeSync(tty.revert);
  });

  let state: State = {
    boxes: Array.from({ length: PALETTE.length }, (_, i) => ({
      id: i,
      color: PALETTE[i],
    })),
    wide: false,
  };

  let flag = { animating: false };

  function draw(): void {
    let { output, animating } = term.render(view(state));
    flag.animating = animating;
    Deno.stdout.writeSync(output);
  }

  draw();

  let ticks = ticker(flag);
  let events = merge(input, ticks);

  for (let ev of yield* each(events)) {
    if (ev !== undefined && typeof ev === "object" && "type" in ev) {
      let e = ev as InputEvent;

      if (e.type === "keydown") {
        if (e.ctrl && e.key === "c") {
          break;
        }
        if (e.key === "q") {
          break;
        }
        if (e.key === "s") {
          state = { ...state, boxes: shuffleRows(state.boxes) };
        }
        if (e.key === "v") {
          state = { ...state, boxes: swapColumns(state.boxes) };
        }
        if (e.key === "d") {
          state = { ...state, boxes: slideDiagonal(state.boxes) };
        }
        if (e.key === "w") {
          state = { ...state, wide: !state.wide };
        }
      }
    }

    draw();
    yield* each.next();
  }
});
