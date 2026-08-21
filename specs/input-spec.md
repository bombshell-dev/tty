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
- Decoding inbound OSC 22 mouse-pointer-shape replies into events

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

- **`PointerShapeEvent`** (`type: "pointershape"`) — A terminal reply to an OSC
  22 mouse-pointer-shape query. Carries a single `report` field: the raw payload
  string the terminal returned between `OSC 22 ;` and the string terminator. The
  parser does not interpret the payload and does not correlate it with any
  outstanding query; correlation is the caller's responsibility. See Section
  5.1.

The discriminant values and the type splits are deliberate design decisions.
However, the field sets within each variant are expected to grow when Kitty
progressive enhancement types are surfaced in the TypeScript layer (the C struct
has already been extended with fields that are not yet mapped to the TS types).

### 5.1 Pointer shape reports (OSC 22)

> **Status:** Implemented. Code conforms to the spec, not the reverse (see
> AGENTS.md).

Some terminals implement the OSC 22 mouse-pointer-shape protocol, under which an
application can _query_ the terminal's current pointer shape or its support for
named shapes. The terminal answers a query with a reply on the input stream. The
input parser recognizes these replies and surfaces them as `PointerShapeEvent`s.

The parser's role is strictly inbound decoding. It never sends OSC 22 queries
and never sets the pointer shape — emitting OSC 22 is an output concern
specified separately (see [Renderer Specification](renderer-spec.md)). This
preserves the parser's independence from the renderer (INV-8): the parser only
decodes bytes it is given.

**Recognized reply grammar.** A reply has the form:

```
ESC ] 22 ; <payload> <terminator>
```

where `<terminator>` is either ST (`ESC \`, bytes `0x1B 0x5C`) or BEL (`0x07`),
and `<payload>` is the run of bytes up to the terminator. The parser emits one
`PointerShapeEvent` per complete reply, with `report` set to the decoded
`<payload>` string. Payloads are truncated to 64 bytes; this comfortably fits
any shape name and a support-query reply for a reasonable number of shapes. The
parser does not validate or interpret the payload. Per the kitty pointer-shape
protocol the payload may be:

- a shape name (reply to `?__current__`, `?__default__`, or `?__grabbed__`),
- `0` (current-shape query when the shape stack is empty), or
- a comma-separated list of `1`/`0` flags (reply to a support query of the form
  `?name1,name2,...`).

Which interpretation applies depends on the query the caller sent; the parser
does not track outstanding queries, so the caller is responsible for that
correlation.

**Graceful degradation.** Terminals that do not implement the query side of OSC
22 (for example, set-only implementations) never send a reply, and therefore
never produce a `PointerShapeEvent`. A caller that issues a query and receives
no event within a timeout MUST treat the feature as unsupported. Absence of the
event is the contract for unsupported terminals; it is not an error.

**Incremental bytes.** An OSC 22 reply split across multiple `scan()` calls is
buffered like any other escape sequence and surfaced as a single event once the
terminator arrives. A lone `ESC` does not apply here: the `]` that follows
disambiguates immediately, so OSC 22 replies do not participate in ESC timeout
resolution.

---

## 6. Deferred / Future Areas

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

## Open Decisions

1. **What are the normative Kitty progressive enhancement event types?** The
   C-side struct has been extended. The TypeScript types have not been updated.
   This specification does not attempt to predict the final shapes.

2. **Should the input API be a separate package?** It is architecturally
   independent from the renderer (INV-8) but currently co-located in the same
   module.

3. **Is the input API ready for normative specification?** The API has clear
   design ownership but has undergone more revision than the rendering core.
   This specification documents the current surface without freezing it.
