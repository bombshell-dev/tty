/**
 * Sub-cell rect smoothing demo.
 *
 * A row of filled boxes (no borders) that animate their position. Because the
 * boxes are rectangle fills, their leading/trailing edges land on fractional
 * cell columns mid-transition and render as eighth-block glyphs (▏▎▍▌▋▊▉)
 * instead of snapping column to column.
 *
 * Press 's' to shuffle (animates position).
 * Press 'w' to toggle wide/narrow (animates width).
 * Press 'q' or Ctrl+C to quit.
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

function fisherYates<T>(arr: T[]): T[] {
  let out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    let tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
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
    ...hint("w", "wide/narrow"),
    ...hint("q", "quit"),
    close(),
  );

  ops.push(
    open("row", {
      layout: {
        width: grow(),
        height: grow(),
        direction: "ltr",
        padding: { left: 2, right: 2, top: 1, bottom: 1 },
        gap: 2,
        alignY: "center",
      },
    }),
  );

  for (let b of state.boxes) {
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
          state = { ...state, boxes: fisherYates(state.boxes) };
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
