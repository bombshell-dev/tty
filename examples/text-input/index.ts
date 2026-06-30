import { Buffer } from "node:buffer";
import process from "node:process";
import { each, ensure, main, until } from "effection";
import {
  close,
  createTerm,
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
  progressiveInput,
  settings,
} from "../../settings.ts";
import { useInput } from "../use-input.ts";
import { useStdin } from "../use-stdin.ts";

const bg = rgba(20, 20, 30);
const inputBg = rgba(35, 35, 50);
const border = rgba(80, 100, 160);
const label = rgba(180, 180, 200);
const hint = rgba(80, 80, 100);

await main(function* () {
  let { columns, rows } = terminalSize();

  setRawMode(true);

  let stdin = yield* useStdin();
  let input = useInput(stdin);

  let term = yield* until(createTerm({ width: columns, height: rows }));

  let tty = settings(alternateBuffer(), progressiveInput(1));
  writeStdout(tty.apply);

  let value = "";
  let caret = 0;

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

      ({ output } = term.render(frame(value, caret)));
      writeStdout(output);
    }

    yield* each.next();
  }
});

function frame(value: string, caret: number): Op[] {
  let ops: Op[] = [];

  ops.push(
    open("root", {
      layout: {
        width: grow(),
        height: grow(),
        direction: "ttb",
        alignX: "center",
        alignY: "center",
        padding: { left: 4, right: 4, top: 2, bottom: 2 },
      },
      bg,
    }),
  );

  // Input row: "Name:" label + input box
  ops.push(
    open("input-row", {
      layout: {
        direction: "ltr",
        gap: 2,
        height: fixed(3),
        alignY: "center",
      },
    }),
  );

  ops.push(
    open("label", {
      layout: {
        width: fixed(6),
        height: fixed(1),
        alignX: "right",
        alignY: "center",
      },
    }),
    text("Name:", { color: label }),
    close(),
  );

  ops.push(
    open("input-box", {
      layout: {
        width: fixed(40),
        height: fixed(1),
        padding: { left: 1, right: 1 },
        alignY: "center",
      },
      bg: inputBg,
      border: { color: border, left: 1, right: 1, top: 1, bottom: 1 },
    }),
    text(value, { color: label, caret }),
    close(),
  );

  ops.push(close()); // input-row

  // Hint line
  ops.push(
    open("hint", {
      layout: {
        height: fixed(1),
        padding: { top: 1 },
      },
    }),
    text("← → move  Backspace delete  Esc or Ctrl+C exit", { color: hint }),
    close(),
  );

  ops.push(close()); // root

  return ops;
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
