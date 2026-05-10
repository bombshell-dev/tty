/**
 * Clay-transitions demo — a port of the raylib-transitions example to clayterm.
 *
 * A grid of colored boxes that animate position, size, and background color.
 * Press 's' to shuffle (animates position), 'c' to recolor (animates bg).
 * Hover any box to see a bg-tint transition on mouse over.
 * Press 'q' or Ctrl+C to quit.
 *
 * Omits enter/exit transitions and "Add Box" (v1 constraints).
 * Overlay-color field is not yet in the v1 command buffer; hover tint is
 * achieved by blending the bg color toward a highlight shade instead.
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
  type PointerEvent,
  rgba,
  text,
} from "../mod.ts";
import {
  alternateBuffer,
  cursor,
  mouseTracking,
  settings,
} from "../settings.ts";
import { useInput } from "./use-input.ts";
import { useStdin } from "./use-stdin.ts";

const DEFAULT_PALETTE = [
  rgba(225, 138, 50),
  rgba(111, 173, 162),
  rgba(184, 87, 134),
  rgba(87, 134, 184),
  rgba(134, 184, 87),
  rgba(184, 134, 87),
  rgba(87, 184, 134),
  rgba(134, 87, 184),
  rgba(200, 100, 100),
  rgba(100, 200, 100),
  rgba(100, 100, 200),
  rgba(200, 200, 100),
  rgba(200, 100, 200),
  rgba(100, 200, 200),
  rgba(180, 160, 80),
  rgba(80, 160, 180),
];

const PINK_PALETTE = DEFAULT_PALETTE.map((c) => {
  let r = (c >> 24) & 0xff;
  let g = (c >> 16) & 0xff;
  let b = (c >> 8) & 0xff;
  let a = c & 0xff;
  let pr = Math.min(255, r + 80);
  let pg = Math.max(0, g - 60);
  let pb = Math.max(0, Math.min(255, b + 40));
  return rgba(pr, pg, pb, a);
});

// Blend a packed rgba color toward white by ratio [0,1].
function lighten(color: number, ratio: number): number {
  let r = (color >> 24) & 0xff;
  let g = (color >> 16) & 0xff;
  let b = (color >> 8) & 0xff;
  let a = color & 0xff;
  return rgba(
    Math.round(r + (255 - r) * ratio),
    Math.round(g + (255 - g) * ratio),
    Math.round(b + (255 - b) * ratio),
    a,
  );
}

// Lighten ratio applied to bg when box is hovered (blends toward white).
const HOVER_LIGHTEN = 0.35;

const ROOT_BG = rgba(18, 18, 22);
const TOPBAR_BG = rgba(40, 40, 55);
const BTN_DEFAULT = rgba(60, 60, 80);
const BTN_HOVER = rgba(90, 90, 120);
const KEY_COLOR = rgba(255, 220, 120);
const LABEL_COLOR = rgba(200, 200, 220);

const COLS = 4;

interface Box {
  id: number;
  color: number;
}

interface State {
  boxes: Box[];
  palette: "default" | "pink";
  entered: Set<string>;
  pointer: { x: number; y: number; down: boolean } | undefined;
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

function recolor(boxes: Box[], palette: "default" | "pink"): Box[] {
  let pal = palette === "pink" ? PINK_PALETTE : DEFAULT_PALETTE;
  return boxes.map((b, i) => ({ ...b, color: pal[i % pal.length] }));
}

function button(
  id: string,
  label: string,
  hovered: boolean,
  key: string,
): Op[] {
  return [
    open(id, {
      layout: {
        direction: "ltr",
        padding: { left: 2, right: 2, top: 0, bottom: 0 },
        alignX: 2,
        alignY: 2,
        height: grow(),
      },
      bg: hovered ? BTN_HOVER : BTN_DEFAULT,
      border: hovered
        ? { color: KEY_COLOR, left: 1, right: 1, top: 1, bottom: 1 }
        : undefined,
    }),
    text(key, { color: KEY_COLOR }),
    text(` ${label}`, { color: LABEL_COLOR }),
    close(),
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
    open("topbar", {
      layout: {
        width: grow(),
        height: fixed(3),
        direction: "ltr",
        padding: { left: 2, right: 2, top: 0, bottom: 0 },
        gap: 2,
        alignY: 2,
      },
      bg: TOPBAR_BG,
    }),
  );

  ops.push(
    ...button(
      "btn:shuffle",
      "shuffle",
      state.entered.has("btn:shuffle"),
      "s",
    ),
    ...button(
      "btn:recolor",
      "recolor",
      state.entered.has("btn:recolor"),
      "c",
    ),
    ...button("btn:quit", "quit", state.entered.has("btn:quit"), "q"),
  );

  ops.push(close());

  ops.push(
    open("grid", {
      layout: {
        width: grow(),
        height: grow(),
        direction: "ttb",
        padding: { left: 1, right: 1, top: 1, bottom: 1 },
        gap: 1,
      },
    }),
  );

  let boxes = state.boxes;
  let rows = Math.ceil(boxes.length / COLS);

  for (let r = 0; r < rows; r++) {
    ops.push(
      open(`row:${r}`, {
        layout: {
          width: grow(),
          height: grow(),
          direction: "ltr",
          gap: 1,
        },
      }),
    );

    for (let c = 0; c < COLS; c++) {
      let i = r * COLS + c;
      if (i >= boxes.length) {
        break;
      }
      let b = boxes[i];
      let bid = `box:${b.id}`;
      let hov = state.entered.has(bid);
      let borderColor = hov ? lighten(b.color, HOVER_LIGHTEN) : b.color;
      ops.push(
        open(bid, {
          layout: {
            width: grow(),
            height: grow(),
            alignX: 2,
            alignY: 2,
          },
          border: {
            color: borderColor,
            left: 1,
            right: 1,
            top: 1,
            bottom: 1,
          },
          transition: {
            duration: 0.4,
            easing: "easeInOut",
            properties: ["width", "position", "borderColor"],
            interactive: true,
          },
        }),
        text(`${b.id < 10 ? "0" : ""}${b.id}`, { color: b.color }),
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

  let count = 16;
  let pal = DEFAULT_PALETTE;
  let initialBoxes: Box[] = Array.from({ length: count }, (_, i) => ({
    id: i,
    color: pal[i % pal.length],
  }));

  let state: State = {
    boxes: initialBoxes,
    palette: "default",
    entered: new Set(),
    pointer: undefined,
  };

  let flag = { animating: false };

  function draw(): void {
    let { output, animating, events } = term.render(view(state), {
      pointer: state.pointer,
    });
    flag.animating = animating;
    for (let ev of events) {
      if (ev.type === "pointerenter") {
        state = { ...state, entered: new Set([...state.entered, ev.id]) };
      } else if (ev.type === "pointerleave") {
        let next = new Set(state.entered);
        next.delete(ev.id);
        state = { ...state, entered: next };
      }
    }
    Deno.stdout.writeSync(output);
  }

  draw();

  let pointer = createChannel<PointerEvent, void>();
  let ticks = ticker(flag);
  let events = merge(merge(input, pointer), ticks);

  for (let ev of yield* each(events)) {
    if (ev !== undefined && typeof ev === "object" && "type" in ev) {
      let e = ev as InputEvent | PointerEvent;

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
        if (e.key === "c") {
          let next: "default" | "pink" = state.palette === "default"
            ? "pink"
            : "default";
          state = {
            ...state,
            palette: next,
            boxes: recolor(state.boxes, next),
          };
        }
      }

      if ("x" in e && "y" in e) {
        let me = e as { x: number; y: number; type: string };
        state = {
          ...state,
          pointer: {
            x: me.x,
            y: me.y,
            down: me.type === "mousedown",
          },
        };
      }
    }

    let { output, animating, events: pevents } = term.render(view(state), {
      pointer: state.pointer,
    });
    flag.animating = animating;

    for (let pev of pevents) {
      if (pev.type === "pointerenter") {
        state = { ...state, entered: new Set([...state.entered, pev.id]) };
      } else if (pev.type === "pointerleave") {
        let next = new Set(state.entered);
        next.delete(pev.id);
        state = { ...state, entered: next };
      }
      yield* pointer.send(pev);
    }

    Deno.stdout.writeSync(output);

    yield* each.next();
  }
});
