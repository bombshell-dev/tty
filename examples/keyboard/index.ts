// deno-lint-ignore-file no-fallthrough
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
import {
  close,
  createTerm,
  fixed,
  grow,
  type InputEvent,
  type KeyEvent,
  type Op,
  open,
  type PointerEvent,
  rgba,
  text,
} from "../../mod.ts";
import {
  alternateBuffer,
  cursor,
  mouseTracking,
  progressiveInput,
  type Setting,
  settings,
} from "../../settings.ts";
import { useInput } from "./use-input.ts";
import { useStdin } from "./use-stdin.ts";

const active = rgba(60, 120, 220);
const inactive = rgba(50, 50, 60);
const on = rgba(40, 180, 80);
const label = rgba(220, 220, 220);
const dim = rgba(100, 100, 120);
const highlight = rgba(255, 220, 80);

const KEY_W = 5;
const GAP = 1;
const hovered = rgba(80, 80, 100);

const flagNames:
  (keyof Omit<AppContext, "mode" | "event" | "logged" | "log" | "entered">)[] =
    [
      "Disambiguate escape codes",
      "Report event types",
      "Report alternate keys",
      "Report all keys as escapes",
      "Report associated text",
    ];

const logEntries: { key: string; name: keyof EventFilter }[] = [
  { key: "a", name: "keydown" },
  { key: "b", name: "keyup" },
  { key: "c", name: "keyrepeat" },
  { key: "d", name: "mousedown" },
  { key: "e", name: "mouseup" },
  { key: "f", name: "mousemove" },
  { key: "g", name: "wheel" },
  { key: "h", name: "resize" },
  { key: "i", name: "pointerenter" },
  { key: "j", name: "pointerleave" },
  { key: "k", name: "pointerclick" },
];

await main(function* () {
  let { columns, rows } = terminalSize();

  setRawMode(true);

  let stdin = yield* useStdin();
  let input = useInput(stdin);

  let term = yield* until(createTerm({ width: columns, height: rows }));

  let tty = settings(alternateBuffer(), cursor(false));
  writeStdout(tty.apply);

  let modality = recognizer();
  let context = modality.next().value;

  let flags = ttyFlags(context);
  writeStdout(flags.apply);

  yield* ensure(() => {
    setRawMode(false);
    writeStdout(flags.revert);
    writeStdout(tty.revert);
  });

  let { output } = term.render(keyboard(context));

  writeStdout(output);

  let pointer = {
    events: createChannel<PointerEvent, void>(),
    state: undefined as { x: number; y: number; down: boolean } | undefined,
  };

  for (let event of yield* each(merge(input, pointer.events))) {
    if (event.type === "keydown" && event.ctrl && event.key === "c") {
      break;
    }
    if (event.type === "pointerenter") {
      context.entered.add(event.id);
    }
    if (event.type === "pointerleave") {
      context.entered.delete(event.id);
    }

    let prev = context.logged;
    context = modality.next(event).value;
    if (context.event && context.log[context.event.type as keyof EventFilter]) {
      context = { ...context, logged: context.event };
    } else {
      context = { ...context, logged: prev };
    }

    flags = updateFlagsIfChanged(flags, ttyFlags(context));

    if (context["Capture mouse events"]) {
      if ("x" in event) {
        pointer.state = {
          x: event.x,
          y: event.y,
          down: event.type === "mousedown",
        };
      }
    } else {
      pointer.state = undefined;
    }

    let { output, events } = term.render(keyboard(context), {
      pointer: pointer.state,
    });

    for (let event of events) {
      yield* pointer.events.send(event);
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

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function equalSetting(a: Setting, b: Setting): boolean {
  return equalBytes(a.apply, b.apply) && equalBytes(a.revert, b.revert);
}

// Avoid rewriting terminal input modes on every mousemove. Deno's `node:` TTY
// compatibility layer on Windows is sensitive to that churn even when the
// effective settings are unchanged.
function updateFlagsIfChanged(current: Setting, next: Setting): Setting {
  if (equalSetting(current, next)) {
    return current;
  }

  writeStdout(current.revert);
  writeStdout(next.apply);
  return next;
}

interface KeyDef {
  label: string;
  code: string;
  width?: number;
}

function isKeyEvent(e: InputEvent | PointerEvent): e is KeyEvent {
  return e.type === "keydown" || e.type === "keyrepeat" || e.type === "keyup";
}

function matches(k: KeyDef, event: InputEvent | PointerEvent): boolean {
  return isKeyEvent(event) && event.type === "keydown" &&
    event.code.toUpperCase() === k.code.toUpperCase();
}

function key(ops: Op[], k: KeyDef, ctx: AppContext): void {
  let pressed = ctx.event && matches(k, ctx.event);
  let hover = ctx.entered.has(`key:${k.code}`);
  let bg = pressed ? active : hover ? hovered : inactive;
  let w = k.width ?? KEY_W;
  ops.push(
    open(`key:${k.code}`, {
      layout: {
        width: fixed(w),
        height: grow(),
        padding: { left: 1, right: 1 },
        alignX: "center",
        alignY: "center",
      },
      bg,
      border: hover
        ? { color: highlight, left: 1, right: 1, top: 1, bottom: 1 }
        : undefined,
    }),
    text(k.label, { color: hover ? highlight : label }),
    close(),
  );
}

function row(ops: Op[], keys: KeyDef[], ctx: AppContext): void {
  ops.push(
    open("", { layout: { direction: "ltr", gap: GAP, height: fixed(3) } }),
  );
  for (let k of keys) {
    key(ops, k, ctx);
  }
  ops.push(close());
}

function spacer(ops: Op[], width: number): void {
  ops.push(
    open("", { layout: { width: fixed(width), height: grow() } }),
    close(),
  );
}

function mainKeys(ops: Op[], ctx: AppContext): void {
  ops.push(
    open("main-keys", { layout: { direction: "ttb", gap: GAP } }),
  );

  row(ops, [
    { label: "Esc", code: "Escape", width: 11 },
    { label: "F1", code: "F1" },
    { label: "F2", code: "F2" },
    { label: "F3", code: "F3" },
    { label: "F4", code: "F4" },
    { label: "F5", code: "F5" },
    { label: "F6", code: "F6" },
    { label: "F7", code: "F7" },
    { label: "F8", code: "F8" },
    { label: "F9", code: "F9" },
    { label: "F10", code: "F10" },
    { label: "F11", code: "F11" },
    { label: "F12", code: "F12" },
  ], ctx);

  row(ops, [
    { label: "`", code: "`" },
    { label: "1", code: "1" },
    { label: "2", code: "2" },
    { label: "3", code: "3" },
    { label: "4", code: "4" },
    { label: "5", code: "5" },
    { label: "6", code: "6" },
    { label: "7", code: "7" },
    { label: "8", code: "8" },
    { label: "9", code: "9" },
    { label: "0", code: "0" },
    { label: "-", code: "-" },
    { label: "=", code: "=" },
    { label: "Bksp", code: "Backspace", width: 9 },
  ], ctx);

  row(ops, [
    { label: "Tab", code: "Tab", width: 7 },
    { label: "Q", code: "q" },
    { label: "W", code: "w" },
    { label: "E", code: "e" },
    { label: "R", code: "r" },
    { label: "T", code: "t" },
    { label: "Y", code: "y" },
    { label: "U", code: "u" },
    { label: "I", code: "i" },
    { label: "O", code: "o" },
    { label: "P", code: "p" },
    { label: "[", code: "[" },
    { label: "]", code: "]" },
    { label: "\\", code: "\\", width: 7 },
  ], ctx);

  row(ops, [
    { label: "Caps", code: "CapsLock", width: 9 },
    { label: "A", code: "a" },
    { label: "S", code: "s" },
    { label: "D", code: "d" },
    { label: "F", code: "f" },
    { label: "G", code: "g" },
    { label: "H", code: "h" },
    { label: "J", code: "j" },
    { label: "K", code: "k" },
    { label: "L", code: "l" },
    { label: ";", code: ";" },
    { label: "'", code: "'" },
    { label: "Enter", code: "Enter", width: 10 },
  ], ctx);

  row(ops, [
    { label: "Shift", code: "ShiftLeft", width: 11 },
    { label: "Z", code: "z" },
    { label: "X", code: "x" },
    { label: "C", code: "c" },
    { label: "V", code: "v" },
    { label: "B", code: "b" },
    { label: "N", code: "n" },
    { label: "M", code: "m" },
    { label: ",", code: "," },
    { label: ".", code: "." },
    { label: "/", code: "/" },
    { label: "Shift", code: "ShiftRight", width: 13 },
  ], ctx);

  row(ops, [
    { label: "Ctrl", code: "ControlLeft", width: 7 },
    { label: "Win", code: "SuperLeft", width: 6 },
    { label: "Alt", code: "AltLeft", width: 6 },
    { label: "", code: " ", width: 33 },
    { label: "Alt", code: "AltRight", width: 6 },
    { label: "Win", code: "SuperRight", width: 6 },
    { label: "Menu", code: "Menu", width: 6 },
    { label: "Ctrl", code: "ControlRight", width: 7 },
  ], ctx);

  ops.push(close());
}

function navKeys(ops: Op[], ctx: AppContext): void {
  ops.push(
    open("nav-keys", { layout: { direction: "ttb", gap: GAP } }),
  );

  // top section: Ins/Home/PgUp, Del/End/PgDn
  row(ops, [
    { label: "Ins", code: "Insert", width: 6 },
    { label: "Home", code: "Home", width: 6 },
    { label: "PgUp", code: "PageUp", width: 6 },
  ], ctx);

  row(ops, [
    { label: "Del", code: "Delete", width: 6 },
    { label: "End", code: "End", width: 6 },
    { label: "PgDn", code: "PageDown", width: 6 },
  ], ctx);

  // gap before arrows
  ops.push(
    open("", { layout: { height: fixed(3) } }),
    close(),
  );

  // arrow up
  ops.push(
    open("", { layout: { direction: "ltr", gap: GAP, height: fixed(3) } }),
  );
  spacer(ops, 6);
  key(ops, { label: "\u2191", code: "ArrowUp", width: 6 }, ctx);
  spacer(ops, 6);
  ops.push(close());

  // arrow left/down/right
  row(ops, [
    { label: "\u2190", code: "ArrowLeft", width: 6 },
    { label: "\u2193", code: "ArrowDown", width: 6 },
    { label: "\u2192", code: "ArrowRight", width: 6 },
  ], ctx);

  ops.push(close());
}

function numpad(ops: Op[], ctx: AppContext): void {
  ops.push(
    open("numpad", { layout: { direction: "ttb", gap: GAP } }),
  );

  row(ops, [
    { label: "Num", code: "NumLock", width: 6 },
    { label: "/", code: "NumpadDivide", width: 6 },
    { label: "*", code: "NumpadMultiply", width: 6 },
    { label: "-", code: "NumpadSubtract", width: 6 },
  ], ctx);

  // rows 2-3 grouped horizontally so + spans both
  ops.push(
    open("", { layout: { direction: "ltr", gap: GAP } }),
  );

  // left side: 7-8-9 and 4-5-6 stacked
  ops.push(
    open("", { layout: { direction: "ttb", gap: GAP } }),
  );
  row(ops, [
    { label: "7", code: "Numpad7", width: 6 },
    { label: "8", code: "Numpad8", width: 6 },
    { label: "9", code: "Numpad9", width: 6 },
  ], ctx);
  row(ops, [
    { label: "4", code: "Numpad4", width: 6 },
    { label: "5", code: "Numpad5", width: 6 },
    { label: "6", code: "Numpad6", width: 6 },
  ], ctx);
  ops.push(close());

  // + spanning both rows
  key(ops, { label: "+", code: "NumpadAdd" }, ctx);

  ops.push(close());

  // rows 4-5 grouped horizontally so Enter spans both
  ops.push(
    open("", { layout: { direction: "ltr", gap: GAP } }),
  );

  // left side: 1-2-3 and 0-. stacked
  ops.push(
    open("", { layout: { direction: "ttb", gap: GAP } }),
  );
  row(ops, [
    { label: "1", code: "Numpad1", width: 6 },
    { label: "2", code: "Numpad2", width: 6 },
    { label: "3", code: "Numpad3", width: 6 },
  ], ctx);
  row(ops, [
    { label: "0", code: "Numpad0", width: 13 },
    { label: ".", code: "NumpadDecimal", width: 6 },
  ], ctx);
  ops.push(close());

  // Enter spanning both rows
  key(ops, { label: "Ent", code: "NumpadEnter" }, ctx);

  ops.push(close());

  ops.push(close());
}

function toggle(ops: Op[], enabled: boolean, name: string): void {
  let indicator = enabled
    ? "\u25cf\u2500\u2500\u2500"
    : "\u2500\u2500\u2500\u25cb";
  ops.push(
    open("", {
      layout: {
        direction: "ltr",
        height: fixed(1),
        gap: 1,
      },
    }),
    text(indicator, { color: enabled ? on : dim }),
    text(name, { color: enabled ? label : dim }),
    close(),
  );
}

function logToggle(
  ops: Op[],
  entries: typeof logEntries,
  ctx: AppContext,
): void {
  for (let entry of entries) {
    ops.push(
      open(`log:${entry.name}`, {
        layout: { direction: "ltr", height: fixed(1), gap: 1 },
      }),
    );
    ops.push(text(`${entry.key}.`, { color: dim }));
    toggle(ops, ctx.log[entry.name], entry.name);
    ops.push(close());
  }
}

function configPanel(ops: Op[], ctx: AppContext): void {
  let color = ctx.mode === "config" ? active : rgba(0, 0, 0, 0);
  ops.push(open("config", {
    layout: {
      direction: "ltr",
      gap: 3,
      padding: { left: 1, right: 1, top: 1, bottom: 1 },
    },
    border: { color, left: 1, right: 1, top: 1, bottom: 1 },
  }));

  // keyboard protocol level column
  ops.push(open("protocol-level", { layout: { direction: "ttb", gap: 1 } }));
  ops.push(
    open("", { layout: { height: fixed(1) } }),
    text("Keyboard Protocol Level", { color: highlight }),
    close(),
  );
  for (let i = 0; i < flagNames.length; i++) {
    let name = flagNames[i];
    ops.push(
      open(`flag:${name}`, {
        layout: { direction: "ltr", height: fixed(1), gap: 1 },
      }),
    );
    ops.push(text(`${i + 1}.`, { color: dim }));
    toggle(ops, ctx[name], name);
    ops.push(close());
  }
  ops.push(close());

  // log events column 1
  let col1 = logEntries.slice(0, 6);
  let col2 = logEntries.slice(6);

  ops.push(open("log-events", { layout: { direction: "ttb", gap: 1 } }));
  ops.push(
    open("", { layout: { height: fixed(1) } }),
    text("Log Events", { color: highlight }),
    close(),
  );
  logToggle(ops, col1, ctx);
  ops.push(close());

  // log events column 2
  ops.push(open("log-events-2", { layout: { direction: "ttb", gap: 1 } }));
  ops.push(
    open("", { layout: { height: fixed(1) } }),
    close(),
  );
  logToggle(ops, col2, ctx);
  ops.push(close());

  ops.push(close());
}

function keyboard(ctx: AppContext): Op[] {
  let ops: Op[] = [];

  // root
  ops.push(
    open("root", {
      layout: {
        width: grow(),
        height: grow(),
        direction: "ttb",
        alignX: "center",
        alignY: "center",
        padding: { left: 2, top: 1 },
      },
    }),
  );

  // keyboard + toggles wrapper
  ops.push(
    open("", { layout: { direction: "ttb" } }),
  );

  // badges + config row
  ops.push(
    open("", {
      layout: {
        width: grow(),
        direction: "ltr",
        alignY: "top",
        padding: { bottom: 1 },
      },
    }),
  );

  // badges column (left, bottom-aligned)
  let badgeBg = ctx.mode === "input" ? rgba(40, 120, 200) : rgba(200, 120, 40);
  let badgeLabel = ctx.mode === "input" ? "input" : "config";
  let badgeHint = ctx.mode === "input"
    ? "Ctrl+X Ctrl+X to enter config"
    : "Set flags with keys [0-5], Enter to save";
  let mouseBg = ctx["Capture mouse events"]
    ? rgba(40, 180, 80)
    : rgba(80, 80, 80);
  let mouseLabel = ctx["Capture mouse events"] ? "capture" : "system";
  ops.push(
    open("badges", {
      layout: { direction: "ttb", gap: 1, padding: { top: 1 } },
    }),
    open("badge:mode", {
      layout: { direction: "ltr", height: fixed(1), padding: { bottom: 1 } },
    }),
    open("", {
      layout: { padding: { left: 1, right: 1 } },
      bg: rgba(60, 60, 60),
    }),
    text("mode", { color: rgba(220, 220, 220) }),
    close(),
    open("", { layout: { padding: { left: 1, right: 1 } }, bg: badgeBg }),
    text(badgeLabel, { color: rgba(255, 255, 255) }),
    close(),
    text(` ${badgeHint}`, { color: dim }),
    close(),
    open("badge:mouse", { layout: { direction: "ltr", height: fixed(1) } }),
    open("", {
      layout: { padding: { left: 1, right: 1 } },
      bg: rgba(60, 60, 60),
    }),
    text("mouse", { color: rgba(220, 220, 220) }),
    close(),
    open("", { layout: { padding: { left: 1, right: 1 } }, bg: mouseBg }),
    text(mouseLabel, { color: rgba(255, 255, 255) }),
    close(),
    text(" Ctrl+X Ctrl+M to toggle", { color: dim }),
    close(),
    close(),
  );

  // config panel (right)
  ops.push(
    open("", { layout: { width: grow(), direction: "ltr", alignX: "right" } }),
  );
  configPanel(ops, ctx);
  ops.push(close());

  ops.push(close()); // badges + config row

  // three keyboard groups side by side, bottom-aligned
  let kbColor = ctx.mode === "input" ? active : rgba(0, 0, 0, 0);
  ops.push(
    open("keyboard", {
      layout: {
        direction: "ltr",
        gap: 3,
        alignY: "bottom",
        padding: { left: 1, right: 1, top: 1, bottom: 1 },
      },
      border: { color: kbColor, left: 1, right: 1, top: 1, bottom: 1 },
    }),
  );

  mainKeys(ops, ctx);
  navKeys(ops, ctx);
  numpad(ops, ctx);

  ops.push(close());

  ops.push(close()); // keyboard + toggles wrapper

  // raw event display
  ops.push(
    open("event-log", { layout: { height: fixed(1), padding: { top: 1 } } }),
    text(ctx.logged ? JSON.stringify(ctx.logged) : "Press any key...", {
      color: highlight,
    }),
    close(),
  );

  ops.push(close());

  return ops;
}

function ttyFlags(ctx: AppContext): Setting {
  let parts: Setting[] = [];
  let bits = 0;
  if (ctx["Disambiguate escape codes"]) bits |= 1;
  if (ctx["Report event types"]) bits |= 2;
  if (ctx["Report alternate keys"]) bits |= 4;
  if (ctx["Report all keys as escapes"]) bits |= 8;
  if (ctx["Report associated text"]) bits |= 16;
  parts.push(progressiveInput(bits));
  if (ctx["Capture mouse events"]) {
    parts.push(mouseTracking());
  }
  return settings(...parts);
}

function* recognizer(): Iterator<AppContext, never, InputEvent | PointerEvent> {
  let current: AppContext = {
    mode: "input",
    "Disambiguate escape codes": true,
    "Report event types": true,
    "Report alternate keys": true,
    "Report all keys as escapes": true,
    "Report associated text": true,
    "Capture mouse events": true,
    log: {
      keydown: true,
      keyrepeat: false,
      keyup: false,
      mousedown: false,
      mouseup: false,
      mousemove: false,
      wheel: true,
      resize: true,
      pointerenter: false,
      pointerleave: false,
      pointerclick: true,
    },
    entered: new Set(),
    event: null,
    logged: null,
  };

  let event = yield current;

  let mode = inputmode({ ...current, event });

  while (true) {
    mode = yield* mode;
  }
}

type Mode = Iterable<AppContext, Mode, InputEvent | PointerEvent>;

function* inputmode(context: AppContext): Mode {
  context = { ...context, mode: "input" };
  let event = context.event ? context.event : yield context;
  while (true) {
    context = { ...context, event };
    if (event.type === "keydown" && event.key === "x" && event.ctrl) {
      let next = yield context;
      while (next.type !== "keydown") {
        context = { ...context, event: next };
        next = yield context;
      }
      context = { ...context, event: next };
      if (next.key === "x" && next.ctrl) {
        return configmode({
          ...context,
          event: null,
        });
      } else if (next.key === "m" && next.ctrl) {
        context = {
          ...context,
          "Capture mouse events": !context["Capture mouse events"],
          event: null,
        };
        event = yield context;
        continue;
      }
    }
    event = yield context;
  }
}

function* configmode(context: AppContext): Mode {
  context = { ...context, mode: "config" };
  let event = yield context;
  while (true) {
    if (event.type === "keydown" && event.key === "Enter") {
      return inputmode({ ...context, event: null });
    }
    if (event.type === "keydown") {
      let k = (event as KeyEvent).key;
      let entry = logEntries.find((e) => e.key === k);
      if (entry) {
        context = {
          ...context,
          log: { ...context.log, [entry.name]: !context.log[entry.name] },
        };
      }
      if ("012345".indexOf(event.key) >= 0) {
        context = { ...context };
        context["Report associated text"] = false;
        context["Report all keys as escapes"] = false;
        context["Report alternate keys"] = false;
        context["Report event types"] = false;
        context["Disambiguate escape codes"] = false;
        switch (event.key) {
          case "5":
            context["Report associated text"] = true;
          case "4":
            context["Report all keys as escapes"] = true;
          case "3":
            context["Report alternate keys"] = true;
          case "2":
            context["Report event types"] = true;
          case "1":
            context["Disambiguate escape codes"] = true;
            break;
          case "0":
            break;
        }
      }
    }
    event = yield context;
  }
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

type EventFilter = {
  keydown: boolean;
  keyrepeat: boolean;
  keyup: boolean;
  mousedown: boolean;
  mouseup: boolean;
  mousemove: boolean;
  wheel: boolean;
  resize: boolean;
  pointerenter: boolean;
  pointerleave: boolean;
  pointerclick: boolean;
};

type AppContext = {
  mode: "input" | "config";
  event: InputEvent | PointerEvent | null;
  logged: InputEvent | PointerEvent | null;
  log: EventFilter;
  entered: Set<string>;
  ["Disambiguate escape codes"]: boolean;
  ["Report event types"]: boolean;
  ["Report alternate keys"]: boolean;
  ["Report all keys as escapes"]: boolean;
  ["Report associated text"]: boolean;
  ["Capture mouse events"]: boolean;
};
