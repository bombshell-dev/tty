import { each, ensure, main, until } from "effection";
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
} from "../mod.ts";
import {
  alternateBuffer,
  cursor,
  mouseTracking,
  settings,
} from "../settings.ts";
import { useInput } from "./use-input.ts";
import { useStdin } from "./use-stdin.ts";
import content from "./lorem.ts";

let FG = rgba(204, 204, 204);
let DIM = rgba(100, 100, 110);
let GUTTER_FG = rgba(100, 120, 160);
let STATUS_BG = rgba(30, 30, 40);
let STATUS_FG = rgba(180, 180, 190);
let THUMB = rgba(120, 120, 140);
let TRACK = rgba(40, 40, 50);

let lines = content.split("\n");

function gutter(lineNum: number, width: number): string {
  let num = String(lineNum);
  let pad = width - 2 - num.length;
  return " ".repeat(Math.max(0, pad)) + num + " \u2502";
}

function gutterWidth(): number {
  let digits = Math.max(1, Math.floor(Math.log10(lines.length)) + 1);
  return Math.max(4, digits + 2);
}

function thumbGeometry(
  scrollY: number,
  totalLines: number,
  viewportHeight: number,
): { pos: number; size: number } {
  let size = totalLines > viewportHeight
    ? Math.max(1, Math.round(viewportHeight * viewportHeight / totalLines))
    : viewportHeight;
  let maxScroll = Math.max(totalLines - viewportHeight, 1);
  let pos = Math.round((scrollY / maxScroll) * (viewportHeight - size));
  return { pos, size };
}

function build(
  scrollY: number,
  rows: number,
): Op[] {
  let ops: Op[] = [];
  let gw = gutterWidth();
  let viewHeight = rows - 1;
  let { pos, size } = thumbGeometry(scrollY, lines.length, viewHeight);

  ops.push(open("root", {
    layout: { width: grow(), height: grow(), direction: "ttb" },
  }));

  for (let row = 0; row < viewHeight; row++) {
    let lineIdx = scrollY + row;
    let hasLine = lineIdx < lines.length;
    let lineNum = hasLine ? lineIdx + 1 : 0;
    let lineText = hasLine ? lines[lineIdx] : "";

    let inThumb = row >= pos && row < pos + size;
    let scrollChar = inThumb ? "\u2588" : "\u2502";
    let scrollColor = inThumb ? THUMB : TRACK;

    ops.push(
      open(`r${row}`, {
        layout: { direction: "ltr", height: fixed(1), width: grow() },
      }),
      open("", { layout: { width: fixed(gw), height: fixed(1) } }),
      text(hasLine ? gutter(lineNum, gw) : " ".repeat(gw - 1) + "\u2502", {
        color: hasLine ? GUTTER_FG : DIM,
      }),
      close(),
      open("", { layout: { width: grow(), height: fixed(1) } }),
      text(lineText || " ", { color: hasLine ? FG : DIM }),
      close(),
      open("", { layout: { width: fixed(1), height: fixed(1) } }),
      text(scrollChar, { color: scrollColor }),
      close(),
      close(),
    );
  }

  let status = ` ${
    scrollY + 1
  }/${lines.length}  j/k:scroll  g/G:top/bottom  q:quit`;
  ops.push(
    open("status", {
      layout: {
        width: grow(),
        height: fixed(1),
        direction: "ltr",
        padding: { left: 1 },
      },
      bg: STATUS_BG,
    }),
    text(status, { color: STATUS_FG }),
    close(),
  );

  ops.push(close());
  return ops;
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) {
    return min;
  } else {
    return v > max ? max : v;
  }
}

await main(function* () {
  let { columns, rows } = Deno.stdout.isTerminal()
    ? Deno.consoleSize()
    : { columns: 80, rows: 24 };

  Deno.stdin.setRaw(true);

  let stdin = yield* useStdin();
  let input = useInput(stdin);

  let term = yield* until(createTerm({ width: columns, height: rows }));

  let tty = settings(alternateBuffer(), cursor(false), mouseTracking());
  Deno.stdout.writeSync(tty.apply);

  yield* ensure(() => {
    Deno.stdout.writeSync(tty.revert);
  });

  let scrollY = 0;
  let viewHeight = rows - 1;
  let maxScroll = Math.max(lines.length - viewHeight, 0);
  let drag = { active: false, offset: 0 };

  Deno.stdout.writeSync(term.render(build(scrollY, rows)).output);

  for (let event of yield* each(input)) {
    if (event.type === "keydown" && event.ctrl && event.key === "c") break;
    if (event.type === "keydown" && event.key === "q") break;

    if (event.type === "keydown") {
      switch (event.code) {
        case "j":
        case "ArrowDown":
          scrollY = clamp(scrollY + 1, 0, maxScroll);
          break;
        case "k":
        case "ArrowUp":
          scrollY = clamp(scrollY - 1, 0, maxScroll);
          break;
        case "d":
        case "PageDown":
          scrollY = clamp(scrollY + Math.floor(viewHeight / 2), 0, maxScroll);
          break;
        case "u":
        case "PageUp":
          scrollY = clamp(scrollY - Math.floor(viewHeight / 2), 0, maxScroll);
          break;
        case "g":
        case "Home":
          scrollY = 0;
          break;
        case "End":
          scrollY = maxScroll;
          break;
      }
      if ((event as InputEvent & { key: string }).key === "G") {
        scrollY = maxScroll;
      }
    }

    if (event.type === "wheel") {
      let delta = event.direction === "down" ? 3 : -3;
      scrollY = clamp(scrollY + delta, 0, maxScroll);
    }

    if (
      event.type === "mousedown" &&
      event.button === "left" &&
      event.x === columns - 1 &&
      event.y < viewHeight
    ) {
      let { pos, size } = thumbGeometry(scrollY, lines.length, viewHeight);
      if (event.y >= pos && event.y < pos + size) {
        drag.active = true;
        drag.offset = event.y - pos;
      } else {
        let fraction = event.y / Math.max(viewHeight - 1, 1);
        scrollY = clamp(Math.round(fraction * maxScroll), 0, maxScroll);
      }
    }

    if (event.type === "mousemove" && drag.active) {
      let { size } = thumbGeometry(scrollY, lines.length, viewHeight);
      let fraction = (event.y - drag.offset) /
        Math.max(viewHeight - size, 1);
      scrollY = clamp(Math.round(fraction * maxScroll), 0, maxScroll);
    }

    if (event.type === "mouseup") {
      drag.active = false;
    }

    if (event.type === "resize") {
      columns = event.width;
      rows = event.height;
      viewHeight = rows - 1;
      maxScroll = Math.max(lines.length - viewHeight, 0);
      scrollY = clamp(scrollY, 0, maxScroll);
      term = yield* until(createTerm({ width: columns, height: rows }));
    }

    Deno.stdout.writeSync(
      term.render(build(scrollY, rows), { event }).output,
    );

    yield* each.next();
  }
});
