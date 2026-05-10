# Clayterm Transitions Specification

**Version:** 0.1 (draft) **Status:** Design specification for a work-in-progress
feature. Normative where it establishes invariants and contract. Descriptive
where surfaces may settle during implementation.

---

## 1. Purpose

A transition smoothly interpolates an element's visual properties over time when
they change between frames. This specification defines how transitions integrate
with Clayterm's frame-snapshot rendering model: how they are declared, how time
is supplied, and how callers observe in-flight animation so they can drive the
render loop.

Transitions are a first-class extension of the rendering contract defined in the
[Clayterm Renderer Specification](renderer-spec.md). They do not change the
architectural model, do not introduce a component tree, and do not require
callers to hold cross-frame identity beyond the stable element identifiers they
already use.

This specification covers what clayterm ships against the current upstream Clay
layout engine. Several capabilities that the rendering model naturally invites —
per-property easing, per-element enter/exit behaviors, custom bezier easings —
are intentionally excluded from v1 because the underlying Clay API cannot
express them without upstream changes that are still in flight. Section 13
records these deferrals and the upstream dependencies that unblock them.

---

## 2. Scope

### In scope (normative)

- The transition model and its relationship to the frame-snapshot rendering
  contract
- Time handling and the `deltaTime` convention
- The animating signal returned from `render()`
- Element identity requirements for transitions
- Cancellation semantics (as a consequence of the frame-snapshot model)

### In scope (non-normative, descriptive)

- The shape of the `transition` field on the `open()` directive
- The set of easing functions exposed in v1
- The set of transition properties exposed in v1
- The wire encoding of transition data in the directive buffer
- Interaction with line mode
- Testing strategy

### Out of scope (v1)

See Section 13 for the deferred features and their upstream unblockers.

### Out of scope (indefinitely)

- Physics-based animation, spring interpolation, keyframe sequences
- Framework-level concepts of "animation groups" or cross-element choreography
  (orchestration is a caller concern)
- Input parsing (see [Input Specification](input-spec.md))

---

## 3. Terminology

**Transition.** A time-based interpolation of one or more of an element's visual
properties between an initial value and a target value.

**Transition property.** A specific visual attribute of an element that can be
interpolated: position (x, y), size (width, height), background color, overlay
color, border color, or border width.

**Easing.** A function mapping normalized progress in [0, 1] to an eased value
in [0, 1]. Clayterm exposes a fixed set of built-in easings.

**Delta time (`deltaTime`).** The number of seconds elapsed since the previous
render transaction. Used by the renderer to advance interpolation.

**Animating signal.** A boolean flag in the render result indicating whether any
transition is currently in progress. Callers use it to decide whether to
schedule another frame.

---

## 4. Architectural Model

_This section is normative._

### 4.1 Relationship to the frame-snapshot model

Transitions do not alter the frame-snapshot contract defined in INV-3 of the
renderer specification. The directive array still fully describes the desired
state for its frame. Transitions interpolate between the previous frame's state
and the current frame's target state; they do not reintroduce a persistent
component tree on the caller side.

What transitions add is the requirement that element identifiers remain stable
across frames for any element on which animation is desired. This is not a new
invariant — the existing pointer-event subsystem already relies on stable
identifiers — but it becomes load-bearing for transitions.

### 4.2 Time ownership

The `Term` instance is the sole source of frame-to-frame time. On each
`render()` call, the Term reads a monotonic clock and computes the elapsed
seconds since the previous render. That value is passed to the layout engine to
advance any in-flight transitions.

If the previous render reported `animating=false`, the Term passes `deltaTime=0`
to the layout engine on the current render, regardless of wall-clock time
elapsed. The rationale: Clay is delta-based and has no concept of when a
transition began. Idle time between renders must not count toward any subsequent
transition's elapsed clock, otherwise a long idle gap followed by a mutation
would cause the transition to complete instantly. Passing `deltaTime=0` on the
first frame of any new transition gives it a clean elapsed=0 starting point;
real deltas resume once the previous render signals `animating=true`.

The caller MAY override the computed delta via an explicit `deltaTime` option on
`render()`. Use cases include deterministic testing, snapshot rendering, and
compute-only renders where the caller is querying bounds without displaying
output.

The Term MUST NOT use a non-monotonic clock (e.g., `Date.now()`). Wall-clock
time can move backward under NTP adjustments or DST, which would produce
negative deltas and corrupt interpolation.

### 4.3 Delta clamping

Clayterm does not clamp `deltaTime`. Long gaps between frames (process
suspension, backgrounded terminal, debugger pause) produce large deltas. The
underlying interpolation is duration-based and naturally clamps at 1.0 of
progress, so a large delta causes in-flight transitions to complete rather than
to overshoot or become unstable.

### 4.4 Animation-loop signaling

The render result MUST surface whether any transition is currently active.
Callers use this signal to schedule the next frame. When no transition is
active, callers may stop rendering until the next external event (input, resize,
application state change).

This requirement exists because terminal applications typically render on-demand
rather than at a fixed refresh rate. Without an explicit animating signal, a
caller has no way to know that a transition it triggered is still in progress.

### 4.5 Boundary preservation

Transition configuration MUST be fully serializable. No function pointers,
closures, or callback registries cross the TS→WASM boundary during a render
transaction.

This preserves INV-2 (single transaction per frame): one binary buffer in, one
result struct out. On the C side, a fixed set of easing handlers is
pre-registered; the directive selects one by enum value.

---

## 5. Core Invariants

_This section is normative._

**INV-T1. Time is driven by delta, not wall clock.** All transition
interpolation advances by `deltaTime`, a per-frame seconds value. The renderer
does not subscribe to an internal timer or schedule work of its own.

**INV-T2. Render remains pure under time override.** When the caller supplies an
explicit `deltaTime`, the render result depends only on the directive array, the
previous frame's cell buffer, and the supplied `deltaTime`. This makes
deterministic rendering possible for tests and snapshots.

**INV-T3. No callbacks across the boundary.** Transition configuration MUST be
fully serializable. No function pointers, closures, or callback registries cross
the TS→WASM boundary during a render transaction.

**INV-T4. Identity is drawn from element IDs.** Transition state is associated
with elements by their declared `id`. Callers using transitions on an element
MUST assign it a stable, unique `id` across frames. Reusing an `id` for a
different logical element in a later frame is a caller error; behavior is
unspecified.

**INV-T5. Animating signal is accurate per transaction.** The `animating` flag
returned by `render()` reflects the state of transitions as of the end of that
transaction. If it is `true`, at least one transition has non-zero remaining
progress and calling `render()` again with positive `deltaTime` will advance it.

**INV-T6. Cancellation is structural.** There is no imperative `cancel()` API.
Transitions are cancelled by re-describing the previous target in a later frame;
the transition infrastructure re-anchors the interpolation from the current
visible value to the new target.

---

## 6. Rendering Contract Additions

_This section is normative._

### 6.1 `render()` signature

The `render()` method accepts an optional `deltaTime` field in its options
argument:

```
render(ops: Op[], options?: RenderOptions): RenderResult

interface RenderOptions {
  mode?: "line";
  row?: number;
  pointer?: { x, y, down };
  deltaTime?: number;
}
```

Each `render()` call advances transitions by its `deltaTime`:

- If `deltaTime` is provided explicitly, it is used verbatim.
- Otherwise, if the previous render reported `animating=false`, `deltaTime=0`
  (see §4.2 for rationale).
- Otherwise, `deltaTime` is the monotonic wall-clock time elapsed since the
  previous `render()` call.

On every `render()` call, Term captures the current monotonic timestamp as the
reference point for the next implicit delta. The two modes can be freely mixed,
but mixing within a single session is primarily useful for tests that step time
manually and should otherwise be avoided.

### 6.2 `RenderResult` addition

The render result gains one field:

```
interface RenderResult {
  output: Uint8Array;
  events: PointerEvent[];
  info: RenderInfo;
  errors: ClayError[];
  animating: boolean;
}
```

`animating` is `true` if and only if at least one element has an in-flight
transition at the end of the transaction.

### 6.3 The `transition` field on `open()`

An element may declare a transition by adding a `transition` field to its
open-element directive. The field is optional. Its absence means the element has
no transitions, which is the default.

See Section 7 for the shape.

---

## 7. Declarative Transition Surface

_This section is descriptive._

### 7.1 The `transition` field

All listed properties share a single duration and a single easing.

```ts
open("sidebar", {
  layout: { width: fixed(20) },
  bg: rgba(30, 30, 30, 255),
  transition: {
    duration: 0.2,
    easing: "easeOut",
    properties: ["x", "width", "bg"],
    interactive: false,
  },
});
```

**`duration`** — seconds. Must be non-negative.

**`easing`** — a string naming one of the built-in easing curves (Section 7.2).
Defaults to `"linear"` when omitted.

**`properties`** — list of property names to interpolate. Group names
(`position`, `size`, `all`) expand to the union of the underlying properties.

**`interactive`** (default `false`) — when `false`, pointer interactions with
the element are disabled while a position transition is in progress. When
`true`, pointer interactions remain enabled throughout.

### 7.2 Easing values

The `easing` field takes one of four string values:

```ts
type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut";
```

Each value maps to a wire byte (see Section 8). The byte space is deliberately
larger than this set so additional easings can be added later without breaking
serialized frames. A future parametric easing (e.g., cubic bezier) would extend
the type to a discriminated union:
`"linear" | "easeIn" | ... | { cubicBezier: [number, number, number, number] }`.
Today all values are non-parametric, so the type is a plain string union.

### 7.3 Property names

```ts
type TransitionProperty =
  | "x"
  | "y"
  | "position"
  | "width"
  | "height"
  | "size"
  | "bg"
  | "overlay"
  | "borderColor"
  | "borderWidth"
  | "all";
```

Group names expand as follows:

- `position` → `x`, `y`
- `size` → `width`, `height`
- `all` → every individual property above

---

## 8. Wire Encoding

_This section is descriptive._

The transition block is a new optional tagged section on `OP_OPEN_ELEMENT`. Its
presence is indicated by a bit in the open-element property mask. When present,
the block is a fixed 8-byte record:

```
transition_block {
  duration: f32           // seconds, non-negative
  properties: u16         // Clay-native bitmask (see below)
  easing: u8              // easing kind (0 = linear, 1 = easeIn, 2 = easeOut, 3 = easeInOut)
  flags: u8               // bit 0: interactive (0 = disable, 1 = allow)
}
```

The `properties` value is the Clay transition property bitmask:

```
CLAY_TRANSITION_PROPERTY_X                = 1
CLAY_TRANSITION_PROPERTY_Y                = 2
CLAY_TRANSITION_PROPERTY_WIDTH            = 4
CLAY_TRANSITION_PROPERTY_HEIGHT           = 8
CLAY_TRANSITION_PROPERTY_BACKGROUND_COLOR = 16
CLAY_TRANSITION_PROPERTY_OVERLAY_COLOR    = 32
CLAY_TRANSITION_PROPERTY_BORDER_COLOR     = 128
CLAY_TRANSITION_PROPERTY_BORDER_WIDTH     = 256
```

(Value 64, `CLAY_TRANSITION_PROPERTY_CORNER_RADIUS`, is defined upstream but has
no field in `Clay_TransitionData` and is not emitted by clayterm.)

The property-name helpers on the TS side expand to this bitmask during packing.

### 8.1 Validation

`validate()` checks:

- `duration >= 0`.
- `easing` is one of the defined enum values (0-3).
- Property names are from the defined set (Section 7.3).

---

## 9. Cancellation Semantics

_This section is normative._

A caller cancels an in-flight transition by emitting a new frame whose directive
for that element describes a different target state. The transition
infrastructure re-anchors the interpolation:

- The new `initial` value becomes the element's currently-visible value.
- `elapsedTime` resets to zero.
- The new `target` is the value declared in the current frame.

The transition duration is unchanged. A cancelled-and-reversed transition takes
its full configured duration regardless of how far it had progressed at the time
of cancellation.

There is no `term.cancelTransition(id)` call. The frame-snapshot model makes
cancellation a structural consequence of re-describing the desired state rather
than an imperative operation.

---

## 10. Interaction with Line Mode

_This section is descriptive._

Line mode emits cells as newline-separated rows without absolute cursor
positioning. Position transitions (`x`, `y`) have no meaningful effect in this
mode: rows are placed at the current cursor, not at absolute coordinates.

Expected behavior in line mode:

- Color and size transitions proceed normally.
- Position transitions are silently skipped (the property bits for x and y are
  cleared before the configuration reaches Clay).
- The `animating` signal reports accurately regardless of mode.

---

## 11. Testing Strategy

_This section is descriptive._

The `deltaTime` override enables deterministic, snapshot-friendly tests. A test
sequence looks like:

```ts
term.render(opsA, { deltaTime: 0 });
term.render(opsB, { deltaTime: 0 }); // target change, no time elapsed
term.render(opsB, { deltaTime: 0.1 }); // 50% through a 0.2s transition
term.render(opsB, { deltaTime: 0.1 }); // 100%, completed
```

Test coverage should include, at minimum:

- Property change mid-stream interpolates and completes.
- `animating` is false on static frames, true during interpolation, false again
  when the transition completes.
- Mid-transition target change re-anchors initial to current value.
- Multiple concurrent transitions on multiple elements.
- Line mode: color and size transitions apply, position transitions are silently
  skipped.
- Each easing enum produces distinct progression (linear, easeIn, easeOut,
  easeInOut).

---

## 12. Implementation Notes

_This section is descriptive and may change without affecting contract._

### 12.1 Clay submodule pin

clayterm pins Clay at a specific commit that includes the transition API
introduced upstream in commit `ee192f4`. The pin is recorded in the `clay`
submodule pointer. Advancing the pin is a prerequisite when upstream adds
capabilities clayterm depends on (Section 13).

### 12.2 Handler architecture

Each `Term` registers one C-side transition handler per easing kind (four total
for v1: linear, easeIn, easeOut, easeInOut). At element-configuration time the
decoder selects the handler matching the element's easing enum and stores it on
the `Clay_TransitionElementConfig`.

Each handler:

1. Computes progress as `clamp(elapsedTime / duration, 0, 1)`.
2. Applies its easing curve to progress.
3. Lerps each property named in the `properties` bitmask from `initial` to
   `target`.
4. Increments the Term context's `animating_count` unless progress is 1.0.
5. Returns `true` if progress is 1.0 (transition complete), `false` otherwise.

At the start of each `render()`, the Term resets `animating_count` to zero. At
the end, the value is copied into the result struct as the `animating` flag
(`true` if count > 0).

### 12.3 Per-Term isolation

The `animating_count` lives on the Term's C-side context, not as module-level
state. Multiple Terms created in the same process remain isolated.

### 12.4 Resolving the active Term inside the handler

Clay's transition-handler signature does not carry a `userData` pointer or
element ID. Each `reduce()` call records the currently-active Term pointer in a
module-level variable (`ct_active_context`) and clears it at the end. The
handler reads this variable to reach the Term's `animating_count`. A single
render pass cannot overlap with another (renders are synchronous), so there is
no concurrency concern.

---

## 13. Deferred Until Upstream Clay

These capabilities are intentionally not in v1 because the required Clay
primitives are either missing or in flight upstream. The absence is motivated;
re-adding them is straightforward once Clay lands the pieces.

### 13.1 Per-property easing and duration

The directive API could allow each property to have its own duration and easing
(e.g., "fade bg in 150ms, slide x in 300ms"). Clay's
`Clay_TransitionElementConfig` carries a single `duration`, a single `handler`,
and a single `properties` bitmask per element, so the handler has no way to
distinguish per-property timing. Working around this requires per-element
metadata addressable from inside the handler.

**Unblocked by:** Clay adding `void* userData` to the transition arguments
(upstream PR [nicbarker/clay#603](https://github.com/nicbarker/clay/pull/603)).

### 13.2 Enter and exit transitions

Elements mounted or removed between frames cannot express per-element initial or
final state deltas. Clay exposes `setInitialState` and `setFinalState` callbacks
with signatures that take no element identifier or user pointer, so there is no
way to look up per-element deltas from inside the callbacks. Additionally, exit
transitions require their configuration to survive past the frame on which the
element was last declared, which requires a lifetime signal.

**Unblocked by:**

- Clay `userData` on transition arguments (PR #603, above).
- An exit-completion callback or an `exiting` flag on the render command, both
  of which have been discussed upstream with Clay's maintainer as forthcoming.

### 13.3 `cubicBezier` easing

Custom cubic-bezier curves need per-element control-point parameters, and Clay's
fixed handler signature has no mechanism to thread parameters to a shared
handler.

**Unblocked by:** the same Clay `userData` addition as 13.1.

### 13.4 Corner-radius transitions

`CLAY_TRANSITION_PROPERTY_CORNER_RADIUS` is defined in the Clay property enum,
but `Clay_TransitionData` has no field carrying corner radius. Upstream
`Clay_EaseOut` does not interpolate it. Clayterm cannot either.

**Unblocked by:** Clay adding a `cornerRadius` field to `Clay_TransitionData`
and interpolating it in layout.

---

## 14. Demos

One demo accompanies v1:

**`demo/transitions.ts`** — exercises v1 transitions meaningfully in a terminal
context (e.g., a collapsing sidebar or a colored highlight that fades between
states). Purpose: surface real-world API sharp edges.

---

## Appendix A. Relationship to the Renderer Specification

This specification extends, but does not modify, the renderer specification.
Specifically:

- **INV-1 (Zero IO).** Transitions introduce reading of a monotonic clock for
  `deltaTime` computation. A clock read is not terminal IO and does not violate
  this invariant. The renderer still produces bytes only; it does not read or
  write terminals.

- **INV-2 (Single transaction per frame).** Transitions preserve this. All
  transition configuration is serialized into the single directive buffer; no
  additional boundary crossings occur during rendering.

- **INV-3 (Frame-snapshot independence).** Transitions preserve this at the API
  level. Each directive array still fully describes the desired state. Element
  IDs carry more weight (Section 4.1) but callers do not acquire new cross-frame
  bookkeeping responsibilities.

- **INV-4 (ANSI byte output).** Unchanged.

- **INV-5 (Layout/render/diff ownership).** The renderer additionally owns
  transition interpolation. Interpolated values feed into the existing layout
  and diff pipeline at the same pipeline stage that resolved values would.

The "Deferred/Future Areas" section of the renderer specification should be
updated to reference this specification rather than list transitions as a single
bullet.
