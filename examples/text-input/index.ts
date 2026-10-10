import { Buffer } from "node:buffer";
import process from "node:process";
import { each, ensure, main, until } from "effection";
import {
  close,
  createTerm,
  detectTerminal,
  fixed,
  grow,
  type KeyEvent,
  type Op,
  open,
  rgba,
  text,
} from "../../mod.ts";
import {
  alternateBuffer,
  mouseTracking,
  progressiveInput,
  settings,
} from "../../settings.ts";
import { useInput } from "../use-input.ts";
import { useStdin } from "../use-stdin.ts";
import { optInPointerShapes } from "../pointer-shape-opt-in.ts";

const bg = rgba(20, 20, 30);
const inputBg = rgba(35, 35, 50);
const label = rgba(180, 180, 200);
const hint = rgba(80, 80, 100);

await main(function* () {
  let { columns, rows } = terminalSize();

  let info = yield* until(detectTerminal());

  setRawMode(true);

  let stdin = yield* useStdin();
  let input = useInput(stdin, { terminfo: info });

  let term = yield* until(
    createTerm({ width: columns, height: rows, terminfo: info }),
  );

  let tty = settings(alternateBuffer(), progressiveInput(1), mouseTracking());
  writeStdout(tty.apply);

  // Ask the terminal about itself (OSC color queries, XTGETTCAP, DECRPM, DA1).
  // Responses arrive on the input stream as CapabilityEvents and are routed to
  // term.update() in the loop below, which is what switches on features like
  // pointer shapes (renderer-spec §7.9) once the terminal confirms support.
  writeStdout(info.probe);

  optInPointerShapes(term);

  let value = "";
  let caret = 0;
  let pointer = undefined as
    | { x: number; y: number; down: boolean }
    | undefined;

  yield* ensure(() => {
    setRawMode(false);
    writeStdout(tty.revert);
  });

  let { output } = term.render(frame(value, caret));
  writeStdout(output);

  for (let event of yield* each(input)) {
    if (event.type === "keydown") {
      let key = event as KeyEvent;

      if (key.ctrl && key.key === "c") {
        break;
      }

      if (key.key === "Escape") {
        break;
      }

      if (key.key === "ArrowLeft") {
        if (caret > 0) {
          caret--;
        }
      } else if (key.key === "ArrowRight") {
        if (caret < [...value].length) {
          caret++;
        }
      } else if (key.key === "Backspace") {
        if (caret > 0) {
          let chars = [...value];
          chars.splice(caret - 1, 1);
          value = chars.join("");
          caret--;
        }
      } else if (
        key.key.length === 1 &&
        !key.ctrl &&
        !key.alt
      ) {
        let chars = [...value];
        chars.splice(caret, 0, key.key);
        value = chars.join("");
        caret++;
      }
    } else if (event.type === "capability") {
      writeStdout(term.update([event]));
    } else if ("x" in event) {
      pointer = {
        x: event.x,
        y: event.y,
        down: event.type === "mousedown",
      };
    }

    ({ output } = term.render(frame(value, caret), { pointer }));
    writeStdout(output);

    yield* each.next();
  }
});

function frame(value: string, caret: number): Op[] {
  return [
    open("root", {
      layout: {
        width: grow(),
        height: grow(),
        direction: "ttb",
        padding: { left: 2, right: 2, top: 1, bottom: 1 },
        gap: 1,
      },
      bg,
    }),
    open("label", { layout: { height: fixed(1) } }),
    text("Name:", { color: label }),
    close(),
    open("input-box", {
      layout: {
        width: fixed(40),
        height: fixed(1),
        padding: { left: 1, right: 1 },
      },
      bg: inputBg,
      pointerShape: "text",
    }),
    text(value, { color: label, caret }),
    close(),
    open("hint", { layout: { height: fixed(1) } }),
    text("← → move  Backspace delete  Esc or Ctrl+C exit", { color: hint }),
    close(),
    close(),
  ];
}

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
