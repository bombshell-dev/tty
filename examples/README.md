# examples

This directory contains runnable example applications that exercise different
features of libs. If any of these examples are not working, please open an issue
with information about your terminal, shell, operating system and any other
information that could be pertinent to reproducing the issue.

> [!NOTE]
> Run the commands in this document from the repository root. These examples use
> `node:` terminal APIs so the same files can be run with either Deno or Node.

## Prerequisites

Build the generated WebAssembly bundle before running the examples:

```sh
make
```

## Pointer shapes

The cursor, keyboard, 2048, and text-input demos change the mouse pointer over
their interactive elements (OSC 22, renderer-spec §7.9). Support is detected by
the probe (kitty) and by the known-support table in `detectTerminal()` (ghostty,
foot, xterm ≥ 367), so those work out of the box. For anything else, assert
support by hand with:

```sh
TTY_POINTER_SHAPES=1 deno run examples/keyboard/index.ts
```

## Cursor

Path: `examples/cursor/index.ts`

Run it with:

```sh
deno run examples/cursor/index.ts
# or
node examples/cursor/index.ts
```

What it shows:

- a catalog of 9 pointer shapes — the subset confirmed working in ghostty — as
  border-only rounded tiles in Bombshell brand hues, declaring their
  `pointerShape` (renderer-spec §7.9); hovering a tile shows that exact cursor
  in terminals that support OSC 22
- the grab tile is double-wide: holding the pointer down shows grabbing anywhere
  on screen while held — a capture-mode drag shield (userland drag persistence,
  matching CSS drag behavior); releasing returns to grab
- an ambient brightness wave travels the title bar: the ▪ spacers breathe on a
  phase-offset sine, so a ripple of light crosses the brand title (~12fps
  ticker)
- hover feedback lights the tile's ring and name, so the hover state reads even
  in terminals without OSC 22
- a muted status line whose hover label takes the hovered tile's hue, with a
  feature indicator (green ● supported, red ■ not) pinned to the right edge
- a final frame on exit that restores the default pointer (§7.9 restore)

## Keyboard

Path: `examples/keyboard/index.ts`

Run it with:

```sh
deno run examples/keyboard/index.ts
# or
node examples/keyboard/index.ts
```

What it shows:

- raw keyboard input decoded into structured key events
- progressive keyboard protocol support
- pointer tracking and hover/click-driven UI updates
- OSC 22 pointer shapes: hovering the on-screen keys shows the hand pointer when
  the terminal confirms support (renderer-spec §7.9)
- terminal mode configuration such as alternate buffer, hidden cursor, and mouse
  reporting

Related files:

- `examples/keyboard/use-input.ts` wraps the input parser as a stream of decoded
  events
- `examples/keyboard/use-stdin.ts` adapts stdin into a byte stream for the demo

#### Keyboard Events

The input parser decodes raw terminal bytes into structured events. Here you can
see each key event as the string "hello world" is typed.

![Keyboard events demo](keyboard/keyboard-key-events.gif)

#### Pointer Events

Here we see hover styles applied to UI elements in response to the pointer
state. Clay drives the hit testing; no manual coordinate math required.

![Pointer events demo](keyboard/keyboard-pointer-events.gif)

## Transitions

Paths: `examples/transitions/sidebar.ts` and `examples/transitions/notecards.ts`

Run them with:

```sh
deno run examples/transitions/sidebar.ts
# or
deno run examples/transitions/notecards.ts
```

What they show:

- element transitions driven by changing layout and style properties
- renderer `animating` state for scheduling follow-up frames
- color and layout interpolation in an interactive keyboard/sidebar demo

## 2048

Path: `examples/2048/index.ts`

Run it with:

```sh
deno run examples/2048/index.ts
# or
node examples/2048/index.ts
```

Controls: arrows or `wasd` to move, `Tab`/`Shift+Tab` to move focus,
`Enter`/`Space` to activate the focused button, `n` new game, `u` undo, `q` or
`Ctrl+C` to quit. The board size selector and game-over panel are clickable too.

What it shows:

- a motion-first game where the board tiles slide and recolor using the v1
  `transition` field (`position`, `bg`), keyed on stable tile ids so the layout
  engine interpolates each tile between frames
- the `animating` render signal gating a follow-up frame loop, so the process
  only renders while something is moving
- pointer hit testing and keyboard focus working together on the chrome buttons
- OSC 22 pointer shapes on the chrome buttons: hand cursor while hovering,
  not-allowed on the disabled Undo button, when the terminal confirms support
  (renderer-spec §7.9)
- an fps readout in the footer: a sliding-window count of frames pushed to
  stdout in the last second. It measures how fast frames are _produced_, not how
  fast the terminal _paints_ them — a CPU-rendered terminal (e.g. Terminal.app)
  can coalesce or drop frames downstream where the process can't observe it, so
  motion can look steppy even while this number stays high
- live resize handling: a `SIGWINCH` listener is bridged into the Effection
  event loop, and each real size change is folded into the term with
  `term.update([{ type: "resize", width, height }])`, after which the screen is
  cleared and repainted so the layout re-centers to the new dimensions
- a keycaster overlay: recent key presses and button clicks appear as a centered
  row of caps near the bottom (a floating, pointer-passthrough element) that
  retire on a timer, handy for screen recordings and demos

Known v1 limitations (deferred upstream, see `specs/transitions-spec.md` §13):

- There are no enter/exit transitions, so newly spawned tiles simply appear in
  place and merged-away tiles are dropped immediately rather than sliding out.
- Tiles animate `position` and `bg` but not `size`. The v1 renderer snaps cells
  to the integer grid, so a sub-cell size/scale "pop" renders as a misaligned
  short block instead of a smooth scale. Smooth sub-cell motion is exactly what
  the upcoming raster rendering path is for; until then tiles stay aligned to
  whole cells and only slide and recolor.

## Inline Regions

Path: `examples/inline-regions/index.ts`

Run it with:

```sh
deno run examples/inline-regions/index.ts
# or
node examples/inline-regions/index.ts
```

What it shows:

- rendering animated regions into normal terminal scrollback
- querying cursor position with Device Status Report (DSR) to place later frames
  correctly
- updating a previously allocated region without taking over the whole screen
- small animated demos including a spinner, a progress bar, and a nyan-cat-style
  sequence

This example is useful if you want to embed transient or animated UI output into
a normal command-line workflow instead of switching to a full-screen alternate
buffer interface.
