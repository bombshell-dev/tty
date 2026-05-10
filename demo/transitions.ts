/**
 * Interactive transitions demo — a sidebar that smoothly expands and collapses.
 *
 * Press Enter to open the menu sidebar, Esc to close it, q or Ctrl+C to quit.
 * Exercises v1 transitions: width + bg animated simultaneously.
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
  percent,
  rgba,
  text,
} from "../mod.ts";
import { alternateBuffer, cursor, settings } from "../settings.ts";
import { useInput } from "./use-input.ts";
import { useStdin } from "./use-stdin.ts";

const SIDEBAR_BG_OPEN = rgba(80, 80, 140);
const SIDEBAR_BG_CLOSED = rgba(30, 30, 50);
const CONTENT_BG = rgba(18, 18, 22);
const MODELINE_BG = rgba(40, 40, 55);
const TEXT = rgba(220, 220, 220);
const DIM = rgba(130, 130, 150);
const HEADING = rgba(255, 220, 120);
const MENU_ITEM = rgba(180, 200, 240);
const KEY_LABEL = rgba(255, 220, 120);

const MENU_ITEMS = [
  "New file",
  "Open file…",
  "Save",
  "Save as…",
  "—",
  "Preferences",
  "Quit (q)",
];

const BODY = [
  { kind: "h1", text: "Lorem Ipsum" },
  {
    kind: "p",
    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  },
  {
    kind: "p",
    text: "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  },
  { kind: "h2", text: "Section" },
  {
    kind: "p",
    text: "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
  },
  {
    kind: "p",
    text: "Duis aute irure dolor in reprehenderit in voluptate velit esse.",
  },
  {
    kind: "p",
    text: "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui.",
  },
];

interface State {
  menuOpen: boolean;
}

function view(state: State): Op[] {
  let ops: Op[] = [];

  ops.push(
    open("root", {
      layout: { width: grow(), height: grow(), direction: "ttb" },
    }),
  );

  ops.push(
    open("main-row", {
      layout: { width: grow(), height: grow(), direction: "ltr" },
    }),
  );

  ops.push(
    open("sidebar", {
      layout: {
        width: state.menuOpen ? percent(0.2) : fixed(2),
        height: grow(),
        direction: "ttb",
        padding: { left: 1, right: 1, top: 1, bottom: 1 },
        gap: 1,
      },
      bg: state.menuOpen ? SIDEBAR_BG_OPEN : SIDEBAR_BG_CLOSED,
      clip: { horizontal: true },
      transition: {
        duration: 0.2,
        easing: "easeInOut",
        properties: ["width", "bg"],
      },
    }),
  );

  if (state.menuOpen) {
    ops.push(
      open("menu-title", { layout: { height: fixed(1) } }),
      text("Menu", { color: HEADING, wrap: 2 }),
      close(),
    );
    for (let item of MENU_ITEMS) {
      ops.push(
        open(`menu:${item}`, { layout: { height: fixed(1) } }),
        text(item, { color: item === "—" ? DIM : MENU_ITEM, wrap: 2 }),
        close(),
      );
    }
  }

  ops.push(close()); // sidebar

  ops.push(
    open("content", {
      layout: {
        width: grow(),
        height: grow(),
        direction: "ttb",
        padding: { left: 3, right: 3, top: 1, bottom: 1 },
        gap: 1,
      },
      bg: CONTENT_BG,
    }),
  );

  for (let { kind, text: t } of BODY) {
    ops.push(open(`body:${t.slice(0, 8)}`, { layout: { height: fixed(1) } }));
    let color = kind === "h1" ? HEADING : kind === "h2" ? KEY_LABEL : TEXT;
    ops.push(text(t, { color }));
    ops.push(close());
  }

  ops.push(close()); // content

  ops.push(close()); // main-row

  ops.push(
    open("modeline", {
      layout: {
        width: grow(),
        height: fixed(1),
        direction: "ltr",
        padding: { left: 1, right: 1 },
        gap: 2,
      },
      bg: MODELINE_BG,
    }),
    open("mod:quit", { layout: { direction: "ltr", gap: 0 } }),
    text("q", { color: KEY_LABEL }),
    text(" quit", { color: TEXT }),
    close(),
    open("mod:menu", { layout: { direction: "ltr", gap: 0 } }),
    text("enter", { color: KEY_LABEL }),
    text(" show menu", { color: TEXT }),
    close(),
    open("mod:hide", { layout: { direction: "ltr", gap: 0 } }),
    text("esc", { color: KEY_LABEL }),
    text(" hide menu", { color: TEXT }),
    close(),
    close(), // modeline
  );

  ops.push(close()); // root

  return ops;
}

// A stream that emits at ~60fps intervals, but only while the shared flag is true.
function ticker(flag: { animating: boolean }): Stream<void, void> {
  return resource(function* (provide) {
    let ch = createChannel<void, void>();
    yield* spawn(function* () {
      while (true) {
        if (flag.animating) {
          yield* sleep(16);
          yield* ch.send();
        } else {
          // Park until animating becomes true; check every 50ms.
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

  let tty = settings(alternateBuffer(), cursor(false));
  Deno.stdout.writeSync(tty.apply);
  yield* ensure(() => {
    Deno.stdout.writeSync(tty.revert);
  });

  let state: State = { menuOpen: false };
  let flag = { animating: false };

  function draw(): void {
    let { output, animating } = term.render(view(state));
    flag.animating = animating;
    Deno.stdout.writeSync(output);
  }

  draw();

  let ticks = ticker(flag);
  let events = merge(input, ticks);

  for (let _ of yield* each(events)) {
    if (_ !== undefined && typeof _ === "object" && "type" in _) {
      let event = _ as InputEvent;
      if (event.type === "keydown") {
        if (event.ctrl && event.key === "c") {
          break;
        }
        if (event.key === "q") {
          break;
        }
        if (event.key === "Enter") {
          state = { ...state, menuOpen: true };
        }
        if (event.key === "Escape") {
          state = { ...state, menuOpen: false };
        }
      }
    }
    draw();
    yield* each.next();
  }
});
