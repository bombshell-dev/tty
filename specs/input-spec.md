# Clayterm Input Specification

**Version:** 0.1 (draft) **Status:** Current-state specification. Descriptive
for the input parsing surface.

---

## 1. Purpose

This specification describes Clayterm's terminal input parsing surface: the API
for decoding raw terminal byte sequences into structured events.

Input parsing is architecturally independent from rendering (see
[Renderer Specification](renderer-spec.md), INV-8). The two concerns share a
compiled WASM binary for loading efficiency, but neither depends on the other's
state, types, or API surface.

This specification is currently non-normative. The input API has clear design
intent but has undergone more revision than the rendering core and faces known
upcoming forces that will reshape it (Kitty progressive enhancement field
surfacing, terminfo binary parsing). It is written to document the current
surface and guide future stabilization.

---

## 2. Scope

### In scope (descriptive)

- The input parser creation and lifecycle
- The scan API and its return type
- The `InputEvent` discriminated union and its variants
- The ESC timeout resolution model

### Out of scope

- Rendering (see [Renderer Specification](renderer-spec.md))
- Pointer hit detection (owned by the render loop; see Renderer Specification,
  Section 12.4)
- Higher-level event routing, focus management, or keybinding systems

---

## 3. Terminology

**Input parser.** A WASM-backed instance that accepts raw terminal bytes and
produces structured events. Each parser maintains its own internal state for
multi-byte sequence buffering and ESC timeout tracking.

**Scan.** A single invocation of the parser. The caller provides raw bytes (or
no bytes, for timeout resolution), and the parser returns any events it can
produce along with pending-timeout information.

**InputEvent.** A discriminated union representing a single parsed terminal
event. Discriminated on a `type` field.

---

## 4. Input Parser API

### 4.1 Parser creation

```
createInput(options?): Promise<Input>
```

Creates an input parser instance. The returned promise resolves when the WASM
module is ready.

Options:

- **`escLatency`** — Milliseconds to wait before resolving a lone ESC byte as
  the Escape key. Default: 25ms. This controls the tradeoff between
  responsiveness (lower values) and correct disambiguation of ESC-prefixed
  sequences (higher values).

- **`terminfo`** — A `Uint8Array` of raw terminfo binary. Accepted but C-side
  parsing is not yet implemented.

### 4.2 Scan

```
input.scan(bytes?: Uint8Array): ScanResult
```

Feeds raw terminal bytes into the parser and returns parsed events. The `bytes`
parameter is optional; calling without arguments triggers a rescan for ESC
timeout resolution.

The parser is synchronous: it processes all provided bytes in a single call and
returns immediately.

### 4.3 ScanResult

```
{ events: InputEvent[], pending?: { delay: number, deadline: number } }
```

- **`events`** — An array of parsed events produced from the provided bytes (and
  any previously buffered bytes that could now be resolved).

- **`pending`** — When present, indicates that an ambiguous ESC byte is buffered
  and the parser cannot yet determine whether it begins an escape sequence or is
  a standalone Escape keypress. The caller SHOULD schedule a rescan (calling
  `scan()` with no arguments) after the indicated delay. The `delay` field is a
  relative duration in milliseconds. The `deadline` field is an absolute
  timestamp (milliseconds since epoch) for the same point in time.

---

## 5. InputEvent Types

The `InputEvent` discriminated union is discriminated on a `type` field. The
current variants are:

- **`KeyEvent`** (`type: "keydown" | "keyup" | "keyrepeat"`) — A keyboard event
  for special keys, control sequences, and modifier combinations. Fields include
  `key` (logical key name), `code` (physical key identifier), and modifier flags
  (`shift`, `ctrl`, `alt`, `meta`).

- **`MouseEvent`** (`type: "mousedown" | "mouseup"`) — A mouse button press or
  release. Fields include `x`, `y` (cell coordinates), `button`, and modifier
  flags.

- **`WheelEvent`** (`type: "wheel"`) — A scroll event. Fields include `x`, `y`,
  and scroll direction.

- **`ResizeEvent`** (`type: "resize"`) — A terminal resize notification. Fields
  include `columns` and `rows`.

The discriminant values and the type splits are deliberate design decisions.
However, the field sets within each variant are expected to grow when Kitty
progressive enhancement types are surfaced in the TypeScript layer (the C struct
has already been extended with fields that are not yet mapped to the TS types).

---

## 6. Integration with Rendering

Input events produced by the parser can be passed directly to the renderer via
`RenderOptions.event`. The renderer extracts pointer state from mouse events and
scroll deltas from wheel events, removing the need for the caller to manually
decompose input events into renderer-specific structures.

See the [Scroll Specification](scroll-spec.md), Section 5 for details.

This integration does not create an architectural dependency between the input
parser and the renderer. The `InputEvent` type is the shared contract; neither
module imports the other.

---

## 7. Deferred / Future Areas

_These topics are explicitly excluded from this specification. Their omission is
intentional, not an oversight._

**Full Kitty progressive enhancement event types.** The C-side input parser
struct has been extended for progressive enhancement fields. The TypeScript
event types have not been updated to surface them.

**Terminfo binary parsing.** The input API accepts a `terminfo` option, but
C-side parsing is not implemented.

**Whether input parsing should be a separate package.** Architecturally
independent from the renderer but currently co-located. The distribution
decision is open.

---

## 8. Open Decisions

1. **What are the normative Kitty progressive enhancement event types?** The
   C-side struct has been extended. The TypeScript types have not been updated.
   This specification does not attempt to predict the final shapes.

2. **Should the input API be a separate package?** It is architecturally
   independent from the renderer (INV-8) but currently co-located in the same
   module.

3. **Is the input API ready for normative specification?** The API has clear
   design ownership but has undergone more revision than the rendering core.
   This specification documents the current surface without freezing it.
