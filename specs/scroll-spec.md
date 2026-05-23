# Clayterm Scroll Specification

**Version:** 0.2 (draft) **Status:** Proposed.

---

## 1. Purpose

This specification defines how clipped elements scroll their children. It covers
the clip configuration API, how scroll offsets are provided by the caller, and
how wheel events produce scroll deltas that are reported back to the caller.

Scrolling builds on the existing clip infrastructure described in the renderer
spec (Section 12.2). This specification promotes clip/scroll from an elastic
surface to a specified contract.

---

## 2. Scope

### In scope

- The `clip` property on `open()` element configuration
- Scroll offsets (numeric per-axis values, always caller-owned)
- Wheel event hit testing and scroll delta reporting via `RenderInfo`
- Input event integration via `RenderOptions.event`

### Out of scope

- Drag scrolling and momentum (future opt-in, not precluded by this design)
- Programmatic momentum (caller-implemented spring/ease animations)
- Snap points or pagination
- Focus-based scroll management (higher-level framework concern)

---

## 3. Clip Configuration

The `clip` property on `open()` configures per-axis clipping and child offset:

```ts
clip?: {
  x?: number;
  y?: number;
}
```

Each axis is independently configured:

- **`undefined`** (or omitted) — No clipping on this axis. Children may overflow
  visually.
- **`number`** — Clipping is enabled. Children are offset by the given value (in
  layout-engine units). The caller owns the offset and provides it each frame.
  Typically negative to scroll content upward/leftward.

The caller always owns the scroll position. There is no renderer-managed scroll
state. Wheel events produce deltas that the caller applies to their own position
(see Section 5).

### 3.1 Examples

Vertical scroll container:

```ts
open("viewport", {
  layout: { width: grow(), height: fixed(20) },
  clip: { y: -scrollY },
});
```

Horizontal offset:

```ts
open("viewport", {
  layout: { width: fixed(40), height: fixed(10) },
  clip: { x: -scrollX },
});
```

Both axes:

```ts
open("editor", {
  layout: { width: grow(), height: grow() },
  clip: { x: -columnOffset, y: -rowOffset },
});
```

---

## 4. Scroll Delta Reporting

When a `WheelEvent` is passed via `RenderOptions.event`, the layout engine
performs hit testing to determine which clip element the wheel targets
(innermost container at the event coordinates takes priority). The resulting
scroll delta is reported back to the caller via `RenderInfo`.

### 4.1 RenderInfo scroll field

`RenderInfo.get(id)` returns an `ElementInfo` that includes a `scrollDelta`
field when the element is a clip container that received a wheel event this
frame:

```ts
interface ElementInfo {
  bounds: BoundingBox;
  scrollDelta: { x: number; y: number };
}
```

The `scrollDelta` field contains the scroll delta applied to this clip element
for the current frame. When no wheel event targeted this element, both axes are
`0`. The renderer SHOULD reuse the same `{ x: 0, y: 0 }` object across elements
and frames to avoid allocation pressure.

### 4.2 Caller usage

The caller reads the delta and applies it to their own scroll position:

```ts
let result = term.render(ops, { event });
let info = result.info.get("viewport");
if (info) {
  scrollY += info.scrollDelta.y;
}
```

This keeps the caller as the sole owner of scroll position. The renderer only
reports what happened — the caller decides whether and how to apply it.

### 4.3 Clamping

The layout engine clamps scroll deltas to content bounds internally. The
reported delta will not cause the scroll position to exceed
`-(contentSize - containerSize)` or go above `0`.

### 4.4 Hit testing

When multiple clip containers are nested, the innermost container whose bounding
box contains the wheel event coordinates receives the delta. Only that container
reports a `scrollDelta` value.

### 4.5 Future: drag scrolling and momentum

The rendering pipeline is designed to support pointer-driven drag scrolling with
momentum in the future. The underlying layout engine already supports this via
`Clay_UpdateScrollContainers`. When added, it would produce additional scroll
deltas reported through the same `RenderInfo.scrollDelta` mechanism.

---

## 5. Input Event Integration

Wheel events reach the scroll system via `RenderOptions.event`, which accepts a
single `InputEvent` per render transaction. When the event is a `WheelEvent`,
the renderer performs hit testing and reports the resulting scroll delta via
`RenderInfo`.

The `event` field, its semantics, and the one-event-per-render contract are
defined in the [Renderer Specification](renderer-spec.md), Section 8.2.3.

---

## 6. Transfer Encoding

The clip property mask bit (`0x10`) remains unchanged. The encoded payload
changes to support per-axis numeric offsets.

For the clip configuration, the transfer encoding includes:

- A packed word with axis modes: low byte = x mode, next byte = y mode. Mode
  values: `0` = off, `1` = present.
- For each axis in mode `1`: a float32 offset value.

---

## 7. C-Side Decoding

When decoding a clip configuration, the C side:

1. Reads axis modes from the packed word.
2. Sets `decl.clip.horizontal` / `decl.clip.vertical` to true for any non-zero
   mode.
3. For present axes, reads the float offset from the buffer.
4. Sets `decl.clip.childOffset` from the decoded values.
5. Writes the offset into Clay's internal scroll state via
   `Clay_GetScrollContainerData` so that `Clay_UpdateScrollContainers` can
   perform correct hit testing and delta computation for wheel events.

This happens while the element is open (between `Clay__OpenElementWithId` and
`Clay__ConfigureOpenElement`), so Clay's element context is correct.

---

## 8. Invariants

**SCROLL-1.** A clip axis set to `undefined` MUST NOT clip children on that axis
and MUST NOT participate in scroll input handling.

**SCROLL-2.** A numeric clip axis MUST clip children and offset them by exactly
the provided value each frame.

**SCROLL-3.** The caller always owns the scroll position. The renderer MUST NOT
maintain scroll state across frames on the caller's behalf.

**SCROLL-4.** When `RenderOptions.event` carries a `WheelEvent`, the renderer
MUST report the scroll delta on the targeted clip element via
`RenderInfo.get(id).scrollDelta`.

**SCROLL-5.** Reported scroll deltas MUST be clamped to content bounds.

**SCROLL-6.** When multiple clip containers are nested, the innermost container
at the wheel event coordinates MUST receive the delta.

---

## 9. Test Plan

### Manual offset

1. `clip: { x: -10 }` offsets children horizontally, clips overflow.
2. `clip: { y: -5 }` offsets children vertically, clips overflow.
3. `clip: { x: 0, y: 0 }` clips but does not offset.
4. Omitted axis does not clip — children overflow visually.
5. Offset updates between frames produce correct output.

### Wheel delta reporting

6. Wheel-down event over a clip container reports negative y scroll delta.
7. Wheel-up event reports positive y scroll delta.
8. Multiple wheel events accumulate when caller applies deltas.
9. Scroll delta is clamped — does not exceed content bounds.
10. Content that fits within the container reports zero delta.
11. Wheel targets innermost scroll container at event coordinates.

### Caller-owned position

12. Caller applies reported delta to offset — content scrolls correctly.
13. Caller ignores reported delta — scroll position unchanged.
14. Caller jumps to arbitrary offset — no stale state from previous deltas.

### Edge cases

15. Clip with no children — no crash, empty output.
16. Nested scroll containers — inner container gets priority for wheel.
17. Scroll container removed between frames — no stale state.
18. Wheel event with no scroll containers under pointer — no effect.

---

## 10. Open Questions

### 10.1 Manual offset sign convention

Should numeric clip values use positive-scroll or negative-offset semantics?

**Option A: Positive (scroll-position semantics).** The caller provides the
logical scroll position as a positive number. Clayterm negates it internally
before passing to the layout engine.

```ts
clip: {
  y: 20;
} // "show content starting at position 20"
```

Pros:

- Matches `scrollTop` / `scrollLeft` conventions from the browser.
- More intuitive — "scroll to 20" rather than "offset by -20".
- Callers never deal with negative values for a conceptually positive quantity.

Cons:

- Introduces a sign inversion between the API and the underlying layout engine,
  which could confuse contributors reading the C code.
- Inconsistent with Clay's `childOffset` model, which uses negative values
  natively.
- Clipping without scrolling (`clip: { y: 0 }`) works identically either way,
  but the mental model differs — 0 means "scroll position zero" vs "zero
  offset."

**Option B: Negative (raw offset semantics).** The caller provides the raw pixel
offset, typically negative. Clayterm passes it through to the layout engine
unchanged.

```ts
clip: {
  y: -20;
} // "offset children by -20 pixels"
```

Pros:

- Direct mapping to Clay's `childOffset` — no hidden transformation.
- Transparent to anyone reading the implementation.
- Allows positive offsets if the caller genuinely wants to shift content
  downward/rightward (unusual but not impossible).

Cons:

- Unnatural for the common case — scrolling down requires negative numbers.
- Easy to get the sign wrong, especially for callers unfamiliar with the layout
  engine internals.
- Every scroll-position calculation needs manual negation.
