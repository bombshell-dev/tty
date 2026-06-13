# clayterm

A low-level, platform-independent terminal renderer and event parser for
JavaScript. You can use clayterm directly, or as the foundation for your own
framework.

## Features

**Declarative terminal UI** — Build terminal interfaces the same way you'd build
a web page. Clayterm uses [Clay](https://github.com/nicbarker/clay) under the
hood, giving you flexbox-like layout, pointer detection, and scroll containers —
all rendered to the terminal as box-drawing characters and ANSI escape
sequences.

**Zero I/O** — Clayterm never reads stdin or writes stdout. You feed it bytes
and get bytes back. This makes it trivially embeddable in any framework, any
runtime, any event loop. There are no opinions about how you do I/O, just pure
computation.

**Runs everywhere** — The entire engine is compiled to WebAssembly, so clayterm
will run anywhere JavaScript runs with no native dependencies, and no build step
for consumers.

### Examples

See this keyboard example and more in the [examples folder](examples/README.md).
This demo uses Clayterm for all layout and input parsing.

#### Keyboard Events

The input parser decodes raw terminal bytes into structured events. Here you can
see each key event as the string "hello world" is typed.

![Keyboard events demo](examples/keyboard/keyboard-key-events.gif)

#### Pointer Events

Here we see hover styles applied to UI elements in response to the pointer
state. Clay drives the hit testing; no manual coordinate math required.

![Pointer events demo](examples/keyboard/keyboard-pointer-events.gif)

## Architecture

Clayterm does not do any I/O itself. On the ouput side, it converts UI elements
into a raw sequence of bytes and pointer events, and on the input side, it
converts a stream of raw bytes into structured events.

### Output

With every frame, the entire UI tree is packed into a flat byte array and sent
to WASM in a single call. On the C side, Clay runs layout, render commands are
walked into a cell buffer, and the buffer is diffed against the previous frame.
Only the cells that actually changed produce output. The result is an ANSI
escape sequence that can be written directly to stdout. One trip to WASM per
frame, double buffered, and only the bytes that need to change hit the output
stream.

Because the WASM module is pure computation with no I/O, it runs anywhere
WebAssembly does: Deno, Node, Bun, browsers, or any other runtime.

```
 TypeScript                        WASM (C)
+---------------+                +---------------------------+
|               |  Uint32Array   |                           |
| UI ops...     | =============> | Clay layout               |
|               |                |   -> render commands      |
+---------------+                |   -> cell buffer (back)   |
                                 |   -> diff against (front) |
                                 |   -> escape bytes         |
+---------------+                |                           |
|               | ANSI byte array|                           |
| stdout.write  | <============= |                           |
|               |                |                           |
+---------------+                +---------------------------+
```

### Input

Raw bytes from stdin are fed into a WASM-based parser that recognizes VT/ANSI
escape sequences, UTF-8 codepoints, and mouse protocols (VT200, SGR, urxvt). The
parser maintains its own internal buffer so partial sequences that arrive across
read boundaries are reassembled automatically. A lone ESC byte is held for a
configurable latency window (default 25ms) before being emitted, giving
multi-byte sequences time to arrive.

```
 TypeScript                        WASM (C)
+---------------+                +---------------------------+
|               |  raw byte array|                           |
| stdin.read    | =============> | trie match (keys/seqs)    |
|               |                |   -> mouse protocol       |
|               |                |   -> UTF-8 decode         |
+---------------+                |   -> ESC codes            |
                                 |                           |
+---------------+                |                           |
|               |  events[]      |                           |
| KeyEvent      | <============= |                           |
| MouseDownEvent|                |                           |
| MouseUpEvent  |                +---------------------------+
| MouseMoveEvent|
| WheelEvent    |
| ResizeEvent   |
+---------------+
```

## Usage

### Rendering

To render this:

```
╭───────────────╮
│ Hello, World! │
╰───────────────╯
```

```typescript
import { close, createTerm, grow, open, rgba, text } from "clayterm";

let term = await createTerm({ width: 80, height: 24 });

let { output } = term.render([
  open("root", {
    layout: { width: grow(), height: grow(), direction: "ttb" },
  }),
  open("greeting", {
    layout: { padding: { left: 1, right: 1 } },
    border: {
      color: rgba(0, 255, 0),
      left: 1,
      right: 1,
      top: 1,
      bottom: 1,
    },
    cornerRadius: { tl: 1, tr: 1, bl: 1, br: 1 },
  }),
  text("Hello, World!"),
  close(),
  close(),
]);

process.stdout.write(output);
```

### Pointer detection

Pass pointer state to `render()` to have clayterm do hit detection and return
pointer events in addition to the byte sequence.

```typescript
let { output, events } = term.render(
  [
    open("root", {
      layout: { width: grow(), height: grow(), direction: "ltr" },
    }),
    open("sidebar", {
      layout: { width: fixed(20), height: grow() },
      bg: rgba(30, 30, 40),
    }),
    text("Sidebar"),
    close(),
    open("main", {
      layout: { width: grow(), height: grow() },
    }),
    text("Main content"),
    close(),
    close(),
  ],
  {
    pointer: { x: mouseX, y: mouseY, down: mouseDown },
  },
);

for (let event of events) {
  // { type: "pointerenter", id: "sidebar" }
  // { type: "pointerleave", id: "sidebar" }
  // { type: "pointerclick", id: "main" }
  console.log(event);
}

process.stdout.write(output);
```

### Input parsing

```typescript
import { createInput } from "clayterm/input";

let input = await createInput({ escLatency: 25 });

process.stdin.setRawMode(true);
let timer: ReturnType<typeof setTimeout> | undefined;

process.stdin.on("data", (buf) => {
  clearTimeout(timer);

  let { events, pending } = input.scan(new Uint8Array(buf));

  for (let event of events) {
    dispatch(event);
  }

  // if a lone ESC is pending, wait and re-scan to flush it
  if (pending) {
    timer = setTimeout(() => {
      let flush = input.scan();
      for (let event of flush.events) {
        dispatch(event);
      }
    }, pending.delay);
  }
});
```

## Development

For local source builds, toolchain setup, and `clay` submodule instructions, see
[BUILD.md](BUILD.md).

Quick local validation:

```sh
make
deno task test
```
