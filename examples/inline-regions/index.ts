/**
 * Inline region demo — renders animated regions into normal scrollback.
 *
 * Shows the region lifecycle:
 *   1. Allocate space with raw newlines
 *   2. Device Status Report (DSR) — queries cursor position to compute `top`
 *   3. CUP mode (all frames) — renders at `top`
 *   4. Commit — restore cursor past region, advance with \n
 */

import { Buffer } from "node:buffer";
import { readSync } from "node:fs";
import process from "node:process";
import { ensure, main, type Operation, sleep, until } from "effection";
import {
  close,
  createInput,
  createTerm,
  CSI,
  type CursorEvent,
  DSR,
  ESC,
  fixed,
  grow,
  type Op,
  open,
  rgba,
  SHOWCURSOR,
  text,
} from "../../mod.ts";
import { cursor, settings } from "../../settings.ts";
import { validated } from "../../validate.ts";

const encode = (s: string) => new TextEncoder().encode(s);
const write = (b: Uint8Array) => process.stdout.write(Buffer.from(b));

const WHITE = rgba(255, 255, 255);
const GREEN = rgba(80, 250, 123);
const GREEN_BG = rgba(20, 70, 38);
const GRAY = rgba(100, 100, 100);
const CYAN = rgba(139, 233, 253);

const RED = rgba(255, 0, 0);
const ORANGE = rgba(255, 153, 0);
const YELLOW = rgba(255, 255, 0);
const NGREEN = rgba(51, 255, 0);
const BLUE = rgba(0, 153, 255);
const VIOLET = rgba(102, 0, 255);
const RAINBOW = [RED, ORANGE, YELLOW, NGREEN, BLUE, VIOLET];

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

await main(function* () {
  let { columns } = terminalSize();
  setRawMode(true);
  let tty = settings(cursor(false));
  write(tty.apply);

  yield* ensure(() => {
    // SGR reset sequence
    setRawMode(false);
    write(CSI("0m"));
    write(tty.revert);
  });

  // Introduction
  say("Clayterm can render entire scenes, but it can also render");
  say('"inline" for a streaming UI. This is useful for semi-interactive');
  say("CLI commands that write output to the normal console screen.");
  say("");

  // Demo 1: Spinner box
  write(encode("\n\n\n"));

  let pos = yield* queryCursor();
  /** 1-based terminal row where the region starts */
  let row = pos.row - 2;

  write(ESC("7"));

  let frames = 30;
  let term = validated(
    yield* until(createTerm({ width: columns, height: 3 })),
  );

  let first = term.render(
    box("Press any key to compile modules.", CYAN, GRAY),
    { row },
  );
  write(new Uint8Array(first.output));

  waitKey();

  for (let i = 0; i < frames; i++) {
    let done = i === frames - 1;
    let icon = done ? "✓" : BRAILLE[i % BRAILLE.length];
    let time = `${((i + 1) * 0.08).toFixed(1)}s`;
    let label = done ? "Compiled modules" : "Compiling modules...";
    let result = term.render(
      box(
        `${icon} ${label}  ${time}`,
        done ? GREEN : CYAN,
        done ? GREEN : GRAY,
      ),
      { row },
    );
    write(new Uint8Array(result.output));
    yield* sleep(80);
  }

  write(ESC("8"));
  write(CSI("0m"));
  write(encode("\n"));

  yield* sleep(500);

  write(
    encode(
      "\nRegions can be multi-line, but they can be a single line too. (continue...)",
    ),
  );
  pause();

  // Demo 2: Progress bar
  let barWidth = Math.min(columns, 50);
  let barFrames = 40;
  yield* transaction(
    1,
    (i) => {
      let done = i === barFrames - 1;
      if (done) {
        return [
          open("root", {
            layout: {
              width: fixed(barWidth),
              height: fixed(1),
              direction: "ltr",
            },
          }),
          text(" ✓ Frobnicated ", { color: WHITE, bg: GREEN_BG }),
          close(),
        ];
      }
      let progress = i / (barFrames - 1);
      let label = "Frobnicating.. ";
      let remaining = barWidth - label.length - 5;
      let filled = Math.round(remaining * Math.min(progress, 1));
      let empty = remaining - filled;
      let pct = `${Math.round(progress * 100)}%`;
      let bar = "█".repeat(filled) + "░".repeat(empty);
      return [
        open("root", {
          layout: {
            width: fixed(barWidth),
            height: fixed(1),
            direction: "ltr",
          },
        }),
        text(label, { color: CYAN }),
        text(bar, { color: CYAN }),
        text(` ${pct.padStart(4)}`, { color: GRAY }),
        close(),
      ];
    },
    barFrames,
    50,
  );

  write(CSI("0m"));
  yield* sleep(500);
  write(encode("\nGoodbye sadness with limitless sky. (continue...)"));
  pause();

  // Demo 3: Nyan cat
  let nyanWidth = Math.min(columns, 120);
  let nyanFrames = 50;
  let cat = [
    "╭─────╮",
    "│ ^.^ │",
    "╰─────╯",
  ];
  let catWidth = cat[0].length;

  yield* transaction(
    3,
    (i) => {
      let done = i === nyanFrames - 1;
      let progress = i / (nyanFrames - 1);
      let trail = Math.round((nyanWidth - catWidth) * Math.min(progress, 1));

      if (done) {
        // "IMAGINATION IS BEAUTIFUL WORLD!" in 3-row block font
        let font: string[] = [
          "█ █▄█▄█ █▀█ █▀▀ █ █▀█ █▀█ ▀█▀ █ █▀█ █▀█   █ █▀▀   ██▄ █▀▀ █▀█ █ █ ▀█▀ █ █▀▀ █ █ █   █ █ █ █▀█ █▀█ █   █▀▄ █",
          "█ █ ▀ █ █▀█ █ █ █ █ █ █▀█  █  █ █ █ █ █   █ ▀▀█   █▀█ █▀▀ █▀█ █ █  █  █ █▀  █ █ █   █▄█▄█ █ █ █▀▄ █   █ █ ▀",
          "▀ ▀   ▀ ▀ ▀ ▀▀▀ ▀ ▀ ▀ ▀ ▀  ▀  ▀ ▀▀▀ ▀ ▀   ▀  ▀▀   ▀▀  ▀▀▀ ▀ ▀ ▀▀▀  ▀  ▀ ▀   ▀▀▀ ▀▀▀  ▀ ▀  ▀▀▀ ▀ ▀ ▀▀▀ ▀▀  █",
        ];
        let ops: Op[] = [
          open("root", {
            layout: {
              width: fixed(nyanWidth),
              height: fixed(3),
              direction: "ttb",
            },
          }),
        ];
        for (let row = 0; row < 3; row++) {
          let color = RAINBOW[(row * 2) % RAINBOW.length];
          ops.push(text(font[row], { color }));
        }
        ops.push(close());
        return ops;
      }

      let ops: Op[] = [
        open("root", {
          layout: {
            width: fixed(nyanWidth),
            height: fixed(3),
            direction: "ttb",
          },
        }),
      ];

      for (let row = 0; row < 3; row++) {
        ops.push(
          open(`row${row}`, {
            layout: { width: grow(), height: fixed(1), direction: "ltr" },
          }),
        );

        if (trail > 0) {
          let color = RAINBOW[(row * 2 + i) % RAINBOW.length];
          ops.push(text("█".repeat(trail), { color }));
        }

        ops.push(text(cat[row], { color: CYAN }));

        ops.push(close());
      }

      ops.push(close());
      return ops;
    },
    nyanFrames,
    60,
  );

  write(CSI("0m"));
  write(encode("\n"));
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

function* queryCursor(): Operation<CursorEvent> {
  let parser = yield* until(createInput({ escLatency: 100 }));
  write(DSR());

  let buf = Buffer.allocUnsafe(32);
  while (true) {
    let n: number;
    try {
      n = readSync(process.stdin.fd, buf, 0, buf.length, null);
    } catch (error) {
      if (
        error && typeof error === "object" &&
        ("code" in error && (error.code === "EAGAIN" || error.code === "EINTR"))
      ) {
        continue;
      }
      throw error;
    }

    if (n === 0) continue;
    let result = parser.scan(buf.subarray(0, n));
    for (let ev of result.events) {
      if (ev.type === "cursor") {
        return ev;
      }
    }
  }
}

function waitKey(): void {
  let buf = Buffer.allocUnsafe(32);
  while (true) {
    let n: number;
    try {
      n = readSync(process.stdin.fd, buf, 0, buf.length, null);
    } catch (error) {
      if (
        error && typeof error === "object" &&
        ("code" in error && (error.code === "EAGAIN" || error.code === "EINTR"))
      ) {
        continue;
      }
      throw error;
    }

    if (n === 0) continue;
    for (let i = 0; i < n; i++) {
      if (buf[i] === 0x03) {
        setRawMode(false);
        write(SHOWCURSOR());
        process.exit(0);
      }
    }
    return;
  }
}

function box(msg: string, fg: number, border: number): Op[] {
  return [
    open("root", {
      layout: { width: grow(), height: grow(), direction: "ttb" },
    }),
    open("box", {
      layout: {
        width: grow(),
        height: grow(),
        direction: "ttb",
        padding: { left: 1 },
        alignY: "center",
      },
      border: {
        color: border,
        left: 1,
        right: 1,
        top: 1,
        bottom: 1,
      },
      cornerRadius: { tl: 1, tr: 1, bl: 1, br: 1 },
    }),
    text(msg, { color: fg }),
    close(),
    close(),
  ];
}

function* transaction(
  height: number,
  renderFrame: (frame: number) => Op[],
  frames: number,
  interval: number,
): Operation<void> {
  let { columns } = terminalSize();

  write(encode("\n".repeat(height)));

  let pos = yield* queryCursor();
  /** 1-based terminal row where the region starts */
  let row = pos.row - height + 1;

  write(ESC("7"));
  let tty = settings(cursor(false));
  write(tty.apply);

  let term = validated(
    yield* until(createTerm({ width: columns, height })),
  );
  for (let i = 0; i < frames; i++) {
    let result = term.render(renderFrame(i), { row });
    write(new Uint8Array(result.output));
    yield* sleep(interval);
  }

  write(tty.revert);
  write(ESC("8"));
  write(encode("\n"));
}

function say(msg: string) {
  write(encode(msg + "\n"));
}

function pause(): void {
  waitKey();
  write(encode("\n"));
}
