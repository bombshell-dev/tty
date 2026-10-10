// deno-lint-ignore-file no-fallthrough
// Compositing demo — renderer-spec §7.9.
//
// A mixed backdrop — alpha scrim tiles over your terminal's reported
// background, a gradient, prose, a file-manager panel — with boxes of
// different colors and opacities bouncing over it and a large
// translucent veil you drive with the keys:
//
//   1/2/3   fold a colordepth capability event — truecolor → 256 → 16,
//           narrowing applied to composited results (color-encoding-spec)
//   t       toggle the full-bleed fields: bare mode keeps only text
//           and panel content, compositing over the terminal's own
//           background — queried live via OSC 11
//   arrows  move the translucent veil over the mixed backdrop
//           (shift+arrows jump: ±10 columns / ±5 rows)
//   tab     cycle the veil's color
//   -/+     narrow or widen the veil's alpha
//   space   pause/resume the bouncing boxes
//   q/Ctrl+C quit
//
// Run with: deno run --allow-read --allow-env examples/compositing-demo/index.ts
import { Buffer } from "node:buffer";
import process from "node:process";
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
import {
  createTerm,
  detectTerminal,
  type InputEvent,
  type KeyEvent,
} from "../../mod.ts";
import { alternateBuffer, cursor, settings } from "../../settings.ts";
import { useInput } from "../use-input.ts";
import { useStdin } from "../use-stdin.ts";
import {
  advanceBoxes,
  clampVeil,
  frame,
  type Rgb,
  VEIL,
  VEIL_COLORS,
} from "./scene.ts";

function terminalSize(): { columns: number; rows: number } {
  return Deno.stdout.isTerminal()
    ? Deno.consoleSize()
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
/** Bare mode: the full-bleed fields (tiles, gradient) drop out, so the
 * veil composites over the terminal's own background via the §7.9
 * chain. Text and panel content stay. */
let bare = false;

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

  // The input parser never emits resize events (examples/2048 found the
  // same gap), so SIGWINCH is bridged into the event stream here; the
  // handler reads the live size, so a drag-resize's burst of signals
  // coalesces into real size changes only.
  let resizes = createSignal<{ type: "resize" }, void>();
  let onWinch = () => resizes.send({ type: "resize" });
  if (Deno.build.os !== "windows") {
    Deno.addSignalListener("SIGWINCH", onWinch);
    yield* ensure(() => Deno.removeSignalListener("SIGWINCH", onWinch));
  }

  // The background color query: ask the terminal for its actual theme
  // (OSC 10/11/12 + capability probes). Replies arrive as
  // CapabilityEvent values through scan(); folding them updates
  // term.capabilities.theme and the compositing destinations
  // (renderer-spec §7.9).
  writeStdout(terminfo.probe);

  /** The resolved background per the §7.9 chain as far as the host can
   * see it: the reported theme, else undefined (the renderer's own
   * chain falls through defaultTheme to black/white). Drives both the
   * bare-mode compositing destinations and the UI polarity. */
  function reportedBg(): Rgb | undefined {
    return term.capabilities.theme.background;
  }

  clampVeil(columns, rows);
  writeStdout(term.render(frame(columns, rows, tier, bare)).output);

  // The bouncing boxes need a render ticker; the veil is input-driven.
  // The loop renders on every event — key, tick, or resize.
  let lastAt = performance.now() / 1000;
  let bounce = true;

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

  for (let event of yield* each(merge(merge(input, ticker), resizes))) {
    if (typeof event !== "number") {
      if (event.type === "keydown" || event.type === "keyrepeat") {
        let key = event.key;
        if (event.ctrl && key === "c") break;
        if (key === "q") break;
        if (key === " ") bounce = !bounce;
        if (key === "1" || key === "2" || key === "3") {
          tier = key === "1" ? -1 : key === "2" ? 0 : 1;
          let value: "truecolor" | "256" | "16" = tier === -1
            ? "truecolor"
            : tier === 0
            ? "256"
            : "16";
          term.update([{ type: "capability", key: "colordepth", value }]);
        }
        if (key === "t") bare = !bare;
        if (key === "Tab") {
          VEIL.colorIdx = (VEIL.colorIdx + 1) % VEIL_COLORS.length;
        }
        if (key === "-" || key === "_") {
          VEIL.alpha = Math.max(16, VEIL.alpha - 16);
        }
        if (key === "+" || key === "=") {
          VEIL.alpha = Math.min(240, VEIL.alpha + 16);
        }
        if (key === "ArrowUp") {
          VEIL.y += event.shift ? -5 : -1;
        }
        if (key === "ArrowDown") {
          VEIL.y += event.shift ? 5 : 1;
        }
        if (key === "ArrowLeft") {
          VEIL.x += event.shift ? -10 : -1;
        }
        if (key === "ArrowRight") {
          VEIL.x += event.shift ? 10 : 1;
        }
        // Arrow handling doubled into keydown and keyrepeat, so
        // holding an arrow glides the veil.
      }

      if (event.type === "resize") {
        // SIGWINCH is only a wake-up: read the live size and update the
        // term in place (renderer-spec §7.7 keeps the instance and the
        // color-capability state).
        let next = terminalSize();
        if (next.columns !== columns || next.rows !== rows) {
          columns = next.columns;
          rows = next.rows;
          term.update([{ type: "resize", width: columns, height: rows }]);
        }
      }

      // Fold probe replies (theme colors, colordepth, …). The push logic
      // inside update() moves the reported background into the renderer's
      // compositing destinations; a bare-mode frame then composites over
      // the terminal's real background color.
      if (event.type === "capability") {
        term.update([event]);
      }
    }

    // Bouncing boxes: advance on ticks (paused or mid-drag on other
    // events costs nothing), bouncing off the walls, settling at the
    // boundary. They slide under the veil and the bar.
    let now = performance.now() / 1000;
    let dt = Math.min(now - lastAt, 0.1);
    lastAt = now;
    if (bounce) advanceBoxes(dt, columns, rows);

    // Keep the veil inside the bounds and off the bar row (boxes never
    // render over the toolbar).
    clampVeil(columns, rows);

    let { output } = term.render(
      frame(columns, rows, tier, bare, reportedBg()),
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
