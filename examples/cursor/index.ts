/**
 * cursor — a shape catalog for the OSC 22 pointer-shape protocol.
 *
 * - Each tile declares a different `pointerShape` (renderer-spec §7.9), so
 *   hovering it asks the terminal to show that exact cursor. Support comes
 *   from the probe (kitty) or the known-support table (ghostty, foot,
 *   xterm ≥ 367); the status line shows whether it is currently on.
 * - Tiles are border-only rounded boxes in Bombshell brand hues (from
 *   bomb.sh); hovering lights the tile's ring and name, so the hover state
 *   reads even in terminals without OSC 22.
 * - The grab tile is double-wide: holding the pointer down on it shows
 *   grabbing, releasing returns to grab — real drag semantics, tracked
 *   through the renderer's hit-test (pointerenter/pointerleave) plus the
 *   parser's mousedown/mouseup.
 * - Curated to the 9 shapes confirmed working in ghostty 1.3.1; ghostty
 *   drops help, progress, wait, move, zoom-in, zoom-out, and none.
 *
 * Run: `deno run examples/cursor/index.ts` (or with node).
 */

import { Buffer } from "node:buffer";
import process from "node:process";
import {
  createChannel,
  each,
  ensure,
  main,
  race,
  resource,
  type Stream,
  until,
} from "effection";
import { createTerm, detectTerminal, type PointerEvent } from "../../mod.ts";
import {
  alternateBuffer,
  cursor,
  mouseTracking,
  settings,
} from "../../settings.ts";
import { useInput } from "../use-input.ts";
import { useStdin } from "../use-stdin.ts";
import { optInPointerShapes } from "../pointer-shape-opt-in.ts";
import { type Ctx, frame } from "./view.ts";

await main(function* () {
  let { columns, rows } = terminalSize();

  let info = yield* until(detectTerminal());

  setRawMode(true);

  let stdin = yield* useStdin();
  let input = useInput(stdin, { terminfo: info });

  let term = yield* until(
    createTerm({ width: columns, height: rows, terminfo: info }),
  );

  let tty = settings(alternateBuffer(), cursor(false), mouseTracking());
  writeStdout(tty.apply);

  // Ask the terminal about itself; CapabilityEvents arrive on the input
  // stream and are routed to term.update() below, which is what switches
  // pointer shapes on once the terminal confirms support.
  writeStdout(info.probe);

  optInPointerShapes(term);

  let entered = new Set<string>();
  let pointer = undefined as Ctx["pointer"];
  let ctx: Ctx = {
    entered,
    pointer,
    capsOn: term.capabilities.pointerShape,
    grabbing: false,
  };

  let pointerEvents = createChannel<PointerEvent, void>();

  yield* ensure(() => {
    // Restore the pointer before leaving: a frame without `pointer` resolves
    // default and emits the OSC 22 reset if a shape was showing (§7.9).
    writeStdout(
      term.render(
        frame({
          entered: new Set(),
          pointer: undefined,
          capsOn: false,
          grabbing: false,
        }),
      ).output,
    );
    setRawMode(false);
    writeStdout(tty.revert);
  });

  let { output } = term.render(frame(ctx));
  writeStdout(output);

  for (let event of yield* each(merge(input, pointerEvents))) {
    if (event.type === "keydown" && event.ctrl && event.key === "c") {
      break;
    }
    if (event.type === "keydown" && event.key === "Escape") {
      break;
    }
    if (event.type === "capability") {
      writeStdout(term.update([event]));
    }
    if (event.type === "pointerenter") {
      ctx.entered.add(event.id);
    }
    if (event.type === "pointerleave") {
      ctx.entered.delete(event.id);
    }
    if (event.type === "mousedown" && ctx.entered.has("shape:grab")) {
      // Press on the grab tile grabs it; the hold persists even if the
      // pointer drifts off the tile mid-drag, exactly like a real grab.
      ctx.grabbing = true;
    }
    if (event.type === "mouseup") {
      ctx.grabbing = false;
    }
    if ("x" in event) {
      ctx.pointer = {
        x: event.x,
        y: event.y,
        down: event.type === "mousedown",
      };
    }

    ctx.capsOn = term.capabilities.pointerShape;

    let { output, events } = term.render(frame(ctx), { pointer: ctx.pointer });
    for (let e of events) {
      yield* pointerEvents.send(e);
    }
    writeStdout(output);

    yield* each.next();
  }
});

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
