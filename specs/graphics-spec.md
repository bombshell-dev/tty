# Clayterm Graphics Specification

**Version:** 0.1 (draft) **Status:** Proposed. Normative for the graphics
substrate and the image element upon adoption.

---

## 1. Purpose

This specification defines Clayterm's graphics substrate and its first element.
The substrate is a per-Term registry of **pixel surfaces** — caller-supplied
decoded raster buffers — plus the engine that downsamples a surface onto the
terminal through a fidelity ladder of output tiers: Kitty graphics protocol
pixels, shape-aware ASCII character art, and alt text. The first element on the
substrate is the declarative, void `img()` directive.

The substrate is designed for more than images. Higher-level bitmap producers —
video, SVG, 3D rasterizers, a draw-canvas — are consumers of the same surface
registry and tier engine, not renderer features; §4.5 fixes that layering as
part of this specification's contract.

The image element — this specification's first consumer — fulfills the
commitment made in [Renderer Specification](renderer-spec.md) §7.8, which defers
"Kitty graphics emission" to a focused feature specification. It consumes the
terminfo foundation (PR stack #131–#133): tier selection reads the
`RuntimeCapabilities` snapshot that `term.update()` maintains, and the kitty
tier is gated on the `kitty-graphics` capability probe (query 9).

The division of labor follows the renderer's founding invariants:

- **The caller owns pixels.** The renderer performs no IO and decodes no file
  formats. The caller decodes an image by any means available and hands the
  renderer decoded RGBA pixels through a Term-level registry. The renderer
  transcodes those pixels into whatever the current terminal can display.
- **The renderer owns bytes.** Tier selection, scaling, protocol encoding,
  placement, cleanup, and cell-buffer integration are renderer concerns. The
  caller declares _what_ to show and _where_; the renderer decides _how_.
- **The renderer owns no memory allocator.** All image state lives in regions
  carved once at Term creation, under the same fixed-capacity discipline as the
  cell buffers (Section 5).

## 2. Scope

### In scope (normative)

- The graphics substrate: the pixel-surface registry, the tier engine, and the
  layering commitment of §4.5
- The `img()` directive: its shape, its void (self-closing) form, and its
  validation rules
- The image registry: `term.setImage()` and `term.removeImage()`
- The no-malloc memory discipline for image state: the carved registry, pixel
  pool, and placements table, including failure behavior at capacity
- Tier resolution: the fallback ladder and its deterministic resolution from
  capability evidence and directive properties
- The emission contract for each v1 tier: kitty, ascii, alt
- Cell-buffer integration: covered-cell representation, diff interaction,
  damage, and cleanup
- Capability-change invalidation rules
- Line-mode interaction and the error surface
- Testing obligations

### In scope (non-normative, descriptive)

- Placement-id derivation (requirements normative; the hash itself is
  implementation-defined, §9.2.3)
- The transfer encoding of the new directive (current implementation surface;
  §15)
- Exact sampling-circle geometry and contrast exponents (structure normative;
  values calibration-pinned by golden tests, §9.3.4)
- Glyph-lookup acceleration and per-frame memoization (§15)

### Out of scope (v1)

- The sixel tier. Its design sketch and required capability evidence are in
  §16.1. The v1 ladder is kitty → ascii → alt.
- iTerm2 inline images (OSC 1337 `File=`)
- Animation (multi-frame formats, kitty animation placeholders)
- Kitty unicode-placeholder placements (§16.4)
- Cell-size geometry evidence (XTWINOPS 14/16) and pixel-space scaling (§16.3)
- Z-layering between graphics and overlapping text or floating overlays beyond
  the §10 damage rule
- Behavior when an image's cells scroll within a scroll region (no caller-facing
  scroll API exists; renderer-spec §14)
- Transitions on image properties
- Cropping, source rectangles, and sub-image placement
- The canvas element, its 2D context, and other producers (video, svg, 3D): §4.5
  fixes their mapping onto the substrate; each lands as its own focused
  specification

### Out of scope (indefinitely)

- Image decoding (PNG, JPEG, WebP, …) inside the renderer. The renderer consumes
  decoded RGBA pixels only (INV-I1).
- File paths, URLs, or any IO-bearing reference in a directive. Pixels enter
  through the registry or not at all.
- Screen-reader presentation of the alt tier. The alt tier is a visual fallback
  rendered as ordinary cells; accessibility-tree semantics are a higher-level
  framework concern.

## 3. Terminology

**Image element (`img` directive).** A void (self-closing) directive that
participates in layout as a leaf element, is a pointer hit-test target, is
reported in `RenderInfo`, and has no children. By analogy with HTML's `<img>`.

**Registry.** The per-Term store of decoded images. Callers put pixel data in
with `setImage()` and take it out with `removeImage()`, keyed by caller-chosen
integer ids. The registry is a resource store, not UI tree state.

**Registry id.** A caller-chosen integer in `[1, 4294967295]` identifying one
image in one Term's registry. It is transmitted verbatim as the Kitty graphics
image id (`i=`), whose valid range is identical — the protocol requires positive
ids up to 4294967295 and forbids zero (§9.2.1).

**Image data.** Decoded raster pixels: width, height, and a `Uint8Array` of
straight (non-premultiplied) RGBA8 bytes, top-to-bottom rows, exactly
`width * height * 4` bytes.

**Tier.** One of the output forms an image element may take: `kitty` (Kitty
graphics protocol pixels), `ascii` (shape-aware character art in the cell grid),
`alt` (alt text as plain cell text).

**Ladder.** The fidelity-ordered tier sequence used for automatic resolution:
kitty, then ascii, then alt.

**Evidence.** A capability fact (see [Terminfo Specification](terminfo-spec.md))
that gates a tier. The v1 gate for the kitty tier is
`RuntimeCapabilities.kittyGraphics === true`.

**Layout box.** The element's computed bounding box in character cells, as
produced by the layout engine (the `ElementInfo.bounds` value, renderer-spec
§12.3).

**Painted footprint.** The subset of the layout box that the selected tier
actually paints. For the kitty and ascii tiers, the aspect-fit region of §8.2;
for the alt tier, the whole layout box.

**Half-row pixel convention.** This specification's source-pixel geometry
convention: one source pixel is one cell column wide and one half-row tall, so
one cell is two pixels tall and the cell aspect ratio
`A = cell_height /
cell_width = 2` (height:width 2:1). The convention assumes a
typical terminal cell; §16.3 refines it with cell-size geometry evidence when
that evidence exists.

**Contain.** Scaling semantics fixed for v1: the image is rendered into the
largest rectangle within its layout box that preserves its aspect ratio,
centered on both axes (§8.2). There is no stretch mode in v1 (§16.7).

**Placement.** One terminal-side display of one kitty image at one cell box,
identified on the wire by the pair (image id, placement id). Placements persist
on the terminal until deleted or overwritten by text.

**Placements table.** The renderer's fixed-capacity record of the previous
frame's live kitty placements (§5.4). It is retained diff state, not UI tree
state.

**Damage.** Any event that makes an image element's previous emission stale:
registry replacement, footprint change, tier change, removal, or a capability
change.

**Dirty-marking.** Forcing the next render's diff to emit bytes for a cell
region. The mechanism is implementation detail; the described approach is
overwriting front-buffer cells with the default cell value (§10.4).

**Quiet emission.** Emitting protocol bytes in a mode that provably generates no
terminal responses, so the input parser's `scan()` stream stays clean (INV-I5;
input-spec §6.2 is the consumer that must not be disturbed).

**Sampling circles.** Fixed cell-relative regions — six internal, ten external —
over which both candidate characters and source-image cells are measured
(§9.3.2).

**Shape vector.** A per-character vector recording how the character's ink
distributes across the internal sampling circles. Computed at build time and
compiled into the module (§9.3.2). This is a fixed table of fractions, not a
font system: the renderer holds no font machinery of any kind at runtime.

**Sampling vector.** The per-cell counterpart: luma means sampled from the
source image over the same circles, plus luma means over the external circles
for boundary awareness (§9.3.1).

**Contrast enhancement.** The pre-matching transform on sampling vectors —
directional, then global — that sharpens region boundaries in the art (§9.3.4).

## 4. Architectural Model

_This section is normative._

### 4.1 Relationship to the frame-snapshot model

The directive array continues to fully describe each frame's UI tree. Pixels are
not part of the tree; they are resources bound to the Term through the registry,
referenced by id from `img` directives — the same relationship dimensions and
capabilities have to the Term.

The renderer retains the following state between render transactions, all of it
implementation detail invisible to the caller except through reduced output size
and correct cleanup:

1. The front/back cell buffers used for diffing (pre-existing).
2. The image registry: the substrate's caller-owned pixel surfaces, keyed by
   registry id (§5.3).
3. The **placements table**: a fixed-capacity record of the previous frame's
   live kitty placements — for each, its registry id, wire image id, placement
   id, painted footprint box, tier, and transmission state. It exists so that
   cleanup and tier switching can be computed without scanning cells and without
   storing element-id strings. It is updated during each render transaction
   exactly as the front buffer is (§5.4).

Items 2 and 3 extend what renderer-spec §4.3 enumerates as retained state; the
corresponding amendment to INV-3 is listed in Appendix A. None of this state is
a UI tree: no parent pointers, no component identity, no reconciliation, no
cross-frame directive memory. The placements table is derived from and bounded
by the previous frame's directives, exactly like the cell buffer. This preserves
the spirit of renderer-spec INV-3 and §10.4 (no cross-frame identity) while
admitting the resource-and-record state that graphics cleanup requires.
Consequently, tier selection, footprint computation, and all emission decisions
are pure functions of the directive array, the capability snapshot, the registry
state, the placements table, and the front cell buffer — no ambient state, no
clock, and no heuristic beyond the evidence table (§9.1) and the damage rules
(§10).

### 4.5 Substrate and consumers (layering)

_This subsection is normative for the layering commitment; the per-consumer
sketches are non-normative._

The substrate is element-agnostic. Nothing in the tier engine (§9), the memory
carve (§5), the cell-buffer integration (§10), or the invalidation rules (§11)
may learn what produced a surface's pixels — not its format, not its producer,
not whether it is a still image or one frame of many. Every consumer below is
therefore a _producer of surface pixels plus ordinary directives_; the engine
stays a transcoder and never grows a drawing API.

- **img (this specification).** A decoded raster surface plus a declarative
  element with alt-text semantics — the reference consumer, specified in §6–§8.
- **video.** A producer that re-fills a surface per frame (`setImage` per tick).
  The substrate already supports it: a revision bump re-transmits and re-places
  (§9.2.2; §15's streaming note) with no new API. The Kitty protocol's animation
  machinery — multi-frame images, frame composition, playback controls — is the
  protocol's designed fast path for this and is deferred to a focused amendment
  (§16.8).
- **svg / vector / 3D.** Rasterizer producers: the caller rasterizes — with any
  TypeScript-side library, including a WebGL offscreen surface read back via
  `readPixels` — and fills surfaces through `setImage`. The renderer gains
  nothing: no path, stroke, tessellation, or scene-graph machinery ever enters
  the engine.
- **canvas (next focused specification).** A directive exposing a surface as a
  layout-participating draw target, plus a user-facing 2D context that is pure
  TypeScript drawing through zero-copy views into the carved pool. INV-I8 is
  what makes this sound: the pool is carved once and never grows or moves at
  runtime, so surface views stay valid between resizes, and dirty-rect
  re-emission extends the revision model additively. The canvas element and
  context API land as their own focused specification amending §5.3 with an
  in-place mutation path; nothing here needs to change first.

### 4.2 Data flow

```
caller decodes file ──▶ term.setImage(id, {width, height, pixels})
                              │
                              ▼  (copied into the carved pixel pool; no IO)
img directives ──▶ render() ─▶ tier resolution (§9.1)
                              │
              ┌───────────────┼──────────────────┐
              ▼               ▼                  ▼
          kitty tier      ascii tier         alt tier
   delete/tx/place      shape-vector art   plain cell text
   (APC graphics)        in the grid        (wrapped)
              │               │                  │
              └───────────────┴──────────────────┘
                              ▼
                     ANSI bytes (write now)
```

- `setImage()` performs no IO and emits no bytes. It stores pixels and, when it
  replaces a live id, bumps the entry's data version (§4.3).
- `removeImage()` returns cleanup bytes where the terminal state requires them
  and dirty-marks previously covered cells for the next render (§7.2).
- The first render transaction that places an image at the kitty tier transmits
  its data. Transmission is keyed by per-entry transmission state (§9.2.2), so
  unchanged, still-persisted data is never re-sent.
- All graphics emission happens inside the normal render transaction's byte
  output. There are no side-channel writes (renderer-spec INV-1, INV-2).

### 4.3 Registry lifecycle

- `setImage(id, data)` inserts or replaces. Replacing a live id bumps its data
  version. The pixels are copied into the carved pixel pool; the caller's buffer
  is not retained (§5.3). Storage failure raises `RangeError` (§7.2).
- `removeImage(id)` removes the registry entry, returns kitty deletion bytes
  when terminal-side state may exist (§7.2), and dirty-marks every cell in every
  footprint that referenced the id so the next render repaints them. Removing an
  unknown id is a no-op returning empty bytes.
- **Terminal-side persistence.** Kitty images and placements persist on the
  terminal after the Term that placed them is discarded. Clayterm has no Term
  disposal callback (renderer-spec §7.4), so images that outlive their Term are
  the caller's to clean up — for example by deleting placements before teardown,
  or by exiting the alternate screen. This matches the existing boundary: the
  renderer emits bytes, the caller owns terminal state (renderer-spec §11.2).

## 5. Memory Model

### 5.1 The no-malloc discipline

_This section is normative for behavior._

The renderer runs freestanding (wasm32) with no heap allocator. `malloc`,
`free`, and any heap-based dynamic structure MUST NOT be used by the renderer
for image state. All image storage and bookkeeping MUST fit the Term's
fixed-capacity memory plan:

- The Term's linear memory is carved **once at creation** into fixed regions
  sized by a pre-computed size query over the requested dimensions and options
  (§5.2). Region carving is descriptive; the behavioral requirements are
  normative.
- Every image-side structure is a **fixed-capacity array or a bump-carved extent
  within a pre-sized region**. There is no dynamic allocation, no
  free-and-reallocate of per-image memory, and no per-frame scratch region.
- When a fixed-capacity structure is exhausted, the behavior is the closed
  failure behavior of §7.2 and §13 — never silent truncation and never eviction
  of caller-owned resources (INV-I2).
- Reclamation of image pixel bytes happens only by **compaction of the pixel
  pool** (§5.3): dead extents are reclaimed by copying live entries to the pool
  start and resetting the bump pointer. Compaction is deterministic,
  order-preserving for live entries, and triggered by `setImage` on demand.
- All image state lives on the Term's C-side state struct (pointers into the
  carve), never in global mutable state. Multiple Terms in one process are fully
  isolated.
- Resize (renderer-spec §7.7) re-carves the dimension-dependent regions (cell
  buffers, placements table) and grows linear memory if required. The registry
  and pixel pool are **independent of terminal dimensions** and MUST survive a
  resize unchanged: an image registered before a resize remains registered and
  renderable after it. The placements table is discarded by resize together with
  the other diff state, with the consequence documented in §10.5.
- `setImage` and `removeImage` MUST NOT grow linear memory and MUST NOT create a
  new WASM module or instance. The reason is view safety: growing linear memory
  detaches `Uint8Array` views over it, and output views are known-valid only
  until the next `render()` or `update()` call (renderer-spec §7.3) — a
  registry-triggered grow would silently detach output views outside those
  transactions, where nothing in the contract permits it. Memory growth is a
  Term-creation and resize concern only (renderer-spec §7.7 discipline).

### 5.2 Carved regions (descriptive)

```
linear memory at Term creation:
┌────────────────────────────────────────────────────────────┐
│ Clayterm struct                                            │
│ front cells            (width × height cells)              │
│ back cells             (width × height cells)              │
│ output buffer          (capacity, §5.6)                    │
│ Clay arena             (fixed capacity; bump)              │
│ image entry table      (IMAGE_ENTRY_CAP × entry, §5.3)     │
│ image pixel pool       (imagePoolBytes, §5.3)              │
│ placements tables      (double-buffered, PLACEMENT_CAP     │
│                         × entry each, §5.4)                 │
└────────────────────────────────────────────────────────────┘
```

The size query computes each region's capacity before the single carve. The
layout, ordering, and padding of regions are implementation surface.

### 5.3 Image storage

_This subsection is normative for behavior._

The registry is a fixed-capacity entry table plus a shared pixel pool.

- `IMAGE_ENTRY_CAP` is 256 entries (normative). Each entry holds: registry id,
  data version, width, height, pool offset, payload byte length, transmission
  state (§9.2.2), and an in-use flag.
- `imagePoolBytes` is a `createTerm` option (Appendix A7) with normative default
  `4194304` (4 MiB). The pixel pool is one contiguous region of that size.
- `setImage(id, data)` copies the payload into the pool: the required
  `width*height*4` bytes are bump-carved from the pool. If the pool's remaining
  space cannot hold the payload, the renderer first **compacts** (copies all
  live payloads to the pool start in offset order, resets the bump pointer, and
  rewrites live entries' offsets) and retries. If the payload still does not
  fit, `setImage` throws `RangeError` identifying the capacity condition (§7.2).
- Replacing a live id allocates the new payload and marks the old extent dead;
  the dead extent is reclaimed at the next compaction. Until then the pool holds
  both payloads. This is observable only through earlier capacity exhaustion and
  is accepted behavior.
- An entry's data version is a monotonically increasing counter, incremented on
  every replace. It is the deduplication key for transmission (§9.2.2) and the
  memoization key for ascii art (§15).
- The renderer MUST NOT evict, expire, or garbage-collect live entries (INV-I2).
  Removal is explicit via `removeImage`, or by the Term being discarded.

### 5.4 Placements table

_This subsection is normative for behavior._

- `PLACEMENT_CAP` is 64 entries (normative). Each entry holds: registry id, wire
  image id, placement id, the painted footprint box, the resolved tier, and the
  data version last transmitted.
- At the end of every render transaction, the table is rewritten to describe
  exactly the kitty placements that transaction emitted, in previous-frame
  directive order — the same retained-state discipline as the front buffer. Like
  the cell buffers, the placements record is **double-buffered**: the previous
  frame's placements (front) and the frame being built (back); stale-placement
  detection diffs the two tables (§10), and the tables swap when the front
  buffer does.
- When a frame's kitty placements exceed the capacity, the excess image elements
  are **degraded to the ascii tier for that frame** in directive order, and one
  `"IMAGE_PLACEMENTS_EXCEEDED"` error is surfaced (§13). No kitty placement is
  ever created without a table entry: cleanup correctness (INV-I3) outranks
  fidelity.
- The table stores no element-id strings. Placement identity is the wire pair
  (image id, placement id) derived per §9.2.3.

### 5.5 Per-frame scratch

_This section is normative for behavior._

There is no per-frame scratch region. Every per-frame image computation is
either:

- **O(1) working state** (stack locals): base64 encoder state, per-cell sampling
  accumulators (six internal + ten external luma means), contrast vector
  components, and the footprint arithmetic; or
- **Direct output**: base64 encoding streams into the carved output buffer at
  the current write cursor; ascii sampling writes directly into the back cell
  buffer; per-cell work never buffers more than one cell.

The renderer MUST NOT build per-frame intermediate buffers for image processing.
This is what keeps the ascii pipeline inside the no-malloc discipline: sampling,
matching, and cell emission all stream.

### 5.6 Output-buffer sizing for transmission

_This section is normative for behavior._

The output buffer's capacity MUST be at least the sum of:

1. the foundation's text-redraw capacity (the capacity required by an ordinary
   complete redraw at the Term's dimensions), and
2. the worst-case single-frame graphics encoding: the base64 encoding of the
   largest payload the pixel pool can hold — `ceil(4/3 × imagePoolBytes)` bytes
   — plus, for every 3072 payload bytes (one maximum chunk), at most 128 bytes
   of control-block framing.

Formula:
`output_capacity ≥ text_capacity + ⌈4/3 · imagePoolBytes⌉ + 128 ·
⌈imagePoolBytes / 3072⌉ + 64`
(the final 64 bytes cover the trailing placement and cursor bytes). If a render
transaction nevertheless exceeds the output capacity, the renderer MUST throw a
`RangeError` identifying the condition as an output-capacity overflow, in the
manner of renderer-spec §9.2 — never a raw host-level TypedArray error.

## 6. Core Invariants

_This section is normative._

**INV-I1. Pixels are data, not IO.** Image pixels enter the renderer only
through `setImage()`. The renderer MUST NOT read files, decode compressed
formats, fetch, or otherwise perform IO to obtain image content. The directive
carries a registry id, never a path.

**INV-I2. Caller-owned resources.** The registry holds exactly what the caller
stored, keyed by caller-chosen ids. The renderer MUST NOT evict, expire, shadow,
or garbage-collect live registry entries, and MUST NOT invent images. Removal is
explicit. Capacity exhaustion fails loudly per §7.2/§13.

**INV-I3. Stateless cleanup.** All graphics cleanup — deleting stale placements
on move, resize, unmount, tier change, data replacement, or image removal — MUST
be computable from the current directive array plus the retained diff state
(cell buffers, registry, placements table). No callbacks, no cross-frame UI
tree, no imperative delete API beyond `removeImage()`.

**INV-I4. Determinism and measurement agreement.** Tier selection and footprint
computation are pure functions of the directive, the capability snapshot, the
registry state, and the layout box. The painted footprint computed for layout
purposes MUST equal the footprint actually painted, for every tier, on every
capability state. An image MUST NOT claim cells it does not paint, nor paint
cells it does not claim.

**INV-I5. Quiet emission and parser independence.** Every graphics-protocol
control block the renderer emits MUST set the quiet flag (`q=2`), which
suppresses both OK and failure responses. Rendered output MUST NOT cause the
input parser's `scan()` stream to receive probe-like or protocol-ack responses
(input-spec §6.2 defines what the parser recognizes). This preserves the
renderer and input parser's architectural independence (renderer-spec INV-7):
the renderer consumes capability facts, and nothing it emits is shaped to be
parsed by the input parser.

**INV-I6. Cell-buffer honesty.** While an image covers cells at a graphics tier,
the cell buffer's content for those cells MUST be the covered-cell value (§10.1)
and MUST NOT contain other elements' content: pixel-tier coverage wins over text
(§10.3). When coverage appears, moves, or disappears, the renderer MUST delete
stale graphics state terminal-side and restore the affected cells so that, after
the caller writes the transaction's bytes, the terminal's visible state matches
the cell buffer.

**INV-I7. Transaction boundaries preserved.** `setImage()` and `removeImage()`
are registry operations outside the render transaction. Each render transaction
remains a single TS→WASM crossing (renderer-spec INV-2). Registry calls MAY
cross the boundary individually, but they MUST NOT render, and render MUST NOT
require a preceding registry call beyond what its directives reference.

**INV-I8. No-malloc arena discipline.** All renderer-owned image state —
registry, pixel pool, placements table, and any per-frame working memory — MUST
satisfy §5.1: fixed capacities carved at Term creation, bump-carved extents with
compaction-only reclamation, O(1) per-frame scratch, and closed failure behavior
at capacity. The renderer MUST NOT link or invoke a heap allocator for image
state.

**INV-I9. Atomic failure.** A render transaction that throws MUST leave all
retained state — cell buffers, registry, placements table — exactly as it was
before the transaction, and MUST return no bytes. A terminal that has received
no bytes is consistent with unchanged retained state; the caller may retry the
render after correcting the condition. The same holds for a throwing registry
call: validation MUST occur before any mutation (§7.2).

## 7. Public API Additions

_This section is normative for the shapes shown. Adoption amends
[Renderer Specification](renderer-spec.md) §8 (Appendix A)._

### 7.1 `img()`

```ts
function img(id: string, props: ImgProps): Img;

interface ImgProps {
  /** Registry id of the image to render. Omit for an alt-only element. */
  image?: number;
  /** Required. Text fallback and human description. "" = decorative. */
  alt: string;
  width?: SizingAxis; // default fit() — see §8.3
  height?: SizingAxis; // default fit() — see §8.3
  variant?: "auto" | "kitty" | "ascii" | "alt"; // default "auto"
  /** Element background, same value space as open({ bg }). See §8.4. */
  bg?: number;
}

interface Img {
  directive: typeof OP_IMG; // opcode value is implementation surface
  id: string;
  image?: number;
  alt: string;
  width?: SizingAxis;
  height?: SizingAxis;
  variant?: "auto" | "kitty" | "ascii" | "alt";
  bg?: number;
}
```

The directive is **void**: one `img()` value in the array is a complete element.
It MUST NOT be paired with `close()` and MUST NOT have children. It participates
in layout as a leaf: its `width`/`height` sizing axes resolve like any element's
(§8), it is a pointer hit-test target under its element `id` (renderer-spec
§12.4), and its layout box is reported by `RenderInfo` (renderer-spec §12.3).
Its `id` MUST be unique among all element ids in the frame, per renderer-spec
§9.3 — duplicate ids are undefined behavior.

The directive has no `caret` property. The renderer's hardware-cursor machinery
is text()-bound (renderer-spec §7.6); the only cursor bytes an image frame may
contain are the placement-positioning bytes of §9.2.3.

A frame MAY contain any number of `img` directives. Two elements MAY reference
the same registry id; each receives its own placement (§9.2.4).

The returned value is a plain object — no classes, no methods, no prototype
chain (renderer-spec §9.1).

### 7.2 `term.setImage()` and `term.removeImage()`

```ts
interface ImageData {
  width: number; // positive integer
  height: number; // positive integer
  /** RGBA8, straight alpha, top-to-bottom rows, width*height*4 bytes */
  pixels: Uint8Array;
}

interface Term {
  setImage(id: number, data: ImageData): void;
  /** Returns bytes to write now (kitty deletion); empty when nothing to emit. */
  removeImage(id: number): Uint8Array;
}
```

- `id` is an integer in `[1, 4294967295]` — the Kitty protocol's own image-id
  range, which forbids zero — unique among the Term's live registry entries.
  Re-setting a live id replaces the image (§4.3).
- `setImage` MUST throw a `RangeError` when: `id` is not an integer in
  `[1, 4294967295]`; `width` or `height` is not a positive integer;
  `pixels.length !== width * height * 4`; or storage fails — either no free
  entry exists in the registry table, or the pixel pool cannot hold the payload
  even after compaction (§5.3). The message SHOULD identify the condition,
  mirroring the transfer-buffer error discipline of renderer-spec §9.2.
- `setImage` returns `void` and emits nothing. Transmission is lazy (§9.2.2).
- `removeImage` returns a `Uint8Array` to write to the terminal immediately —
  the same write-now discipline as `update()` output (terminfo-spec TINV-5). The
  bytes, when the registry id was live, delete the image, all its placements,
  and the terminal's stored copy of the data: one
  `ESC _ G a=d,d=I,i=<wire image id>,q=2 ESC \` control block. The uppercase
  form is the protocol's data-freeing deletion; the lowercase variant deletes
  placements but retains stored data "so that the images can be re-displayed
  without needing to resend" — retention is what §9.2.5's scoped deletions
  exploit, and removal is the one place it is wrong. Deletion bytes MUST be
  emitted whenever the id was live in the registry — regardless of the current
  `kittyGraphics` evidence — because a placement placed under earlier evidence
  may still exist terminal-side after the evidence was denied (§11.3). The
  result is empty when the id is unknown.
- `removeImage` also dirty-marks (§10.4) every cell of every footprint that
  referenced the id, so the next render repaints them; this happens even when no
  deletion bytes are emitted.
- Both calls are synchronous. Neither renders, and neither performs IO (INV-I1,
  INV-I7).

### 7.3 Validation

`validate(ops)` extended rules:

- An `img` directive MUST carry a string `alt` (possibly empty).
- `image`, when present, MUST be an integer in `[1, 4294967295]`.
- `variant`, when present, MUST be one of the §7.1 literals.
- `width`/`height`, when present, MUST be sizing-axis values.
- `bg`, when present, MUST be a number (packed ARGB per `rgba()`, renderer-spec
  §8.5).
- `img` directives are not opened or closed; `validate` MUST NOT treat them as
  contributing to open/close balance.

Malformed directives are invalid input; behavior follows the foundation rule
(renderer-spec §9.1): callers SHOULD validate; renderer behavior on invalid
input is unspecified.

## 8. Layout and Sizing

### 8.1 Layout box

The layout engine computes the element's layout box from its `width`/`height`
sizing axes like any leaf element's. The layout box is what layout, clip regions
(§8.5), pointer hit-testing, and `RenderInfo` report (renderer-spec §12.3).

### 8.2 Painted footprint (contain)

The **painted footprint** is resolved inside the layout box, per tier:

| Tier  | Painted footprint          |
| ----- | -------------------------- |
| kitty | contain-fit region (below) |
| ascii | contain-fit region (below) |
| alt   | the entire layout box      |

The contain-fit region of a `W × H` pixel source inside a `boxW × boxH` cell
box, under the half-row pixel convention (`A = 2`):

- `cols = min(boxW, floor(boxH · A · W / H))`
- `rows = min(boxH, round(cols · H / (A · W)))`
- If `cols = 0` or `rows = 0`, the footprint is **empty** and the element paints
  nothing at graphics tiers (alt still paints its full box, §9.4).
- Otherwise the footprint is the `cols × rows` rectangle centered horizontally
  and vertically in the box, top-left at `x = floor((boxW − cols)/2)`,
  `y = floor((boxH − rows)/2)` relative to the box origin.

The footprint is what a graphics tier paints and what the ascii tier maps pixels
onto. It is always a subset of the layout box, and it equals the layout box
whenever the box already matches the source's aspect ratio under `A = 2` (within
the rounding above) — which is the case for intrinsic `fit()` sizing (§8.3).

v1 has exactly one scaling semantic. `scale: "stretch"` is not offered; see
§16.7 for why (the kitty protocol letterboxes unconditionally when both
placement dimensions are given, so stretch cannot be made honest at the pixel
tier).

### 8.3 Intrinsic size (`fit`)

`fit()` on either axis resolves to the image's **intrinsic cell size** under the
half-row pixel convention (§3). For image data of `W × H` pixels:

- intrinsic width = `W` cells
- intrinsic height = `ceil(H / 2)` cells

This is evidence-free: the convention is an assumption about the host cell, not
a measured value. An `img` with both axes at `fit()` renders at native terminal
pixel density under the assumed cell shape.

For an alt-only element (`image` omitted), `fit()` resolves to the alt text's
wrapped size, like a `text()` element with wrapping enabled.

### 8.4 Background and pointer

- `bg` fills the element's layout box with the given packed ARGB background,
  following the element-background rules for `open({ bg })` (renderer-spec
  §12.2). Image pixels composite above it: kitty graphics alpha-blend over the
  cells, so transparent source regions leave the background visible; ascii art
  leaves the background of opaque cells untouched (§9.3.5).
- The element is a pointer target under its `id` over its **layout box**. The
  existing pointer event surface (renderer-spec §12.4) applies unchanged;
  coverage does not affect hit-testing.

### 8.5 Clipping

The effective clip region rules of renderer-spec §7.5 apply to image elements
unchanged. The element's **effective footprint** is the intersection of its §8.2
painted footprint with its effective clip region; the effective layout box is
the intersection of its layout box with the region.

- When the effective footprint is empty, the element paints nothing: no
  placement is emitted and any previous placement is stale (§10).
- The ascii and alt tiers paint only within the effective region — their
  per-cell output is ordinary cells and is suppressed outside it by the existing
  clip machinery.
- **Containment gate.** A pixel-tier placement paints whole cell boxes the
  terminal cannot clip. When the effective footprint is smaller than the painted
  footprint — the image is partially clipped — the kitty tier is unavailable for
  that element in that frame and resolution falls through to the ascii tier
  (§9.1), which renders the visible part as ordinary cells with no
  re-measurement: kitty and ascii share the painted footprint (§8.2). This keeps
  INV-I4 honest — the terminal letterboxes the transmitted image into the
  `c=`/`r=` box whenever its aspect differs, so a clipped placement whose box
  aspect no longer matches the image would claim cells its pixels do not fill.
  The same rule resolves scroll containers: an image scrolled partially out of a
  clipping ancestor renders as ascii art.

## 9. Tier Emission Contract

### 9.1 Ladder resolution

For each `img` directive, the renderer resolves exactly one tier:

1. If `variant` is `"alt"`, or `image` is omitted, or the registry id is not
   live — the tier is `alt` (with `IMAGE_NOT_FOUND` surfaced per §13 in the
   missing-image case).
2. If `variant` is `"kitty"` or `"ascii"`, that tier is selected when its
   evidence gate (§11.1) passes; otherwise resolution proceeds as if `variant`
   were `"auto"`.
3. Otherwise (`variant` omitted or `"auto"`), the ladder is walked in order:
   `kitty` when its evidence gate passes and the containment gate of §8.5 holds,
   then `ascii` (always available), then `alt`.

The resolution is deterministic (INV-I4): the same directive, capability
snapshot, registry state, and placements table always yield the same tier and
footprint. An evidence-gated override that fails its gate produces no error —
the ladder is the defined fallback, not an exception path.

### 9.2 Kitty tier

The kitty tier emits Kitty graphics protocol bytes (APC framing,
`ESC _ G <control keys> [;<payload>] ESC \`), conformant with the protocol
specification. Every control block the renderer emits MUST set `q=2` (INV-I5).

#### 9.2.1 Wire identities

- The wire **image id** is the registry id, transmitted verbatim. The protocol's
  id space — positive integers up to 4294967295, zero forbidden (a zero or
  omitted id means "no id") — is exactly the registry id range of §3, so the
  identity mapping keeps every registry id addressable with no transformation to
  test or explain.
- The wire **placement id** is a pure function of the directive's element id and
  the image's registry id, in `[1, 4294967295]`. The protocol treats `p=0` (and
  omission) as "unspecified", which would create accidental additional
  placements — placement ids MUST NOT be 0.
  - Requirements: deterministic (same inputs → same id across frames and across
    Terms' sessions with the same element ids), uniform over its range, and
    cheap to compute. The specific hash is implementation-defined (§15).
  - Collision handling: two elements whose (element id, registry id) pairs
    collide in the hash would share a placement id and each other's cleanup. The
    renderer MUST detect same-frame collisions and resolve them
    deterministically: the affected elements resolve to the ascii tier for that
    frame, emit no placements, and surface `"IMAGE_PLACEMENT_COLLISION"` per
    affected element (§13) — a collision can never leave undeletable graphics
    debris on the terminal. A renderer-side id counter would reintroduce
    cross-frame state and is deliberately avoided (INV-I3).
- Every placement is identified on the wire by the pair (image id, placement
  id); image ids alone never address a placement this renderer created.

#### 9.2.2 Transmission

- Pixels are transmitted as RGBA direct data: `a=t,t=d,f=32`, with source
  dimensions `s=<W>,v=<H>` and wire image id `i=<IID>`, base64-encoded.
- Transmission is **lazy**: it occurs in the render transaction that first
  places the image, not at `setImage()` time.
- **Transmission state.** Each registry entry tracks the data version last
  transmitted (0 = never). Before a placement is emitted, the renderer transmits
  the image iff `transmitted_version ≠ version`. After a successful
  transmission, `transmitted_version = version`.
- `transmitted_version` MUST be reset to 0 — forcing re-transmission on the next
  placement — when: the image's last live placement is deleted (unmount, tier
  switch, collision demotion, registry removal); a `kitty-graphics` capability
  denial deletes its placements (§11.2); or the Term is resized (the placements
  table, and with it all assumptions about terminal-side image persistence, is
  discarded).
- **Re-transmission is preceded by deletion.** Any transmission of data for a
  wire image id that may already exist terminal-side MUST be preceded by
  `ESC _ G a=d,d=i,i=<IID>,q=2 ESC \` (delete image and all its placements). The
  protocol requires this for id re-use: re-transmitted data does not update
  existing placements, and the old image must be removed first to avoid
  divergent behavior when ids are re-used in a session.
- Payload chunking: chunks MUST be at most 4096 bytes of base64; every chunk
  except the last MUST have a length that is a multiple of 4; all chunks except
  the last MUST set `m=1`, the last MUST set `m=0`. The first chunk's control
  block carries the full transmission keys; continuation chunks carry only the
  `m` key, in the protocol's documented form. The renderer MAY choose smaller
  chunks.
- The renderer MUST NOT re-transmit image data while
  `transmitted_version =
  version` (INV-I2 discipline: no redundant uploads) —
  subject to the resets above, which exist because the protocol's storage quota
  preferentially deletes images without live placements, so persisted-data
  assumptions MUST be dropped whenever this renderer drops a placement.

#### 9.2.3 Placement positioning

Placements are positioned by the hardware cursor: the protocol renders a
placement at the cursor's current cell, from its top-left. Without pixel
geometry evidence (§16.3) this cursor-positioned form is the protocol's only
cell-addressable placement path, and it is the one v1 uses.

- Before each placement control block, the renderer MUST move the hardware
  cursor to the effective footprint's origin cell with the same absolute CUP
  form the renderer uses for cell writes, including the render `row` option
  (renderer-spec §8.2.1).
- The placement control block is
  `a=p,i=<IID>,p=<PID>,c=<cols>,r=<rows>,C=1,q=2`: the footprint's cell
  dimensions on `c=`/`r=`, and `C=1` to pin the cursor movement policy — the
  protocol's default post-placement cursor jump by the box size would leave the
  cursor at an implementation-defined position when the box exits the screen.
  `C=1` does not position the placement; the preceding CUP does.
- With both `c=` and `r=` given, the protocol letterboxes to prevent distortion.
  Because the footprint is the contain-fit region (§8.2), the letterbox is a
  no-op and the terminal's painted pixels fill exactly the footprint — the
  agreement INV-I4 requires.
- Placement ids are reused across frames for the same (element id, registry id).
  Re-sending a placement with the same (image id, placement id) pair replaces
  the previous graphic without flicker — the protocol's documented move/resize
  path — and §10.2 uses it normatively: a footprint change of an unchanged image
  is a pure re-place with no intervening deletion.

#### 9.2.4 Covered-cell blanking

Cells in the effective footprint are blanked as part of the frame's cell output
— spaces with the element `bg` applied (§8.4) — so no text shows through
transparent pixels and no stale text is trapped under the image (§10.1).

#### 9.2.5 Cleanup

- Before a frame's cell writes for a region whose placement is stale — the
  element unmounted, the tier changed away from kitty, the element demoted by a
  placement-id collision (§13), or the image removed or replaced — the renderer
  MUST emit deletion of the stale placement:
  `ESC _ G a=d,d=i,i=<IID>,p=<PID>,q=2 ESC \`. The lowercase form deletes the
  placement while retaining the terminal's stored data, which the protocol
  documents as re-displayable without resending; whether the data survives is
  governed by the transmission-state resets of §9.2.2, since stored data is
  never trusted. Deletions MUST precede the frame's other output for that
  region. A delete command received while an image's chunked upload is
  incomplete aborts the partial upload (per the protocol); §9.2.6's
  deletions-before-transmissions ordering makes that unobservable.
- The renderer MUST NOT rely on the terminal's text-overwrites-graphics behavior
  for cleanup; it deletes explicitly (INV-I6).

#### 9.2.6 Frame ordering

Within one render transaction's output, the renderer MUST emit, in order:

1. **Stale-placement deletions** — every placement in the placements table that
   this frame does not re-create and whose image's data version did not change,
   in previous-frame directive order. (Data-version deletions ride with the
   transmission block below, not here.)
2. **Transmissions** — for each image requiring (re-)transmission: the delete-id
   block, then its chunks, in registry id order. The delete-id block subsumes
   any scoped deletions for that image's placements: the protocol requires
   existing image and placements to be deleted before re-transmission, and the
   same frame re-places them (§10.2).
3. **Cell writes** — the ordinary changed-cell diff bytes, including covered
   cells' blanks and any repair bytes from §10.
4. **Placements** — for each kitty placement, in directive order: the
   positioning CUP, then the placement control block.

The two ordering constraints that matter: deletions precede the cell writes that
repaint their footprints, and blanking precedes the placements that overwrite
those blanks. Both hold in the order above. After the last placement, the
renderer MUST restore the post-frame cursor state required by renderer-spec §7.6
(the §10.6 carve-out).

### 9.3 ASCII tier

The ascii tier renders the image as character art in the cell grid. It uses only
ordinary cells, so it works on every terminal and participates in normal
diffing.

Glyph selection is **shape-aware**, adopting the approach described in
[ASCII characters are not pixels](https://alexharri.com/blog/ascii-rendering)
(Harri, 2026). A 1-D luminance ramp treats characters as pixels: their shapes
are ignored, edges blur into averaged blocks, and contours jag. Instead, each
candidate character is modeled by a shape vector that measures how its ink
distributes across regions of the cell; each source cell is measured over the
same regions; and the character whose shape best matches the measurement is
emitted. Characters then follow image contours, giving the art far higher
effective resolution than block-averaged downsampling. The pipeline below is
deterministic (INV-I4).

#### 9.3.1 Source-rectangle sampling

The image is mapped onto the effective footprint cell by cell. Cell `(cx, cy)`
of a `cols × rows` footprint maps to the source rectangle starting at
`round(cx * W / cols)`, `round(cy * H / rows)` and ending at
`round((cx+1) * W / cols)`, `round((cy+1) * H / rows)`. When this rectangle is
empty — the mapping rounds to zero width or height at fine footprints — it
consists of the single pixel at the start coordinates, clamped into the image.

Three measurements come from each cell's source rectangle:

- **Color sample** — the per-channel arithmetic mean of the rectangle's pixels.
  Drives foreground color (§9.3.5).
- **Alpha sample** — the mean alpha of the rectangle's pixels. Drives
  transparency (§9.3.5).
- **Glyph sampling vector** — one luma value per internal sampling circle
  (§9.3.2): the mean of `Y = 0.2126·R + 0.7152·G + 0.0722·B` (channel values
  0–255) over the rectangle's pixels whose centers fall inside that circle.
  Alpha does not participate in glyph sampling (Open Decision 3).

All sampling happens in a cell-relative coordinate frame: a point `(u, v)` in
the unit cell maps to the source plane by `x = x0 + u·(x1 − x0)`,
`y = y0 + v·(y1 − y0)`. Internal circles sample `u, v ∈ [0, 1]`; external
circles sample outside the unit cell (§9.3.2), and the same map extrapolates
them onto the source plane.

The same luma formula, sampled over the **external** sampling circles — which
reach beyond the cell into neighboring source regions — yields the cell's
**external sampling vector**. Pixels outside the source image are excluded from
an external circle's sample; a circle with no in-bounds pixels contributes
nothing to the enhancement in §9.3.4.

#### 9.3.2 Sampling circles and shape vectors

Sampling circles are fixed regions of the cell, defined in cell-relative
coordinates so they are independent of footprint size and source resolution:

- Six **internal sampling circles** arranged in two staggered columns — the left
  column lowered, the right raised, radii enlarged — so the pair covers the cell
  well while limiting mutual overlap. Staggering follows the cell's
  taller-than-wide shape (the `A = 2` convention of §8.2) and captures
  top/bottom, left/right, and diagonal structure: `T` vs `L` vs `p` vs `q`, `-`
  vs `_` vs `^`, `/`.
- Ten **external sampling circles** around the cell boundary, each reaching into
  neighboring cells. They have no effect on a solitary cell, but they let
  contrast enhancement see boundaries adjacent to it (§9.3.4), which removes the
  staircasing that global enhancement alone produces.

The circle geometry — centers and radii as fractions of the cell box, plus a
fixed internal/external circle ordering — is a closed parameter set whose
numeric values are calibration constants pinned by golden tests in the
implementation PR (Open Decision 2). What this specification closes normatively:
the counts (6 internal, 10 external), the two-column staggered arrangement with
lowered-left/raised-right and enlarged radii, the fixed orderings used by the
affecting table below, and the per-component max normalization of shape vectors.

**Shape vectors.** For each character in the candidate set (§9.3.3), a
6-component shape vector records, for each internal sampling circle, the
fraction of that circle's area covered by the character's ink. Shape vectors are
computed at build time from a rasterization of each character over the same
circle geometry and compiled into the module (§15) — no runtime font access
exists (INV-I1; the renderer has no font machinery). Every component is then
divided by the largest value of that component across all candidates
(per-component max normalization), spreading the candidates across the full
component range.

Shape vectors model the build-time rasterization face, while the host terminal
renders the final glyphs in its own font. The renderer cannot rasterize the
host's font (INV-I1), so this mismatch is unavoidable; it is why the candidate
set SHOULD favor shape-stable glyphs (Open Decision 1).

#### 9.3.3 Character set and matching

The candidate set is a closed table: all 95 printable ASCII characters
(U+0020–U+007E), in ascending code-point order; this order is the tie-break
order. U+0020 (space) is the zero-density anchor; the alpha rule (§9.3.5)
bypasses matching entirely for transparent cells.

| Range       | Characters                                                  |
| ----------- | ----------------------------------------------------------- |
| U+0020      | `` (space)                                                  |
| U+0021–002F | `!` `"` `#` `$` `%` `&` `'` `(` `)` `*` `+` `,` `-` `.` `/` |
| U+0030–0039 | `0`–`9`                                                     |
| U+003A–0040 | `:` `;` `<` `=` `>` `?` `@`                                 |
| U+0041–005A | `A`–`Z`                                                     |
| U+005B–0060 | `[` `\` `]` `^` `_` `` ` ``                                 |
| U+0061–007A | `a`–`z`                                                     |
| U+007B–007E | `{` `\|` `}` `~`                                            |

Pruning to a curated subset is Open Decision 1.

The cell's glyph is the candidate whose shape vector has the smallest squared
Euclidean distance to the cell's contrast-enhanced glyph sampling vector
(§9.3.4); the squared distance suffices, no square root is taken. Distance ties
resolve toward the lower code point. Lookup acceleration — k-d trees over the
6-D vectors, or result caches keyed by quantized sampling vectors — is
implementation-defined (§15); cached and uncached lookups MUST agree.

#### 9.3.4 Contrast enhancement

Before matching, the glyph sampling vector passes through two contrast steps, in
this order. Enhancement increases the separation between differently shaded
regions, so boundary cells pick characters that emphasize the boundary (the `&`
→ `b` → `L` style transitions of the reference approach) instead of mid-density
compromises. It barely affects near-uniform vectors, so smooth gradients
survive. Sampling vectors are oriented bright-to-dense: brighter source regions
match denser-ink glyphs.

1. **Directional** (per component `i`): with
   `m = max(v[i], max({v_ext[j] : j affects i}))`, set
   `v[i] = (v[i] / m)^γd · m`; when `m = 0`, the component is set to `0`. The
   affecting-external sets — normative, from the reference approach, with
   internal circles `0–5` and external circles `0–9` in their fixed ordering —
   are:

   | Internal | Affected by external |
   | -------- | -------------------- |
   | 0        | 0, 1, 2, 4           |
   | 1        | 0, 1, 3, 5           |
   | 2        | 2, 4, 6              |
   | 3        | 3, 5, 7              |
   | 4        | 4, 6, 8, 9           |
   | 5        | 5, 7, 8, 9           |

2. **Global**: with `m = max(v)`, set `v[i] = (v[i] / m)^γg · m` for every
   component; when `m = 0`, the vector is set to all zeros.

The exponents `γd` and `γg` are baked implementation constants calibrated
together with the circle geometry (Open Decision 2).

#### 9.3.5 Alpha, color, and layout agreement

- When the alpha sample is below 128, the cell is transparent: glyph space
  (U+0020), no foreground, and the background rules of renderer-spec §8.3.3
  apply (element `bg` when declared, otherwise the underlying background is
  preserved).
- Opaque cells (alpha sample ≥ 128) carry the color sample as their foreground,
  encoded through the renderer's existing color-encoding path; when the
  color-encoding capability work lands, ascii art colors follow it. The
  background of opaque cells is not overridden: the glyph's ink density over the
  preserved background is what carries the image's lightness, and equalizing
  foreground and background would erase the very glyph texture the shape matcher
  selected.
- The effective footprint computed in §8 is exactly the art's cell region
  (INV-I4). The art is never clipped by its own tier; callers size the element
  or rely on clip regions as with any content.

### 9.4 Alt tier

The alt tier renders `alt` as plain cell text over the **entire layout box**:
wrapped at the box width, clipped at the box height (overflow is suppressed, not
laid out past the box), with the element's `bg` applied per §8.4 and no implicit
prefix or decoration. Empty `alt` renders an empty box (decorative image). Alt
text is unstyled in v1 — no foreground override, no attributes.

## 10. Cell-Buffer Integration and Damage

### 10.1 Covered-cell representation

A cell inside a live kitty placement's effective footprint holds the
**covered-cell value**: space glyph, no foreground, and the element's declared
`bg` — or the default background when none is declared. Covered cells are
ordinary diff participants: front and back values equal ⇒ no bytes, exactly as
for any other cell. There is no sentinel mode, no special diffing, and no
per-cell ownership map in v1.

The letterbox margin cells of the layout box (outside the footprint) are
ordinary background cells under §8.4 and diff normally.

### 10.2 Footprint change

When an image's effective footprint changes between frames and the image's data
version is unchanged, the placement is **re-placed**: emitted at the new origin
with its same (image id, placement id) pair (§9.2.3). The protocol's same-pair
replacement removes the previous graphic without flicker and without an
intervening delete; the old box's pixels vanish with the placement record, and
the blanks previously written under them remain the terminal's text content at
those cells. The diff then repaints the old box's cells whose front-buffer value
(blank) differs from the back (the ordinary vacate case) and emits blank bytes
for newly covered cells. No deletion occurs for a mere move or element resize,
and no bytes are emitted for old-box cells whose new content equals the blank
value they already hold.

When the data version changed, the re-transmission path of §9.2.2 applies:
delete, re-transmit, then re-place every placement of that image. When the
placement is not re-created at all — unmount, tier change, collision demotion —
the stale placement is deleted (§9.2.5).

A placement whose covered cells receive any cell write in the current frame — a
changed blank-state background beneath unchanged coverage, or any other buffer
change inside its footprint — MUST be re-placed with its same (image id,
placement id) pair in that frame: any write under a placement erases the
graphic's cells, so the re-place heals the whole box rather than poking holes in
it. The re-place is the repair; no deletion is emitted for it.

Because a deleted placement's pixels are erased by the delete itself, the
renderer MUST additionally force the diff to re-emit every cell of a deleted
placement's previous footprint: each such front-buffer cell is dirty-marked
(§10.4) before diffing. This **deletion damage** rule is what keeps the
terminal's visible state matching the cell buffer after an unmount, tier change,
or removal (INV-I6).

### 10.3 Overlap policy

Content from other elements that lands in a live placement's footprint is
**suppressed by a post-walk coverage pass**: after the render-command walk —
including border-junction resolution — image elements resolved to a pixel tier
assert their effective footprint into the back buffer, writing the covered-cell
value over whatever content the walk left there. Running the pass after the
walk, not in directive order, is what makes suppression structural: overlapping
text's bytes are never emitted, so no damage-repair reaction is needed for text
overlap, and directive order cannot defeat coverage. Pixel-tier coverage cannot
honor painter's order — the terminal renders the placement as a layer over the
whole box, and a cell buffer that showed text under the placement would disagree
with the terminal's visible state either way the bytes were ordered (§9.2.6). v1
therefore makes the image win at the pixel tiers, deterministically.

- When two pixel-tier footprints overlap in one frame, the later element (in
  directive order) **demotes to the ascii tier for that frame** — a ladder
  fallback, silent like any other fall-through (§9.1), because the demoted
  element remains fully representable. The earlier placement keeps its footprint
  intact; the demoted element's art cells are ordinary cells that the coverage
  pass overwrites with the earlier placement's blanks.
- Overlap between **ascii**/**alt**-tier images is ordinary painter's order:
  later content in directive order wins per cell, like any text.
- The placements-table capacity degradation of §5.4 applies before any placement
  is emitted, so suppression never leaves an untracked placement.
- Callers SHOULD avoid overlapping images with other content in v1; the
  z-ordered coexistence design is deferred (§16.6).

### 10.4 Dirty-marking primitive

Dirty-marking a cell region forces the next render's diff to emit bytes for it.
The described mechanism: overwrite the region's front-buffer cells with the
default cell value, so the next diff necessarily differs. Any mechanism that
guarantees the same emissions satisfies the contract. Dirty-marking is used by:
`removeImage` (§7.2), deletion damage (§10.2), and capability invalidation
(§11.2).

### 10.5 Resize

A resize step (renderer-spec §7.7) discards the placements table with the rest
of the diff state. Before the discard, the resize transaction MUST:

1. Recover the images with live placements from the table and emit, in the
   update's returned bytes, one data-freeing deletion per image:
   `ESC _ G a=d,d=I,i=<wire image id>,q=2 ESC \`. This is the write-now
   discipline (TINV-5): the redraw that follows cleans pixels by writing text
   over covered cells, but it cannot clean terminal-side records the way a
   deletion does.
2. Reset the affected images' transmission state (§9.2.2) — placements are gone,
   so persisted-data assumptions are dropped (the protocol's storage quota
   preferentially deletes images without placements).
3. Reconcile the table and the front buffer's covered cells as part of
   discarding diff state, so the next render's complete redraw contains no
   image-specific bytes beyond the new frame's own paint.

Registry entries and their pixel data are Term state, independent of terminal
dimensions, and MUST survive a resize unchanged (§5.1).

### 10.6 Cursor interaction

Placement positioning requires moving the hardware cursor. This is the sole
sanctioned exception to renderer-spec §7.6's "no cursor-positioning bytes in
caret-less frames": frames containing kitty-tier images MAY include the
cursor-positioning bytes needed for placement, provided the post-frame cursor
visibility state defined in §7.6 is unchanged, and for caret-declaring frames
the post-frame position is the caret's cell as §7.6 requires. The renderer MUST
account for the render `row` option (renderer-spec §8.2.1) when computing
placement positions, exactly as it does for cell CUPs.

## 11. Capability Evidence and Invalidation

### 11.1 Evidence table

| Tier  | Gate                                         | Evidence source                                                                                                                             |
| ----- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| kitty | `RuntimeCapabilities.kittyGraphics === true` | Probe query 9 (APC `_G` query, terminfo-spec §9.1), delivered as a `CapabilityEvent` (terminfo-spec §6.3) folded in through `term.update()` |
| ascii | none                                         | Always available                                                                                                                            |
| alt   | none                                         | Always available                                                                                                                            |

The v1 kitty gate is the existing boolean. The renderer does not verify
sub-features of the kitty graphics protocol (placeholders, animation) in v1; it
uses only transmission, placement, and deletion — the protocol's core.

### 11.2 Capability-change invalidation

When a `CapabilityEvent` folded through `update()` changes a tier's eligibility
— a `kitty-graphics` event arriving true or false — the update transaction's
behavior is:

- **Denial (true → false).** The transaction returns immediate deletion bytes:
  one data-freeing `a=d,d=I,i=<wire image id>,q=2` block per registry image with
  live placements (§7.2), recovered from the placements table before any state
  is discarded, and resets the affected images' transmission state (§9.2.2). The
  table's placement entries are then cleared and the front buffer's covered
  cells are reconciled to their blank-state values, so the next render emits no
  redundant image bytes. This honors the write-now discipline (TINV-5): a caller
  that never renders again does not leave graphics on the terminal.
- **Grant (false → true).** No immediate bytes: the terminal's visible state
  does not change (the lower tier's art is on screen; the kitty tier has nothing
  to delete). The next render's own resolution transmits and places at the kitty
  tier.

This is the focused-spec output invalidation that renderer-spec §7.7 and §7.8
reserve for feature specifications. A capability event that changes only color
encoding (e.g., `colordepth`) affects ascii art colors; the renderer MAY re-emit
affected art on the next render. It MUST NOT re-transmit unchanged kitty data
for color changes.

### 11.3 Removal and capability edge cases

- `removeImage()` when `kittyGraphics` is false but the id is live still returns
  deletion bytes (§7.2): placements placed under earlier evidence may persist
  terminal-side.
- An image placed at the kitty tier whose capability is later denied is cleaned
  by §11.2's immediate denial rule, not by `removeImage()`.
- A tier re-arm (denied → supported) re-transmits lazily at the next placement:
  the denial deleted the terminal-side data, so the transmission reset of §9.2.2
  forces a fresh upload. No bytes flow at grant time.

## 12. Interaction with Line Mode

In `mode: "line"` renders (renderer-spec §8.2.2), tier resolution is capped at
`ascii`: the renderer MUST NOT emit graphics-protocol bytes in line mode. Line
mode output is newline-separated rows written inline; the graphics protocol
requires cursor-addressed placement that line mode does not own. The ladder
above the cap resolves to ascii, then alt, unchanged.

## 13. Errors

The render result's `errors` channel (renderer-spec §12.3) gains three
Clayterm-specific types alongside `"CLIP_DEPTH_EXCEEDED"`:

| `type`                        | Raised when                                                                                             | Behavior                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `"IMAGE_NOT_FOUND"`           | An `img` directive references a registry id that is not live (registry empty, id never set, or removed) | Renders at the alt tier (graceful degradation); reported once per affected element per render                             |
| `"IMAGE_PLACEMENTS_EXCEEDED"` | More kitty placements were required in one frame than the placements table holds (§5.4)                 | Excess elements degrade to the ascii tier for that frame, in directive order; reported once per render                    |
| `"IMAGE_PLACEMENT_COLLISION"` | Two or more elements in one frame derive the same placement id (§9.2.1)                                 | The affected elements resolve to the ascii tier for that frame and emit no placements; reported once per affected element |

None of these abort the frame; other elements render normally. The error
`message` fields SHOULD identify the affected element ids and, for
`"IMAGE_NOT_FOUND"`, the missing registry id. All three are specified as closed
fallbacks rather than undefined behavior so that no condition can leave
undeletable graphics debris or an untracked placement.

Thrown conditions — descriptive `RangeError`s that abort the transaction and
return no bytes (INV-I9), following the transfer-overflow discipline of
renderer-spec §9.2:

| Condition                                  | Raised by    | Message SHOULD identify…                                        |
| ------------------------------------------ | ------------ | --------------------------------------------------------------- |
| `setImage` validation failure (§7.2)       | `setImage()` | the offending field and value                                   |
| Registry table full / pixel pool exhausted | `setImage()` | the capacity limits and the requested size (§5.3)               |
| Output-capacity overflow                   | `render()`   | the emission that overflowed (suggest a smaller image or frame) |

After any throw, the Term remains usable: the next render behaves as a full
re-render of that frame (INV-I9 keeps retained state truthful).

## 14. Testing Strategy

All tests live in `test/graphics.test.ts` — one spec, one test file (AGENTS.md).
Obligations:

1. **Tier resolution truth table.** For every combination of `variant`, `image`
   presence, registry liveness, and `kittyGraphics` evidence, the selected tier
   matches §9.1.
2. **Footprint math.** Intrinsic size (§8.3), contain resolution (§8.2) —
   including the `ceil`/`round`/`floor` edge cases, empty footprints, and
   upscale/downscale paths — agree between a pure reference and rendered output
   (INV-I4).
3. **Kitty conformance.** Transmitted frames are valid APC with RGBA direct
   encoding (`a=t,t=d,f=32,s=,v=`), chunked at ≤ 4096 base64 bytes with
   multiple-of-4 non-final chunk lengths, `m=1` continuation / `m=0` final,
   `q=2` on every control block, ST-terminated. Placement blocks carry
   `a=p,i=,p=,c=,r=,C=1,q=2` and are preceded by a CUP honoring the `row`
   option.
4. **Transmission state.** First placement transmits; re-renders without data
   change do not re-transmit; a version bump emits delete-id, re-transmit,
   re-place in order (§9.2.2); loss of the last placement (unmount, tier switch,
   collision demotion), capability denial, and resize each force re-transmission
   on the next placement (§9.2.2, §11.2).
5. **Placement and cleanup.** First placement emits no stale-delete; footprint
   change of an unchanged image emits a pure same-pair re-place with no deletion
   (§10.2); a version bump emits delete, re-transmit, re-place (§9.2.2); unmount
   and tier switch emit the scoped lowercase `a=d,d=i,…,p=…` form; `removeImage`
   emits the data-freeing `d=I` form once and the next render emits no image
   bytes for the vacated footprint; placement ids are stable across frames for
   the same element and distinct across elements; ids are never 0; wire image
   ids equal registry ids.
6. **Cell-buffer honesty.** Covered cells hold the covered-cell value and
   produce no bytes while unchanged; overlapping text is suppressed (§10.3);
   vacated and deletion-damaged cells repaint (§10.2).
7. **ASCII art determinism.** Golden-image tests: fixed pixel input → exact
   glyph/fg/bg cells, locking the circle arrangement, affecting table,
   shape-vector normalization, tie-breaking, the alpha threshold, and the
   empty-rectangle rule (§9.3). Cached and uncached glyph lookups MUST agree.
   Edge cases: uniform vectors pick density-appropriate glyphs with minimal
   enhancement; external circles crossing the image border contribute nothing;
   1×1-cell footprints.
8. **Alt tier.** Wrap, clip, empty-alt, bg application, and box-width text
   painting (§9.4).
9. **Registry API.** `setImage` validation RangeErrors (bad id, bad dimensions,
   wrong byte length, table-full, pool-exhausted-even-after- compaction);
   replace bumps data version; compaction preserves live entries' render output;
   `removeImage` idempotence, byte emission with `kittyGraphics` both true and
   false, and dirty-marking.
10. **Capacity behavior.** Registry and placements capacities produce §5.3's
    RangeError and §13's degradation respectively, deterministically.
11. **Capability invalidation.** `kitty-graphics` true after ascii renders
    switches tier on next render; denial after kitty renders returns deletion
    bytes from `update()` and the next render paints ascii (§11.2).
12. **Line mode.** Kitty-tier images render as ascii in line mode (§12).
13. **Snapshot equivalence.** An `img` directive inside `snapshot()` renders
    identically to the direct directive (renderer-spec §9.1), and re-resolves
    registry liveness and tier at each render rather than at pack time.
14. **Clip interaction.** Clipped images place and paint only their effective
    footprint (§8.5).
15. **Resize.** Registry survives resize; the resize update returns one
    data-freeing deletion per image with live placements and resets transmission
    state; the placements table is discarded; the post-resize redraw erases
    prior pixels; re-transmission occurs on next placement (§10.5).
16. **Errors.** `IMAGE_NOT_FOUND` fallback and once-per-element surfacing;
    `IMAGE_PLACEMENT_COLLISION` demotes affected elements and emits no
    placements; a thrown render returns no bytes and leaves retained state
    unchanged, with the retry render reproducing the frame (INV-I9).
17. **Input-stream cleanliness.** Rendered output containing kitty frames, fed
    to `input.scan()`, yields zero events (INV-I5).

## 15. Implementation Notes

_This section is non-normative._

**Transfer encoding.** `img` adds one opcode to the command buffer in the §12.1
style: an opcode word, the id string, a property mask, and fields for the
registry id, sizing axes, alt string, variant, and bg. The existing protocol is
extended, not restructured. Because the underlying layout engine models elements
as open/close pairs, the void directive expands to a balanced open/close pair
with leaf sizing at decode time; `validate` sees the void form.

**Placement-id derivation.** The reference implementation pins FNV-1a over the
element id's UTF-8 bytes and the registry id's decimal digits — XOR-separator
`0x3A` between them; a raw result of 0 maps to 1 — into `[1, 4294967295]`;
golden tests lock the exact values. The derivation MUST satisfy the normative
requirements of §9.2.1 (pure, deterministic, uniform); pinning is what makes
golden tests exact and cross-session reports comparable. The known limitation is
the same-frame collision case of §9.2.1, handled per §13.

**Ordinary-cell art.** The ascii tier's cell pipeline (glyph + fg + bg per cell)
is the same machinery plain text uses; no new cell representation is required
for art. Kitty-covered cells are the only new cell-buffer concept, and they are
behaviorally just blank cells (§10.1).

**Ascii cost and shape-vector baking.** Glyph selection samples each cell's
source rectangle per circle and runs a nearest-neighbor match per cell: O(W·H)
sampling once per changed image plus O(cells × candidates) distance evaluations.
The reference approach's accelerations apply — k-d trees over the 6-D shape
vectors, or result caches keyed by quantized sampling vectors — and are
implementation-defined, with cached and uncached lookups required to agree
(§9.3.3). The renderer MAY additionally memoize per-element matched art keyed by
(registry id, data version, footprint box) in fixed-capacity carved storage;
memoized and unmemoized outputs MUST agree. Shape vectors are baked at build
time from a rasterization of the candidate characters — a small closed table of
candidates × 6 circle fractions, not a font system — so no runtime rasterization
exists (INV-I1). Kitty transmission is O(W·H) once per data version. All costs
are bounded by registry image sizes, not by frame rate.

**Streaming video ergonomics.** The registry's replace-on-id path is the natural
video-streaming API (one `setImage` per frame; §4.5's video producer). Each
replacement costs a delete/re-transmit/re-place cycle (§9.2.2); terminals batch
this within a write burst, but the protocol does not guarantee flicker-free
updates. Per-frame streaming ergonomics are revisited with §16.4 (placeholders)
and §16.8 (animation frames), which would make moves pure cell diffs and updates
re-transmission-free.

**Cursor safety.** `C=1` keeps the cursor at the placement origin; combined with
§10.6's post-frame restore, no frame leaves the cursor somewhere the caller did
not put it.

## 16. Deferred (v1 boundaries)

### 16.1 Sixel tier

The intended ladder position is kitty → **sixel** → ascii → alt. Sixel is
deferred because it cannot be specified correctly without two evidence sources
that do not exist yet:

1. **Sixel support evidence.** Terminals advertise sixel in their DA1 feature
   bits (feature `4`); the terminfo specification currently treats the DA1 reply
   as a fence only. A follow-up must extend DA1 parsing into a new
   `CapabilityEvent` key (e.g., `sixel-graphics`).
2. **Cell-size geometry evidence.** Sixel paints pixels at the cursor with no
   cell-footprint parameter, so both the painted footprint and the required
   downscale depend on the cell pixel size (XTWINOPS 14/16, or OSC 776-style
   reports). Geometry reporting is a tracked terminfo follow-up.

When both exist, a focused amendment to this specification adds the tier:
256-color quantization of the source (quantizer choice implementation-defined),
deterministic re-encoding on footprint change, and region cleanup by
overpainting (sixel has no placement model to delete). Until then the ladder
skips sixel unconditionally, and a sixel-capable terminal still receives
kitty/ascii/alt.

### 16.2 iTerm2 inline images

OSC 1337 `File=` is a third pixel protocol. Evidence (identity parsing of
DA2/XTVERSION) is a terminfo follow-up; the tier slots between kitty and sixel
by fidelity.

### 16.3 Geometry-evidence scaling

With cell-size evidence (`A` measured instead of assumed 2), contain becomes
exact on terminals whose cells are not 2:1, and the intrinsic-size default can
be expressed in true terminal pixels. The change is internal to §8.2 and gated
on the geometry follow-up.

### 16.4 Kitty unicode placeholders

Transmitting once and placing via placeholder codepoints in cells would make
kitty-covered cells first-class diff participants (moves become pure cell diffs,
and scroll-region tracking comes nearly free). It requires evidence that the
terminal implements placeholders, which the current probe does not capture.
Deferred to a focused amendment.

### 16.5 Background-aware art

The lightness mapping assumes a dark terminal background: dark source regions
map toward low-density glyphs. When theme evidence
(`RuntimeCapabilities.theme.background`) indicates a light background, the
mapping SHOULD invert (complement the luma) so art remains legible. Deferred
until the color-encoding work lands.

### 16.6 Z-ordering and overlap

Coexistence of graphics with overlapping text (floating overlays over images) is
unspecified beyond §10.3's policy. A future design would need kitty `z`
semantics (including negative z-index placements, which the protocol draws under
text) or placeholder-based layering.

### 16.7 Stretch scaling

`scale: "stretch"` is not in v1. At the kitty tier it is unsatisfiable: with
both `c=` and `r=` specified the protocol letterboxes to prevent distortion, so
a stretched render would claim cells it does not paint (INV-I4). At the ascii
tier stretch is representable (the pixel mapping is renderer-owned) and could be
added as a directive property in a future amendment, ascii-only.

### 16.8 Animation, cropping, transitions

Under §4.5's layering, video is a per-frame revision-bump producer and the
substrate supports it today — but per-frame full re-transmission does not
flicker-free. The Kitty protocol's own animation machinery is its designed fast
path: multi-frame images, frame composition (delta frames), and playback
controls, uploaded once and played back without re-transmission. Landing it is a
focused amendment; it is a protocol sub-feature, and §9.1 does not verify
sub-features in v1. Multi-frame source formats, cropping source rectangles, and
transitions on image geometry are also not designed here. The directive model
leaves room: `image` could become a richer descriptor and `transition` could
apply to footprint axes without breaking §7.1's shape.

### 16.9 Synchronized-output wrapping

How graphics bytes interact with DECRQM 2026 frame wrapping is the
synchronized-output follow-up's concern. This specification treats graphics
bytes as ordinary frame output.

## Appendix A. Amendments Applied

The draft 0.1 appendix proposed ten amendments to existing specifications; they
were approved with this specification and are applied as follows:

- **With this specification (contract items).** A1 — renderer-spec §4.3's
  retained-state sentence now names diffing state (cell buffers, image registry,
  placements record). A2 — renderer-spec §7.6 gained the graphics-protocol
  cursor carve-out. A3 — renderer-spec §8.3.5 `img()`. A4 — renderer-spec §7.8
  references this specification instead of deferring Kitty graphics emission. A7
  — renderer-spec §8.1's `createTerm` gained the `imagePoolBytes` option. A8 —
  terminfo-spec §10.2's `createTerm` restatement gained the same option. A10 —
  renderer-spec §7.7's capability semantics note that this specification defines
  immediate update bytes for graphics cleanup.
- **With the implementation PR (current-surface notes).** A5 — renderer-spec
  §12.1/§12.2 notes for the `img` opcode and `ImgProps` surface. A6 —
  renderer-spec §12.3's error-type list gains `"IMAGE_NOT_FOUND"`,
  `"IMAGE_PLACEMENTS_EXCEEDED"`, and `"IMAGE_PLACEMENT_COLLISION"`. These
  describe the current implementation surface (§5) and are applied when the
  surface exists.
- **No changes.** A9 — the input specification is untouched: the parser already
  recognizes kitty APC replies (input-spec §6.2), and INV-I5 keeps the
  renderer's emissions from generating any.

## Open Decisions

The following are open. They are deliberately not resolved by this draft.

1. **The ascii candidate set.** §9.3.3 proposes all 95 ASCII printable
   characters. The alternative is a curated subset favoring shape-stable glyphs
   (`.`, `:`, `-`, `/`, `T`, `O`, …), trading matching precision for robustness
   against font variation between the baked rasterization and the host terminal.
   The set is a closed normative table; changing it later is a versioned spec
   change, not a tweak.
2. **Sampling-circle geometry and contrast constants.** §9.3.2 and §9.3.4 fix
   the structure (six staggered internal circles, ten external circles, the
   affecting-external table, directional then global enhancement, per-component
   max normalization) but defer exact centers, radii, orderings, and exponents
   to calibration against the reference implementation, locked by golden tests
   in the implementation PR.
3. **Alpha in glyph sampling.** §9.3.1 ignores alpha when sampling glyph
   lightness; transparency is decided per cell by the alpha sample. The
   alternative — alpha-weighting the luma samples or compositing semi-alpha
   color over the element background — would render semi-transparent regions
   blended, at the cost of coupling glyph choice to a channel the color path
   otherwise ignores.
4. **`removeImage()` return value.** §7.2 returns delete bytes immediately. The
   alternative — defer all cleanup to the next render — keeps `removeImage` void
   but leaves graphics on screen if the caller never renders again.
5. **Quiet mode strictness.** INV-I5 fixes `q=2` (all responses suppressed), so
   protocol failures are invisible to v1. A debug-mode `q=1` (suppress OK only)
   would surface failures — as APC replies the input parser would need to route
   somewhere safe — at the cost of violating the silence guarantee INV-I5 exists
   for.
6. **Image-id cohabitation and APC passthrough.** Registry ids map directly onto
   wire image ids (§9.2.1). A Term sharing its screen with another program that
   also uses kitty image ids could collide. Reserving a base offset or
   negotiating ids (the protocol's `I=` numbering) is possible; v1 declares the
   single-owner screen assumption instead. The probe's own graphics query is
   harmless to this assumption: it is a query action (`a=q`), which per the
   protocol "will not replace an existing image with the same id, nor will it
   store the image" — re-probes leave no image behind and collide with nothing,
   so no id reservation exists in v1. Multiplexers are the related hazard: a mux
   that swallows APC bytes silently degrades the ladder to ascii (no probe
   response arrives), which is correct behavior; a passthrough mux that
   mishandles graphics itself is not detectable in v1.
7. **Pixel-pool capacity policy.** §5.3 makes the pool a `createTerm` option
   (default 4 MiB) with compaction-only reclamation. Alternatives: a fixed
   normative constant (no option, less API surface, more waste for non-image
   apps), or size-classed blocks instead of contiguous extents (no compaction
   cost, more access complexity).
8. **Term teardown.** There is no disposal callback; graphics placed by a
   discarded Term are the caller's cleanup (§4.3). A `term.dispose()` returning
   deletion bytes is the natural completion of the lifecycle and is deliberately
   out of scope until the foundation defines Term disposal.
9. **Terminal-state desync.** Caller-owned terminal operations clear images
   behind the renderer's wire state: a reset (RIS) clears all images, an
   alternate-screen switch clears the screen's images (mode 1049), and the
   clear-screen escape (`ED 2J`) is specified to clear images — all
   caller-managed operations the wire state does not observe. v1 documents the
   ownership boundary (§4.3) and does not detect resets. Candidate future
   mitigations: a post-reset companion routine, or re-probe-driven re-sync.
   Undecided because resets are caller-owned terminal state, the same class of
   problem as alt-screen ownership.
