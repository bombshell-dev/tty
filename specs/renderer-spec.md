# Clayterm Renderer Specification

**Version:** 0.1 (draft) **Status:** Current-state specification. Normative for
the rendering contract. Descriptive for settling surfaces.

---

## 1. Purpose

Clayterm is a terminal rendering engine. It accepts a declarative description of
a terminal UI layout, performs layout computation and cell-level diffing
internally, and returns ANSI escape byte sequences suitable for direct write to
a terminal output stream.

This specification defines Clayterm's current-state rendering contract: its
architectural model, its invariants, its stable public API surface, and its
intentional boundaries. It is written to allow future feature work to extend the
project without destabilizing the core.

This specification does not attempt to define areas of Clayterm that are still
settling. Where the project has working but evolving surfaces — including the
pointer event model and certain wrapper types — those are described in Section
12 as current implementation rather than normative contract.

Input parsing is specified separately in the
[Clayterm Input Specification](input-spec.md).

---

## 2. Scope

### In scope (normative)

- The rendering pipeline and its architectural commitments
- The frame-snapshot rendering model
- The stable public rendering API
- The directive model and core helpers
- Element identity and frame semantics
- Boundary responsibilities (what Clayterm owns and what it does not)

### In scope (non-normative, descriptive)

- Current implementation surfaces that are settling but not yet stable enough to
  freeze (Section 12)
- Implementation notes that aid understanding but do not define contract
  (Section 13)

### Out of scope

- Internal C code organization, function names, or file structure
- WASM memory layout or compilation details beyond behavioral requirements
- Performance targets or benchmark methodology
- Packaging, CI, or distribution workflow details
- Higher-level UI framework concerns (e.g., component lifecycle, reconciliation)
- Demo applications
- The crankterm project or any specific framework built on Clayterm
- Input parsing (see [Clayterm Input Specification](input-spec.md))

---

## 3. Terminology

**Frame.** A single, complete rendering pass. Each frame begins with the caller
providing directives and ends with the renderer returning ANSI bytes. Frames are
independent; the renderer carries no UI tree state between them.

**Directive (op).** A plain object that declares one element of the UI tree for
a single frame. Directives are typed by an identifier field and carry layout,
styling, and content properties. The set of directives for a frame is ordered
and forms an implicit tree via open/close pairing.

**Directive array.** An ordered array of directives constituting a complete
frame description. The array is the input to the rendering transaction.

**Render transaction.** The process of accepting a directive array, performing
layout, walking render commands, diffing against the previous frame's cell
buffer, and producing ANSI byte output. A render transaction is a single,
synchronous operation from the caller's perspective.

**ANSI bytes.** A byte sequence of UTF-8–encoded ANSI escape codes and text
content that, when written to a terminal file descriptor, produces the visual
output described by the frame's directives. ANSI bytes include
cursor-positioning sequences, SGR (Select Graphic Rendition) attribute
sequences, and UTF-8 text.

**Renderer core.** The WASM module and its TS entry points that together
implement the render transaction. The renderer core owns layout computation,
render-command walking, cell-buffer diffing, and ANSI byte generation.

**Caller.** Any code that invokes Clayterm's public API to produce terminal
output. The caller owns terminal setup, IO, input handling, and application
lifecycle.

**Higher-level framework.** A component model, reconciler, or application
framework built on top of Clayterm. Examples include crankterm. Clayterm has no
dependency on any higher-level framework, and this specification does not
constrain their design.

**Term.** An instance of the Clayterm renderer, bound to specific terminal
dimensions. A Term is the object through which the caller performs render
transactions.

---

## 4. Architectural Model

_This section is normative._

### 4.1 Pipeline

Clayterm implements a rendering pipeline with the following stages:

1. **Directive acceptance.** The caller provides a complete directive array
   representing the desired UI state for a single frame.

2. **Transfer.** The renderer transfers the frame description into the WASM
   module. The transfer mechanism is an implementation detail. The normative
   requirement is that the transfer occurs as part of a single render
   transaction; the caller does not interact with the transfer mechanism
   directly.

3. **Render transaction.** The WASM module processes the frame description.
   Internally, it drives a layout engine to compute element positions and sizes,
   walks the resulting render commands to populate a cell buffer, and diffs the
   cell buffer against the previous frame.

4. **Output generation.** For each cell that differs from the previous frame,
   the renderer emits ANSI escape sequences (cursor positioning, color
   attributes, and text) into an output buffer.

5. **Output retrieval.** The caller reads the ANSI byte output.

### 4.2 Single-transaction rendering

A frame MUST be rendered in a single transaction that crosses the TS→WASM
boundary once. The caller provides the complete directive array, invokes the
render transaction, and reads the output. There are no intermediate callbacks,
yields, or partial results.

### 4.3 Frame-snapshot model

Each render transaction operates on a complete, self-contained snapshot of the
UI. The renderer MUST NOT maintain an internal component tree or UI state across
frames. The only state the renderer retains between frames is the cell buffer
used for diffing, which is an implementation detail of output minimization and
not observable to the caller except through reduced output size.

### 4.4 Double-buffered diffing

The renderer maintains two cell buffers: a front buffer (the previously rendered
frame) and a back buffer (the frame being rendered). After populating the back
buffer from the current frame's render commands, the renderer compares it
against the front buffer and emits ANSI bytes only for cells that differ.
Changed cells are then copied from the back buffer to the front buffer so that
both buffers are identical at the end of the transaction. This mechanism is
internal to the renderer and not directly observable to the caller.

---

## 5. Contract Layer Boundary

_This section is normative._

This specification defines the **architectural rendering contract**: the
commitments that make Clayterm what it is and that callers and framework authors
can depend on.

This specification **does not** define the following as normative:

- **The internal transfer encoding.** The mechanism by which directives are
  serialized for the WASM module — its byte format, opcode structure, and field
  encoding — is an implementation detail. The normative commitment is that the
  transfer happens within a single render transaction; the encoding is described
  in Section 12.1 as current implementation surface.

- **Validation or error semantics.** How the renderer responds to invalid input
  (malformed directive arrays, unbalanced open/close pairs) is not yet specified
  as contract. Section 9.1 defines what constitutes valid input. Behavior for
  invalid input is currently unspecified.

- **The complete set of directive properties.** The existence of the core
  directive constructors (`open`, `close`, `text`) and the core sizing helpers
  (`grow`, `fixed`, `fit`) is normative. The full set of properties accepted by
  these constructors — which layout fields, which styling options, which
  configuration groups are available — is current implementation surface
  described in Section 12.2. New property groups have been added over time and
  more may follow.

- **The return type wrapper of `render()`.** The commitment that `render()`
  produces ANSI bytes accessible as a `Uint8Array` is normative. The wrapper
  type around those bytes is current implementation surface described in Section
  12.3.

Future readers should not treat current implementation surface as identical to
the contract boundary.

---

## 6. Core Invariants

_This section is normative._

**INV-1. Zero IO.** The renderer MUST NOT perform any terminal input or output.
It MUST NOT write to stdout, read from stdin, open file descriptors, or interact
with the terminal device. The renderer produces bytes; the caller writes them.

**INV-2. Single transaction per frame.** Each frame MUST be rendered in a single
transaction that crosses the TS→WASM boundary once. The caller provides the
complete frame as a directive array and receives ANSI bytes in return.

**INV-3. Frame-snapshot independence.** The renderer MUST NOT require the caller
to maintain or provide state across frames beyond calling `render()` on the same
Term instance. Each directive array fully describes its frame.

**INV-4. ANSI byte output.** The output of a render transaction MUST be a byte
sequence of valid UTF-8–encoded ANSI escape codes that is directly writable to a
terminal output stream without further transformation or encoding.

**INV-5. Layout/render/diff ownership.** The renderer owns the layout
computation, render-command walk, cell-buffer diffing, and ANSI byte generation
stages. The caller MUST NOT need to perform any of these operations.

**INV-6. Internal lifecycle symmetry.** The renderer's internal layout lifecycle
(begin-layout and end-layout calls to the underlying layout engine) MUST be
symmetric: both calls occur within the same render transaction, in the same
function scope.

**INV-7. Separation of concerns.** The rendering concern and the input-parsing
concern MUST remain independent. Neither MUST depend on the other's state,
types, or API surface. They MAY share a compiled WASM binary for loading
efficiency, but this is an implementation convenience, not an architectural
coupling.

---

## 7. Rendering Contract

_This section is normative._

### 7.1 Inputs

The rendering transaction accepts:

- A **directive array**: an ordered array of directive objects constituting a
  complete frame. The array MUST contain balanced open/close pairs forming a
  valid tree structure.

The directive array is the sole required input to a render transaction.

### 7.2 Rendering transaction

When the caller invokes a render transaction:

1. The renderer accepts the directive array and transfers the frame description
   into the WASM module.
2. The WASM module processes the frame: it computes layout, walks render
   commands, populates the cell buffer, diffs against the previous frame, and
   writes ANSI bytes for changed cells.
3. Control returns to the caller with the ANSI byte output available.

The render transaction is synchronous from the caller's perspective once
invoked. It MUST NOT yield, suspend, or require callbacks during execution.

### 7.3 Output

The render transaction produces ANSI bytes as a `Uint8Array`. These bytes:

- MUST be valid UTF-8
- MUST consist of ANSI escape sequences (CSI, SGR) and text content
- MUST be directly writable to a terminal file descriptor to produce the
  described visual output
- In cursor update mode, MUST represent only the cells that changed since the
  previous frame (on a Term instance that has rendered at least one prior frame)
- In line mode, MUST represent all cells in the frame as newline-separated rows

The output reflects the complete visual state of the frame. The caller SHOULD
write the output to the terminal without modification.

The output `Uint8Array` is a view over renderer-owned memory. It is valid until
the next `render()` call on the same Term instance, at which point the buffer
may be reused. Callers who need to retain the output beyond the next render MUST
copy it.

### 7.4 Lifecycle

A Term instance is created for specific terminal dimensions. The caller provides
width and height at creation time.

To handle terminal resize, the caller creates a new Term with the new
dimensions. The previous Term instance becomes stale and SHOULD NOT be used for
further rendering.

Creation of a Term is asynchronous because it may involve WASM module
preparation. A Term instance MAY be used for any number of render transactions.
The Term retains its cell buffers across frames for diffing purposes.

---

## 8. Public Rendering API

_This section is normative. Only items with high confidence of stability are
included. See Section 5 for what this section does and does not freeze._

### 8.1 Term creation

```
createTerm(options: { width: number; height: number }): Promise<Term>
```

Creates a new Term instance bound to the specified terminal dimensions. The
returned promise resolves when the renderer is ready. The `width` and `height`
parameters specify the terminal dimensions in character cells.

### 8.2 Render invocation

```
term.render(ops: Op[], options?: RenderOptions): <result containing ANSI bytes as Uint8Array>
```

Accepts an ordered array of directive objects and performs a render transaction
as defined in Section 7. Returns the ANSI byte output as a `Uint8Array`.

The optional `options` parameter controls the rendering mode. See Section 8.2.1
and 8.2.2 for the two available modes.

The return type is specified here only to the extent that the ANSI bytes MUST be
accessible as a `Uint8Array`. The precise shape of the return value — whether it
is a bare `Uint8Array`, a wrapper object, or a structure carrying additional
data — is part of the current implementation surface described in Section 12.3
and is not locked down by this specification.

#### 8.2.1 Cursor update mode (default)

When `mode` is omitted, the renderer operates in cursor update mode. Output
consists of ANSI bytes with absolute CUP (`\x1b[row;colH`) cursor positioning
for each changed cell. Only cells that differ from the previous frame are
emitted, making this efficient for full-screen UIs where most of the screen is
static between frames.

The optional `row` parameter specifies a 1-based row offset for CUP positioning.
This allows the caller to render into a region of the terminal starting at a row
other than the top. The offset is applied to all emitted cursor positions. When
omitted, it defaults to 1.

#### 8.2.2 Line mode

When `mode` is `"line"`, the renderer emits all cells as newline-separated rows
without CUP positioning. Every cell is written regardless of whether it changed
since the previous frame. The front buffer is updated so that a subsequent
cursor update mode render can diff efficiently.

Line mode is intended for inline region rendering where the caller manages
cursor positioning externally and the output must work in pipes or non-alternate
screen contexts.

#### 8.2.3 Input event

The optional `event` field on `RenderOptions` accepts a single `InputEvent` from
the input parser. The renderer extracts relevant state from the event:

- **Mouse events** (`mousedown`, `mouseup`, `mousemove`) — update pointer
  position and button state for hit testing and pointer event generation.
- **Wheel events** (`wheel`) — apply scroll deltas to pointer-driven scroll
  containers. See the [Scroll Specification](scroll-spec.md).
- **Other event types** — ignored by the renderer.

A render transaction accepts at most one input event. When multiple events are
available from a single `input.scan()` call, the caller SHOULD render once per
event. The diff engine ensures frames with no visual change emit zero bytes,
making per-event rendering efficient.

This field deprecates the `pointer` option on `RenderOptions`, which required
the caller to manually decompose mouse events into `{ x, y, down }` state. See
Section 12.4 for deprecation details.

### 8.3 Directive constructors

Directives are created using constructor functions that return plain objects.
The caller assembles these into an array. This pattern — functions returning
plain directives, composed into arrays — is normative. A builder, fluent, or
mutation-based API is explicitly rejected.

#### 8.3.1 open

```
open(id: string, props?): OpenElement
```

Creates an element-open directive. The `id` parameter provides an identity for
the element within the frame, used by the underlying layout engine for element
tracking and hit-testing. IDs MUST be unique within a frame; passing duplicate
IDs is undefined behavior. The optional `props` parameter carries configuration
for layout, styling, and behavior.

Elements opened with `open()` MUST be closed with a corresponding `close()`
directive later in the same directive array.

The set of properties accepted by `props` is part of the current implementation
surface described in Section 12.2. This specification defines the existence and
signature of `open()` normatively but does not freeze the complete property
surface, which has been extended incrementally and may continue to grow.

#### 8.3.2 close

```
close(): CloseElement
```

Creates an element-close directive. Each `close()` MUST correspond to a
preceding `open()`.

#### 8.3.3 text

```
text(content: string, props?): Text
```

Creates a text directive. The `content` parameter provides the text string to
render. The optional `props` parameter carries text styling configuration.

Text directives MUST appear between a matching open/close pair.

The set of styling properties accepted by `props` is part of the current
implementation surface and may be extended.

### 8.4 Sizing helpers

These functions produce sizing-axis values for use in element layout
configuration:

```
grow(): SizingAxis
```

The element expands to fill available space in the parent along this axis.

```
fixed(value: number): SizingAxis
```

The element has a fixed size of `value` cells along this axis.

```
fit(min?: number, max?: number): SizingAxis
```

The element sizes to fit its content, optionally constrained by minimum and
maximum bounds.

### 8.5 Color helper

```
rgba(r: number, g: number, b: number, a?: number): number
```

Packs color channel values (each 0–255) into a single 32-bit integer in ARGB
format. Alpha defaults to 255 (fully opaque). The returned value is used
wherever the directive model expects a color.

---

## 9. Directive Model

_This section is normative._

### 9.1 Directive-array pattern

The rendering input is an ordered array of directive objects. Each directive is
a plain JavaScript/TypeScript object created by a constructor function (Section
8.3). Directives are not classes, do not carry methods, and do not participate
in a prototype chain. They MAY be spread, composed, stored, or inspected as
ordinary objects.

The array is processed in order. Open and close directives form an implicit
tree. The renderer processes them sequentially.

A directive array with unbalanced open/close pairs, or with close directives
that do not match a preceding open, is invalid input. Callers SHOULD validate
directive arrays before rendering. The renderer's behavior when given an invalid
directive array is unspecified by this specification.

### 9.2 Transfer to the WASM module

As part of the render transaction, the directive array is transferred into a
form that the WASM module can process. This transfer is handled internally by
the renderer and is not an operation the caller performs or observes. The
transfer mechanism is an implementation detail described in Section 12.1.

### 9.3 Directive identity

Each element directive carries an `id` provided by the caller via `open()`.
Element IDs MUST be unique within a frame. The renderer uses the ID directly as
the element's identity for the layout engine. Passing duplicate IDs within a
single frame is undefined behavior.

---

## 10. Identity and Frame Semantics

_This section is normative._

### 10.1 Frame completeness

A directive array provided to `render()` MUST represent a complete frame. The
renderer does not support incremental updates, partial frames, or delta
descriptions. Every frame fully specifies the desired UI state.

### 10.2 Directive ordering

Directives MUST be provided in depth-first tree order. An `open()` directive
begins an element; its children (including nested open/close pairs and text
directives) follow in order; a `close()` directive ends the element. The
renderer processes directives in the order they appear in the array.

### 10.3 Element identity within a frame

Within a single frame, each element MUST have a unique identity for the layout
engine. As specified in Section 9.3, element IDs MUST be unique within a frame.
Passing duplicate IDs is undefined behavior.

### 10.4 No cross-frame identity

The renderer does not track element identity across frames. An element with id
"sidebar" in frame N and an element with id "sidebar" in frame N+1 are not
related from the renderer's perspective. Cross-frame identity, if needed, is the
responsibility of a higher-level framework.

---

## 11. Boundaries and Non-Responsibilities

_This section is normative._

### 11.1 The renderer does not perform IO

The renderer MUST NOT write to any output stream. The renderer MUST NOT read
from any input stream. The renderer produces bytes; the caller decides when and
how to write them. This enables the renderer to operate in any environment where
WebAssembly is available, including browsers, server-side runtimes, and embedded
contexts.

### 11.2 The renderer does not manage terminal state

The renderer MUST NOT emit escape sequences for any of the following
terminal-management operations:

- Entering or leaving the alternate screen buffer
- Hiding or showing the cursor
- Setting the cursor shape or blink state
- Enabling or disabling mouse reporting
- Enabling or disabling keyboard protocol modes (e.g., Kitty progressive
  enhancement)
- Enabling or disabling raw mode or similar terminal disciplines

These are the caller's responsibility. The renderer's output contains only the
escape sequences needed to render the frame content (cursor positioning for cell
writes, SGR attributes for styling, and UTF-8 text).

### 11.3 The renderer does not own application lifecycle

The renderer MUST NOT maintain a run loop, event loop, timer, or subscription
mechanism. It does not schedule frames. It does not manage component state. It
renders when asked and returns. The decision of when to render is entirely the
caller's.

### 11.4 The renderer does not own input parsing

Input parsing (keyboard events, mouse events, escape sequence decoding) is an
independent concern specified separately in the
[Clayterm Input Specification](input-spec.md). The renderer MUST NOT depend on
input-parsing state, types, or API.

However, pointer hit detection does require the render loop to participate. The
caller may pass the current pointer position as part of render options, and the
renderer returns the ids of every element the pointer is over. This is how the
`PointerEvent[]` array in the render result is populated. See Section 12.4 for
the current pointer event surface.

### 11.5 The renderer does not own higher-level framework concerns

The renderer MUST NOT implement or depend on:

- Component models or component lifecycles
- Reconciliation or diffing of directive trees (the renderer diffs _cells_, not
  _trees_)
- State management or reactivity
- Event propagation through a component hierarchy

These are the domain of higher-level frameworks built on Clayterm.

---

## 12. Current Surface That Remains Elastic

_This entire section is non-normative. It describes the current implementation
surface to aid consumers and future spec authors. The shapes described here are
real, working, and in many cases deliberately designed, but they do not yet meet
the stability threshold for normative specification. They MAY change in future
versions without constituting a breaking change to the normative core defined
above._

### 12.1 Transfer encoding (command protocol)

The renderer currently serializes directives into a flat byte buffer using a
command protocol based on fixed-width `Uint32` words. Each directive is encoded
as an opcode word followed by directive-specific data. Element-open directives
use a property mask to indicate which optional field groups (layout, border,
corner radius, clip, floating, scroll) are present, followed by the data for
each indicated group. Strings are encoded as length-prefixed UTF-8 byte
sequences within the word stream. Floats are stored as bit-reinterpreted
`Uint32` values.

This encoding has been extended incrementally (floating, clip, and scroll groups
were added after the initial protocol) but has never been restructured. It is
likely to remain stable in structure while continuing to grow. However, specific
opcode values, mask definitions, and field layouts are implementation details
and are not locked down by this specification.

### 12.2 Directive property groups

The `open()` constructor currently accepts the following property groups in its
`props` parameter:

- **`layout`** — sizing (width and height, specified via sizing helpers),
  padding (per-side), alignment (currently numeric enum values, with a planned
  transition to string literals), direction (top-to-bottom or left-to-right),
  and gap
- **`border`** — per-side border widths and border color
- **`cornerRadius`** — per-corner radius values, producing rounded box-drawing
  characters
- **`clip`** — clip region configuration for scroll containers
- **`floating`** — floating-element configuration (offset, parent reference,
  attach points, z-index)
- **`scroll`** — scroll container configuration

The `text()` constructor currently accepts: `color`, `fontSize`,
`letterSpacing`, `lineHeight`, and attribute flags (`bold`, `italic`,
`underline`, `strikethrough`).

These property groups represent the current implementation surface. New groups
and fields have been added incrementally and more may follow. Alignment values
are expected to transition from numeric to string-literal form.

**Border width and layout interaction.** In the underlying layout engine (Clay),
border configuration does not affect layout computation. This is Clay's intended
behavior. Borders are drawn as visual overlays within the element's bounding
box. A bordered element with zero padding will have its borders drawn over its
content. Callers must add padding equal to or greater than the border width to
prevent overlap.

### 12.3 Render return type

The `render()` method currently returns a `RenderResult` object shaped as
`{ output: Uint8Array, events: PointerEvent[], info: RenderInfo, errors: ClayError[] }`.

The `output` field is the ANSI byte output specified normatively in Section 7.3
and Section 8.2.

The `events` field contains pointer events (enter, leave, click) derived from
the underlying layout engine's element hit-testing. This field was added during
a pointer-events feature implementation. The pointer event model is functional
but has acknowledged gaps (no modifier keys on click events) and its interaction
protocol (passing pointer state via render options, then reading events from the
return value) was arrived at through iteration rather than upfront design.

The `info` field implements `RenderInfo`, a read-only lookup keyed by element id
(the `id` parameter passed to `open()`):

```
interface RenderInfo {
  get(id: string): ElementInfo | undefined;
}

interface ElementInfo {
  bounds: BoundingBox;
  scrollDelta: { x: number; y: number };
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

Each `ElementInfo` provides post-layout metadata. The `bounds` field is the
element's computed bounding box in character cells, as determined by the layout
engine after the render transaction completes. `x` and `y` are zero-indexed from
the top-left corner of the layout root. The `scrollDelta` field contains the
scroll delta applied to this clip element by a wheel event during this frame
(zero on both axes when no wheel event targeted the element). See the
[Scroll Specification](scroll-spec.md), Section 4.

Querying an element with an empty-string id or an id not present in the frame
returns `undefined`.

The `errors` field contains any errors reported by the Clay layout engine during
the most recent `render()` call. Each error is a `ClayError` object with:

- `type`: a string identifying the error category. The following types are
  defined, matching Clay's error taxonomy:
  - `"TEXT_MEASUREMENT_FUNCTION_NOT_PROVIDED"`
  - `"ARENA_CAPACITY_EXCEEDED"`
  - `"ELEMENTS_CAPACITY_EXCEEDED"`
  - `"TEXT_MEASUREMENT_CAPACITY_EXCEEDED"`
  - `"DUPLICATE_ID"`
  - `"FLOATING_CONTAINER_PARENT_NOT_FOUND"`
  - `"PERCENTAGE_OVER_1"`
  - `"INTERNAL_ERROR"`
  - `"UNBALANCED_OPEN_CLOSE"`
- `message`: a human-readable string describing the error in detail.

Errors are collected per-render; each call to `render()` returns only the errors
from that invocation. The array is empty when no errors occurred.

The return type of `render()` has changed twice since the project's inception
(string, then `Uint8Array`, then `RenderResult`). While the ANSI bytes
commitment (Section 7.3) is stable, the wrapper shape around those bytes is not.
Future versions may restructure the return type.

### 12.4 Pointer event model

Clayterm currently supports pointer hit-testing via the underlying layout
engine's element-identification mechanism. The renderer returns pointer events
as part of the render result:

- `pointerenter` — the pointer has entered an element's bounding box
- `pointerleave` — the pointer has left an element's bounding box
- `pointerclick` — a pointer-up occurred over an element that was also under the
  pointer at pointer-down

**Input event integration.** The preferred way to drive pointer state is via
`RenderOptions.event`, which accepts a single `InputEvent` from the input
parser. The renderer extracts pointer position and button state from mouse
events internally. See the [Scroll Specification](scroll-spec.md), Section 5.

**Deprecated: `pointer` option.** The `RenderOptions.pointer` field
(`{ x, y, down }`) is deprecated. It required the caller to manually track
pointer state from input events. Callers SHOULD migrate to
`RenderOptions.event`. The `pointer` option will be removed in a future version.

This surface is functional but should not be treated as stable contract. The
calling convention was discovered through iteration, the event model has
acknowledged gaps, and the approach may evolve.

### 12.5 Validation and packing

**`validate(ops)`** — A public API function that checks a directive array for
structural errors (unbalanced open/close pairs, invalid field types). Exported
and used in tests.

**`pack(ops, mem, offset)`** — An internal function that serializes a directive
array into the transfer encoding described in Section 12.1. Currently exported
but not public API; its exposure is incidental to the module structure.

---

## 13. Implementation Notes

_This section is non-normative. These notes describe current implementation
details that aid understanding but do not define contract. They may change
without notice._

**WASM module structure.** The renderer is implemented in C and compiled to
WebAssembly as a single module. The module contains both rendering and
input-parsing functionality; they share a binary but maintain independent state.

**WASM loading.** The WASM binary is inlined as a base64-encoded string in a
generated module and instantiated per Term or Input with fresh memory.

**Memory layout.** WASM linear memory is initialized with 256 pages (16MB). The
renderer state struct and the transfer buffer are allocated in WASM linear
memory. The specific layout is an implementation detail.

**Layout engine.** The underlying layout engine is Clay, included as a
dependency. Clay provides flexbox-like layout computation with support for
fixed, grow, and fit sizing; padding; alignment; direction; gap; floating
elements; clip regions; and scroll containers.

**Text measurement.** Text width measurement uses `wcwidth`-based character
width computation, supporting ASCII, CJK wide characters, and other Unicode
codepoints.

**Cell representation.** Each cell in the buffer stores a Unicode codepoint, a
foreground color (packed ARGB with attribute flags in the high byte), and a
background color.

**Border junction resolution.** When bordered elements share edges, the renderer
accumulates per-cell direction bitmasks and resolves them to correct box-drawing
junction glyphs in a post-render pass.

---

## 14. Deferred / Future Areas

_This section is non-normative. These topics are explicitly excluded from this
specification. Their omission is intentional, not an oversight._

**Scroll container API.** Now specified in the
[Scroll Specification](scroll-spec.md).

**CSI helper for terminal setup.** A helper for generating paired apply/rollback
byte arrays for terminal mode configuration was discussed but not implemented.

**Browser-specific adapter.** The renderer's zero-IO architecture makes browser
portability possible. No adapter exists.

**`betweenChildren` border support.** The underlying layout engine supports
this. It is not exposed in the directive model.

---

## Appendix A. Confidence Notes

### Why the rendering core is specified more aggressively than other surfaces

The rendering architecture — `createTerm`, `render(ops)`, the directive
constructors, the bytes-output commitment, and the core invariants — was
designed at the project's inception and has been stable since. It has survived
the addition of pointer events, border junction resolution, and the crankterm
integration without revision to its fundamental shapes. Its key abstractions
(flat directive arrays, single render transaction, ANSI byte output) were chosen
over explicitly rejected alternatives (per-element FFI, protobuf, builder
pattern, string output). This level of stability and intentionality justifies
normative specification.

The pointer event model and render return wrapper are the least settled of the
currently shipping features. Both were introduced during feature implementation
rather than designed as part of the core architecture. The return type of
`render()` has changed twice. The pointer calling convention was discovered
through iteration. These are working and useful, but they carry the lowest
confidence of any feature currently in the codebase.

### How to interpret "currently exported"

Several symbols are currently accessible from Clayterm's module exports —
including `pack()`, `validate()`, and numerous input-related types — without
clear evidence that they were intended as stable public contract. Being exported
may mean "needed by internal modules" or "not yet audited for public/internal
boundary."

This specification does not treat the export list as a contract boundary.
Instead, it uses stability over time, design ownership, survival of corrections,
and absence of known reshaping forces as the criteria for normative inclusion.

---

## Open Decisions Intentionally Left Out of This Spec

The following decisions are open. This specification omits them deliberately.
Future readers should not interpret their absence as oversight or implicit
resolution.

1. **What is the normative return type of `render()`?** This specification
   commits to ANSI bytes as `Uint8Array` but does not lock down the wrapper
   type. The current `RenderResult` shape may evolve.

2. **Is pointer event detection part of the rendering contract?** The current
   implementation returns pointer events from `render()`. This specification
   does not include pointer events in the normative core. Whether pointer
   detection is intrinsic to the renderer or should be a separate concern is
   unresolved.

3. **Is `pack()` public API?** `pack()` is currently exported but is an internal
   implementation detail, not public API. `validate()` is public API.

4. **How should border widths interact with layout?** The current behavior
   (borders do not affect layout) is inherited from the underlying layout
   engine. The project has questioned whether this is the right design. This
   specification describes the current behavior in Section 12.2 without
   committing to it.

5. **What are the specific transfer encoding details?** The encoding structure
   is described in Section 12.1 as current implementation surface. Locking down
   opcode values would constrain future extensions unnecessarily.

6. **What is the complete set of directive properties?** The property groups
   available in `open()` and `text()` are described in Section 12.2 as current
   implementation surface. They have been extended incrementally and will
   continue to grow.

7. **What are the validation and error semantics?** How the renderer responds to
   invalid input is unspecified. Callers SHOULD validate, but the validation
   model is not yet settled enough to define normatively.
