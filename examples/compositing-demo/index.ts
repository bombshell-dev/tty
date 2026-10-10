// deno-lint-ignore-file no-fallthrough
// Compositing demo — renderer-spec §7.9.
//
// A backdrop of colorful tiles with drifting semi-transparent squares
// compositing over them, live. Keys make the whole stack visible:
//
//   1/2/3   fold a colordepth capability event — truecolor → 256 → 16,
//           narrowing applied to composited results (color-encoding-spec)
//   t       toggle the tile backdrop: bare mode draws no explicit
//           backgrounds, so the squares composite over the terminal's
//           own background — queried live via OSC 11
//   arrows  move the active square
//   tab     cycle the active square
//   a       pause/resume the active square's drift
//   q/Ctrl+C quit
//
// Run with: deno run --allow-read --allow-env examples/compositing-demo/index.ts
import { Buffer } from "node:buffer";
import process from "node:process";
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
  createTerm,
  detectTerminal,
  type InputEvent,
  type KeyEvent,
} from "../../mod.ts";
import { alternateBuffer, cursor, settings } from "../../settings.ts";
import { useInput } from "../use-input.ts";
import { useStdin } from "../use-stdin.ts";
import { frame, type Square, SQUARES } from "./scene.ts";

function terminalSize(): { columns: number; rows: number } {
  return process.stdout.isTTY
    ? {
      columns: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
    }
    : { columns: 80, rows: 24 };
}

function setRawMode(enabled: boolean): void {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(enabled);
  }
}

function writeStdout(bytes: Uint8Array): void {
  process.stdout.write(Buffer.from(bytes));
}

function merge<A, B, TClose>(
  a: Stream<A, TClose>,
  b: Stream<B, TClose>,
): Stream<A | B, TClose> {
  return resource(function* (provide) {
    let subscription = {
      a: yield* a,
      b: yield* b,
    };

    return yield* provide({
      *next() {
        return yield* race([subscription.a.next(), subscription.b.next()]);
      },
    });
  });
}

/** The tier override folded through the 1/2/3 keys. -1 keeps the
 * terminal's own color evidence (color-encoding-spec §6.1). */
let tier = -1;
/** Bare mode: no explicit background cells — the squares composite over
 * the terminal's own background via the §7.9 chain. */
let bare = true;

await main(function* () {
  let { columns, rows } = terminalSize();

  setRawMode(true);

  let stdin = yield* useStdin();
  let input = useInput(stdin);

  // The demo runs with the terminal's own color evidence: a truecolor
  // terminal starts in the truecolor tier, a 256-color one at 256.
  let terminfo = yield* until(detectTerminal());
  let term = yield* until(createTerm({
    width: columns,
    height: rows,
    terminfo,
  }));

  let tty = settings(alternateBuffer(), cursor(false));
  writeStdout(tty.apply);

  yield* ensure(() => {
    setRawMode(false);
    writeStdout(tty.revert);
  });

  // The background color query: ask the terminal for its actual theme
  // (OSC 10/11/12 + capability probes). Replies arrive as
  // CapabilityEvent values through scan(); folding them updates
  // term.capabilities.theme and the compositing destinations
  // (renderer-spec §7.9).
  writeStdout(terminfo.probe);

  /** The reported background as a hex label for the bar, or undefined
   * until the OSC 11 reply arrives. */
  function reportedBgHex(): string | undefined {
    let bg = term.capabilities.theme.background;
    if (!bg) return undefined;
    let hex = (v: number) => v.toString(16).padStart(2, "0");
    return `#${hex(bg.r)}${hex(bg.g)}${hex(bg.b)}`;
  }

  writeStdout(term.render(frame(columns, rows, tier, bare)).output);

  let lastAt = performance.now() / 1000;
  let active = 0;

  let ticker: Stream<number, void> = resource(function* (provide) {
    let ch = createChannel<number, void>();
    yield* spawn(function* () {
      while (true) {
        yield* sleep(16);
        yield* ch.send(performance.now());
      }
    });
    let sub = yield* ch;
    yield* provide(sub);
  });

  for (let event of yield* each(merge(input, ticker))) {
    if (typeof event !== "number") {
      if (event.type === "keydown") {
        let key = event.key;
        if (event.ctrl && key === "c") break;
        if (key === "q") break;
        if (key === "1" || key === "2" || key === "3") {
          tier = key === "1" ? -1 : key === "2" ? 0 : 1;
          let value: "truecolor" | "256" | "16" = tier === -1
            ? "truecolor"
            : tier === 0
            ? "256"
            : "16";
          term.update([{ type: "capability", key: "colordepth", value }]);
        }
        if (key === "tab") active = (active + 1) % SQUARES.length;
        if (key === "t") bare = !bare;
        if (key === "a") {
          let s = SQUARES[active];
          let paused = s.vx === 0 && s.vy === 0;
          s.vx = paused ? s.vx0 : 0;
          s.vy = paused ? s.vy0 : 0;
        }
        if (
          key === "up" || key === "down" || key === "left" || key === "right"
        ) {
          let s = SQUARES[active];
          s.vx0 = Math.abs(s.vx0) *
            (key === "left" ? -1 : key === "right" ? 1 : Math.sign(s.vx0 || 1));
          s.vy0 = Math.abs(s.vy0) *
            (key === "up" ? -1 : key === "down" ? 1 : Math.sign(s.vy0 || 1));
          s.vx = key === "left" || key === "right" ? s.vx0 : s.vx;
          s.vy = key === "up" || key === "down" ? s.vy0 : s.vy;
        }
      }

      if (event.type === "resize") {
        let size = event as { width: number; height: number };
        columns = size.width;
        rows = size.height;
        term.update([{ type: "resize", width: columns, height: rows }]);
      }

      // Fold probe replies (theme colors, colordepth, …). The push
      // logic inside update() moves the reported background into the
      // renderer's compositing destinations; a bare-mode frame then
      // composites over the terminal's real background color.
      if (event.type === "capability") {
        term.update([event]);
      }
    }

    // Drift: squares bounce within the terminal bounds. Every frame
    // recomposites them over the tiles in the current tier's encoding.
    let now = performance.now() / 1000;
    let dt = Math.min(now - lastAt, 0.1);
    lastAt = now;
    for (let s of SQUARES) {
      if (s.vx === 0 && s.vy === 0) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.x < 0) {
        s.x = 0;
        s.vx = Math.abs(s.vx);
        s.vx0 = Math.abs(s.vx0);
      }
      if (s.y < 0) {
        s.y = 0;
        s.vy = Math.abs(s.vy);
        s.vy0 = Math.abs(s.vy0);
      }
      if (s.x + s.w > columns) {
        s.x = columns - s.w;
        s.vx = -Math.abs(s.vx);
        s.vx0 = -Math.abs(s.vx0);
      }
      if (s.y + s.h > rows - 1) {
        s.y = rows - 1 - s.h;
        s.vy = -Math.abs(s.vy);
        s.vy0 = -Math.abs(s.vy0);
      }
    }

    let { output } = term.render(
      frame(columns, rows, tier, bare, reportedBgHex()),
      {
        deltaTime: dt,
      },
    );
    writeStdout(output);

    // Effection's each protocol: every iteration must end with
    // each.next(), which fetches the next value for the for-of to hand
    // out (examples/keyboard, transitions do the same).
    yield* each.next();
  }
});
