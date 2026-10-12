# Clayterm Color Encoding Specification

**Version:** 0.1 (draft) **Status:** Design specification for a work-in-progress
feature. Normative where it establishes invariants and contract. Descriptive
where surfaces may settle during implementation.

---

## 1. Purpose

The renderer emits one SGR color encoding for every cell it paints. Historically
that encoding was hardcoded to 24-bit truecolor (`\x1b[38;2;R;G;Bm`), regardless
of what the destination terminal supports. A 16-color terminal, a CI log, or a
pipe receives sequences its destination renders poorly — or not at all — when
`\x1b[31m` would have been both smaller and more faithful.

This specification defines how the renderer derives its color encoding from the
capability snapshot it already maintains, and how it downmaps truecolor values
into narrower palettes when the evidence calls for it. It resolves the deferred
"color encoding" item in [renderer-spec.md](renderer-spec.md) §7.8 and the open
question from the capability-foundation work about where the renderer's
authoritative capability state lives.

There is deliberately no caller-facing override. Capability evidence is the
single lever (TINV-3); an override would create a second source of truth that
could contradict probe responses.

---

## 2. Scope

### In scope (normative)

- The color tier resolution rule: how `trueColor` and `colors` in the capability
  snapshot determine the emitted encoding tier
- Ownership of the renderer's color-capability state inside the WASM module
- Per-tier SGR emission formats for foreground and background colors
- The downmapping algorithms from 24-bit RGB to the 256-color and 16-color
  palettes, including the normative nominal palette
- Output invalidation when the resolved tier changes between transactions

### In scope (non-normative, descriptive)

- Implementation notes for the C-side emission path
- The relationship between this specification and the failing-test reproduction
  that motivated it

### Out of scope

- **Terminal palette definition.** The renderer maps to palette _indices_; how a
  terminal renders index N is the terminal's business. OSC 4 palette queries
  remain deferred (terminfo-spec).
- **An `"8"`-color tier.** The 16-color tier already emits the base
  `30–37`/`40–47` codes for indices 0–7. A dedicated 8-color tier would need
  bright-index elision for marginal benefit; deferred.
- **88-color precision.** Terminals reporting `17 ≤ colors ≤ 255` resolve to the
  256 tier (§6.1); indices above 87 are the terminal's problem.
- **Per-render or per-call overrides.** Recorded as rejected in §7.
- **Other capability-driven emission** (synchronized output, pointer shape,
  Kitty protocols) — each has its own focused specification path.

---

## 3. Terminology

**Color tier.** One of `"truecolor" | "256" | "16"` — the same three-value
`ColorDepth` type defined in [terminfo-spec.md](terminfo-spec.md) §6.2. The tier
names the _emission encoding_, not the terminal's full capability set.

**Downmapping.** Producing the narrowest SGR sequence that faithfully represents
a 24-bit RGB color under the active tier.

**Nominal palette.** The 16-entry RGB table defined in §6.3. It is the
renderer's canonical model of what each 4-bit index _means_ for mapping
purposes. It is not a claim about any terminal's actual palette, which varies
and may be user-configured.

---

## 4. Architectural Model

### 4.1 Evidence flows one way

```
detectTerminal()          probe responses          update()
  terminfo entry    →      (input.scan)      →   CapabilityEvents
        ↓                                          ↓
   Capabilities  ──────────── fold ────────→  RuntimeCapabilities
                                                     │
                                     push (on change) │
                                                     ↓
                                    WASM Clayterm instance (authoritative)
                                                     │ resolve tier
                                                     ↓
                                              emit_attr formatting
```

Static evidence (terminfo entry, `COLORTERM`) and dynamic evidence (`colordepth`
CapabilityEvents) meet in the capability snapshot exactly as terminfo-spec
defines. The renderer consumes that snapshot; it never consults the environment
or the raw terminfo entry itself.

### 4.2 Capability state ownership

The renderer's authoritative color-capability state — the `colors` value and the
truecolor flag — resides inside the WASM module, on the Clayterm instance
struct. The host pushes values across the boundary:

- once at Term creation, seeding from `terminfo.capabilities` or the §7.1
  baseline of [terminfo-spec.md](terminfo-spec.md);
- after each `update()` whose folded events changed either value.

Render transactions read the in-module state directly; the host does not copy
capability values per render. State belongs to the instance struct — there is no
module-level mutable state.

A resize update re-initializes renderer state but MUST NOT reset color
capabilities to baseline: the tier is a property of the terminal, not of the
frame geometry. The host re-pushes the current values as part of the update
path, and the values MUST survive intact.

`term.capabilities` (the frozen `RuntimeCapabilities` snapshot) remains the
host-readable mirror. Its shape is unchanged by this specification.

### 4.3 The renderer is still a pure formatter

Nothing here changes the renderer's invariants: it performs no IO, manages no
terminal state, and produces bytes only. Tier resolution and downmapping are
pure functions of (capability state, packed cell color).

---

## 5. Core Invariants

- **CI-1 — Total, deterministic resolution.** Every capability snapshot state
  resolves to exactly one tier, by the rule in §6.1. The same state always
  yields the same tier.
- **CI-2 — Truecolor byte-identity.** Under the `"truecolor"` tier, output MUST
  be byte-identical to the renderer's historical (pre-this-specification)
  output.
- **CI-3 — Deterministic downmapping.** Every downmapping decision in §6.3 is a
  pure function of the RGB value and the tier. Ties always resolve to the lowest
  index.
- **CI-4 — Palette round-trip by color.** Under the `"256"` tier, every RGB
  value that is itself an entry of the 256-color palette maps to an index that
  represents that same RGB value. Where the nominal palette and the cube or
  grayscale ramp define the same color (eight cube corners plus `#808080`), the
  nominal index wins — the emitted index differs, the color does not. Under the
  `"16"` tier, every nominal palette entry maps to its own index.
- **CI-5 — Tier change forces full redraw.** If the resolved tier differs from
  the previous transaction's tier, the next transaction MUST emit the frame as a
  complete redraw. Diff state is cell-based; stale cells from the previous
  encoding must not survive.
- **CI-6 — Defaults stay default.** A cell with the default foreground or
  background emits no color SGR for that attribute, in every tier. Style
  attributes (bold, dim, italic, underline, blink, reverse, strikeout) and the
  SGR reset pattern are unchanged in every tier.

---

## 6. Rendering Contract Additions

### 6.1 Tier resolution

The renderer resolves the emission tier from the capability snapshot:

```
tier =
  trueColor            ? "truecolor"
  : colors <= 16       ? "16"
  :                      "256"
```

The `colors ≤ 16` boundary intentionally matches the denial mapping in
terminfo-spec §6.3 (`"16"` when `colors ≤ 16`, `"256"` otherwise), so the
renderer's derived tier and a `colordepth` denial event agree for every static
`colors` value. A `colordepth` probe event folds into `trueColor` (and is the
authoritative evidence for it per TINV-3); no other fold changes the tier.

Notes:

- `colors` values below 16 (including a missing `max_colors`, i.e. 0) clamp to
  the `"16"` tier. The 16-color tier emits base codes for indices 0–7 and
  aixterm bright codes for 8–15; a strictly 8-color destination's handling of
  bright codes is the destination's concern.
- Truecolor requires positive evidence (terminfo-spec §7.1): the `RGB`/`Tc`
  terminfo extension, `COLORTERM`, a direct-color entry (`max_colors ≥ 2²⁴`), or
  a `colordepth` probe response. The baseline — no evidence at all — resolves to
  `"256"`.

**Default-behavior change.** A Term created without any color evidence now emits
256-color SGR, where it previously emitted truecolor. This is the baseline
evidence model applied to emission, not a regression: the renderer's hardcoded
truecolor contradicted terminfo-spec §7.1 ("Truecolor is not assumed at
baseline"). Callers who require truecolor bytes without running
`detectTerminal()` must supply capability evidence themselves.

### 6.2 Emission formats

For a non-default foreground/background under each tier:

| Tier          | Foreground                                    | Background                                     |
| ------------- | --------------------------------------------- | ---------------------------------------------- |
| `"truecolor"` | `\x1b[38;2;R;G;Bm`                            | `\x1b[48;2;R;G;Bm`                             |
| `"256"`       | `\x1b[38;5;Nm`, N ∈ 0–255                     | `\x1b[48;5;Nm`, N ∈ 0–255                      |
| `"16"`        | index 0–7: `\x1b[3Nm`; index 8–15: `\x1b[9Nm` | index 0–7: `\x1b[4Nm`; index 8–15: `\x1b[10Nm` |

In the `"16"` tier, `N` is the resolved palette index for indices 0–7 and
`index − 8` for indices 8–15. Standard red (index 1) emits `\x1b[31m` foreground
and `\x1b[41m` background.

### 6.3 Downmapping

#### 6.3.1 Nominal palette

The nominal palette defines what each 4-bit index means to the renderer:

| Index | RGB       | Name    | Index | RGB       | Name           |
| ----- | --------- | ------- | ----- | --------- | -------------- |
| 0     | `#000000` | black   | 8     | `#808080` | bright black   |
| 1     | `#ff0000` | red     | 9     | `#ff5555` | bright red     |
| 2     | `#00ff00` | green   | 10    | `#55ff55` | bright green   |
| 3     | `#ffff00` | yellow  | 11    | `#ffff55` | bright yellow  |
| 4     | `#0000ff` | blue    | 12    | `#5555ff` | bright blue    |
| 5     | `#ff00ff` | magenta | 13    | `#ff55ff` | bright magenta |
| 6     | `#00ffff` | cyan    | 14    | `#55ffff` | bright cyan    |
| 7     | `#c0c0c0` | white   | 15    | `#ffffff` | bright white   |

The primaries (1–6) are the pure hues; the bright variants are their pastel
counterparts. This choice is what makes "standard red" (`rgba(255, 0, 0)`)
resolve to index 1 — the behavior the motivating issue pins.

#### 6.3.2 `"16"` tier

Map the RGB value to the nearest entry of the nominal palette by squared
Euclidean distance over the three channels; on a tie, choose the lowest index.
Exact palette matches are distance zero, so they subsume themselves.

#### 6.3.3 `"256"` tier

Resolved in order; the first matching rule wins:

1. **Exact nominal match.** If the RGB value equals a nominal palette entry,
   emit that index (0–15). This is why standard red emits `\x1b[38;5;1m` rather
   than the cube corner `\x1b[38;5;196m`: the terminal's index 1 _is_ its red,
   and consistency with the `"16"` tier is worth more than exact chroma here.
2. **Exact cube match.** If every channel is one of the six cube values
   `{0, 95, 135, 175, 215, 255}`, emit `16 + 36r + 6g + b` for the channel's
   cube step. (Exact grayscale cube values such as `#5f5f5f` resolve here.)
3. **Grayscale.** If `r == g == b`, choose the nearest value among the grayscale
   ramp `{8 + 10i : 0 ≤ i ≤ 23}` extended by the endpoints `0` (index 16) and
   `255` (index 231); on a tie, choose the lower index. Emit `232 + i` for ramp
   value `8 + 10i`, `16` for the low endpoint, `231` for the high endpoint.
4. **Cube nearest.** Otherwise, map each channel independently to the nearest
   cube value (ties to the smaller value) and emit `16 + 36r + 6g + b`.

Rules 1–3 are the exact-match tiers: nominal entries match in rule 1, cube
values in rule 2, and every grayscale ramp value matches itself in rule 3
(distance zero). Eight RGB values are defined by both the nominal palette and
the cube (the pure primaries, black, and white) — for those, rule 1 outranks and
the nominal index is emitted, which still satisfies CI-4 because the emitted
index represents the identical color.

#### 6.3.4 Default and attribute bytes

Default foreground/background emit no color SGR (CI-6). The high byte of a
packed color carries style attributes; downmapping consumes only the low 24 bits
and never alters attribute emission.

### 6.4 Invalidation on tier change

The update transaction itself still returns no bytes for capability events
(renderer-spec §7.7). This specification defines the consumer behavior the
foundation reserved: when the resolved tier changes, the _next_ render
transaction MUST emit a complete redraw (CI-5). No immediate bytes are required
— the redraw's own output re-encodes every visible cell.

### 6.5 What does not change

- The diff model: cells are compared on packed color values, exactly as before.
  The tier affects only how a changed cell's colors are _encoded_.
- The SGR reset + attribute prefix pattern in `emit_attr`.
- The output buffer budget; 256-color and 16-color sequences are strictly
  shorter than truecolor.

---

## 7. Public API impact

None. `createTerm`, `render`, `update`, and `RuntimeCapabilities` are unchanged.
This is deliberate.

**Rejected alternative — a `colorMode` option on `createTerm`.** The motivating
issue sketched `createTerm({ colorMode: "16" })` as an explicit override. It was
rejected: capability evidence is the single lever for renderer output (TINV-3),
and an override creates a second source of truth that can contradict probe
responses — a denial event would silently fight the override. Callers control
the encoding the same way they control every other capability: by supplying
evidence (a terminfo entry, or folding probe responses through `update()`).

---

## 8. Test plan

One test file (`test/color-encoding-modes.test.ts`) covers exactly this
specification:

- **16-color tier.** Standard red foreground → `\x1b[31m`; background →
  `\x1b[41m`; the 24-bit sequence must not survive; bright index mapping (e.g.
  `#ff5555` → `\x1b[91m`).
- **256-color tier.** Standard red foreground → `\x1b[38;5;1m`; background →
  `\x1b[48;5;1m`; exact cube round-trip (e.g. `#5f5f5f` → `\x1b[38;5;59m`);
  grayscale ramp mapping; nearest-cube mapping for non-palette colors.
- **Truecolor tier.** Byte-identity with the historical output (CI-2), including
  background and attribute combinations.
- **Tier resolution.** Baseline (no evidence) → `"256"`; `colors: 8` and
  `colors: 16` → `"16"`; `colors: 17` → `"256"`; a granted truecolor flag →
  truecolor. (How entries grant the flag — `RGB`/`Tc`, `COLORTERM`, direct-color
  `max_colors ≥ 2²⁴` — is terminfo-spec evidence territory, covered by its
  tests.)
- **Dynamic evidence.** A `colordepth` CapabilityEvent folded through `update()`
  changes the tier of the next render; the render after a tier change is a
  complete redraw in the new encoding (CI-5).
- **Defaults.** Default foreground/background emit no color SGR in every tier
  (CI-6).
- **Palette round-trip.** Every 256-palette RGB value maps to an index that
  represents the identical color under the `"256"` tier (CI-4, exhaustive sweep
  over a rendered 16×16 grid).

Existing test files that pin truecolor byte sequences (`term.test.ts`,
`border.test.ts`, `color.test.ts`) inject truecolor capability evidence at
creation so they continue to exercise the `"truecolor"` tier explicitly; the
default-tier change is pinned once, in the new file.

---

## 9. Deferred / Future Areas

- **OSC 4 palette queries.** Today the mapping assumes the nominal palette and
  standard 256 cube. Querying the terminal's actual palette would permit exact
  nearest-color downmapping against reality; deferred (terminfo-spec).
- **Perceptual distance.** Squared Euclidean RGB is deterministic and cheap. A
  perceptually weighted metric (e.g. OKLab) could improve downmapping fidelity
  for photography-like content; deferred until a use case demands it.
- **Dithering.** Adjacent-cell error diffusion to approximate out-of-palette
  colors; out of scope indefinitely.
