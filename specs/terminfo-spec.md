# Clayterm Terminfo & Capability Specification

**Version:** 0.2 (draft) **Status:** Proposed. Normative for the shared
capability layer.

---

## 1. Purpose

This specification defines Clayterm's terminal capability layer: how static
capability data (compiled terminfo binaries) and runtime capability data
(query/response handshakes such as OSC color queries and DA1) are resolved into
typed values that the renderer and the input parser consume independently.

The capability layer answers one question for both consumers: **what can this
terminal do?** The renderer receives a read-only runtime snapshot. Focused
renderer features decide how to consume that snapshot (color encoding, erase
strategy, synchronized-output frame wrapping, or protocol-specific output). The
input parser uses the raw key-sequence material from the terminfo entry to seed
its trie, and surfaces probe responses as `CapabilityEvent` values in the normal
event stream.

---

## 2. Scope

### In scope (normative)

- The `Capabilities` interface: its fields and the rules for how they are set
- The `Detection` value returned by `detectTerminal()`
- The `CapabilityEvent` discriminated union and its `key`/`value` shapes
- Compiled terminfo binary parsing (legacy and extended formats)
- The probe model: query batch, DA1 completion fence, and sans-IO contract
- The public API: `detectTerminal()`, `createTerm`, `createInput`, and the
  `applyUpdate` reducer
- The baseline capability set and the progressive-enhancement evidence model

### Out of scope

- How the renderer maps capabilities to emitted bytes (see
  [Renderer Specification](renderer-spec.md) §7.6 and §7.8)
- How the input parser recognizes query responses byte-by-byte (see
  [Input Specification](input-spec.md) §6)
- Caller-layer mode management (alt screen, mouse reporting, keyboard protocol
  modes) — capabilities inform these decisions but do not perform them

---

## 3. Terminology

**`Capabilities`.** A plain TypeScript interface holding the static capability
state of one terminal, resolved at detection time. Frozen after `detectTerminal`
returns. No WASM backing.

**`Detection`.** The value returned by `detectTerminal()`. Carries the frozen
`Capabilities`, the probe query batch (`probe`), and the raw terminfo
key-sequence bytes the input parser needs to seed its trie (`keys`).

**`CapabilityEvent`.** A discriminated union in the input event stream. The
input parser emits one `CapabilityEvent` for each probe response it recognizes.
Each event carries a `key` (a string literal identifying the capability) and a
`value` (an `Rgb` color or a `boolean`).

**`RuntimeCapabilities`.** The renderer's merged view: the static `Capabilities`
fields plus all `CapabilityEvent` values folded in by `update()` calls. Exposed
as a read-only property on `Term`.

**Probe.** A batch of terminal query sequences emitted as bytes by the caller,
whose responses arrive on the input stream and surface as `CapabilityEvent`
values from `scan()`.

**Fence.** The final query in a probe batch, chosen because every terminal
answers it. Its response marks the probe complete. DA1 (`CSI c`) is the fence.

---

## 4. Architectural model

### 4.1 Static and dynamic capabilities

Capabilities fall into two categories that never mix at runtime.

**Static capabilities** are resolved once by `detectTerminal()` from the
compiled terminfo entry and the process environment. They are fields on the
`Capabilities` interface, frozen at detection time, and never mutated. The
renderer and input parser each receive a copy at construction.

**Dynamic capabilities** are discovered at runtime through the probe. The
terminal's responses arrive on the input stream, where the input parser
recognizes them and emits `CapabilityEvent` values alongside keys and mouse
events. The host loop routes these events to `term.update()`, which folds them
into the renderer's `RuntimeCapabilities` and returns any bytes to write
immediately.

### 4.2 Data flow

```
terminfo file bytes ──▶ terminfo_parse() ─▶ Capabilities (frozen)
                                                  │
                         ┌────────────────────────┤
                         ▼                        ▼
                    createInput()           createTerm()
                         │                        │
probe bytes ──▶ terminal ──▶ stdin                │
                    scan() ─▶ CapabilityEvent ─▶ update() ─▶ Uint8Array (write now)
                                                  │
                                           RuntimeCapabilities
```

- `detectTerminal()` parses raw bytes into `Capabilities`. It performs no IO.
- The input parser is the only source of `CapabilityEvent` values. It writes
  nothing; it emits.
- The renderer holds its own private capability state. `update()` is the only
  path that changes it.
- The renderer and the input parser share no memory and hold no reference to
  each other. The host loop is the only place they meet.

### 4.3 Standalone operation

`createTerm` and `createInput` remain usable without a `Detection`. When no
`detection` option is provided, each factory initializes from the §7.1 baseline.
Behavior is identical to a `Detection` with no terminfo bytes, no environment
evidence, and no probe responses.

---

## 5. Core invariants

_This section is normative._

**TINV-1. Frozen static capabilities.** `Capabilities` is frozen after
`detectTerminal` returns. Neither the renderer nor the input parser may mutate
it.

**TINV-2. Pure parsing.** `terminfo_parse` performs no IO, allocates no memory,
and never traps on malformed input. Input larger than 32 768 bytes is rejected
at the TypeScript boundary. Malformed or truncated binaries yield the §7.1
baseline and a nonzero parse-result code. They MUST NOT partially apply.

**TINV-3. Progressive enhancement.** The capability layer starts from the
conservative §7.1 baseline and raises a capability only on positive evidence.
Evidence sources, in increasing precedence: the baseline, the terminfo entry,
environment evidence collected at detection (e.g. `COLORTERM`), and probe
responses. A capability no evidence supports keeps its baseline value.
Higher-precedence evidence overrides lower-precedence evidence in both
directions: a probe denial overrides a statically-set capability.

**TINV-4. Sans-IO probe.** `Detection.probe` is a `Uint8Array` produced by
`detectTerminal()` without touching any stream. The host writes the bytes.
`detectTerminal()` resolves — never rejects — on timeout, non-TTY streams, a
missing terminfo file, or abort.

**TINV-5. Immediate update output.** `term.update()` returns a `Uint8Array` of
bytes to write now. It MUST NOT defer output to the next `render()` call. An
empty array is a valid return when the update changes no rendered state.

**TINV-6. Event-only probe surface.** The input parser MUST NOT write to any
shared state when it recognizes a probe response. It surfaces the result as a
`CapabilityEvent` in the `scan()` return value. The host loop is responsible for
routing the event to `term.update()`.

---

## 6. Capability types

_This section is normative for the shapes and field semantics._

### 6.1 `Capabilities` — static fields

```ts
interface Capabilities {
  readonly colors: number;
  readonly trueColor: boolean;
  readonly bce: boolean;
  readonly autoMargin: boolean;
  readonly xenl: boolean;
  readonly altScreen: boolean;
  readonly styledUnderline: boolean;
}
```

| Field             | Source                                                              |
| ----------------- | ------------------------------------------------------------------- |
| `colors`          | `max_colors` from terminfo; 256 at baseline                         |
| `trueColor`       | `RGB`/`Tc` extended caps; `COLORTERM` env evidence; probe overrides |
| `bce`             | `bce` boolean cap                                                   |
| `autoMargin`      | `am` boolean cap                                                    |
| `xenl`            | `xenl` boolean cap                                                  |
| `altScreen`       | `smcup` string present                                              |
| `styledUnderline` | `Su` boolean or `Smulx` string                                      |

Key sequences (`key_*` capabilities) are not stored here. The input parser reads
them directly from the raw terminfo bytes in `Detection.keys` at initialization
time.

### 6.2 `ColorDepth`

```ts
type ColorDepth = "truecolor" | "256" | "16";
```

`ColorDepth` expresses the terminal's confirmed color rendering tier. It is the
value type for `key: "colordepth"` `CapabilityEvent` values.

### 6.3 `CapabilityEvent` — dynamic fields

```ts
type CapabilityEvent =
  | {
    readonly type: "capability";
    readonly key: "foreground-color";
    readonly value: Rgb;
  }
  | {
    readonly type: "capability";
    readonly key: "background-color";
    readonly value: Rgb;
  }
  | {
    readonly type: "capability";
    readonly key: "cursor-color";
    readonly value: Rgb;
  }
  | {
    readonly type: "capability";
    readonly key: "colordepth";
    readonly value: ColorDepth;
  }
  | {
    readonly type: "capability";
    readonly key: "sync-output";
    readonly value: boolean;
  }
  | {
    readonly type: "capability";
    readonly key: "kitty-keyboard";
    readonly value: boolean;
  }
  | {
    readonly type: "capability";
    readonly key: "kitty-graphics";
    readonly value: boolean;
  }
  | {
    readonly type: "capability";
    readonly key: "pointer-shape";
    readonly value: boolean;
  };
```

Each variant maps to one probe query. The `key` identifies the capability; the
`value` is the terminal's answer. Capability references per
[terminfo.dev](https://terminfo.dev):

| `key`              | Query                | terminfo.dev slug                                         |
| ------------------ | -------------------- | --------------------------------------------------------- |
| `foreground-color` | OSC 10               | [`osc-10-fg-color-query`](https://terminfo.dev)           |
| `background-color` | OSC 11               | [`osc-11-bg-color-query`](https://terminfo.dev)           |
| `cursor-color`     | OSC 12 or OSC 21     | [`osc-12-cursor-color`](https://terminfo.dev)             |
| `colordepth`       | XTGETTCAP `RGB`/`Tc` | [`24-bit-truecolor`](https://terminfo.dev)                |
| `sync-output`      | DECRPM mode 2026     | [`decset-2026-synchronized-output`](https://terminfo.dev) |
| `kitty-keyboard`   | `CSI ? u`            | [`kitty-keyboard-protocol`](https://terminfo.dev)         |
| `kitty-graphics`   | APC `_G…`            | [`kitty-graphics-protocol`](https://terminfo.dev)         |
| `pointer-shape`    | OSC 22               | [`osc-22-pointer-shape`](https://terminfo.dev)            |

**Color values.** `Rgb` values in probe responses MUST be recognized in at least
the `rgb:RR/GG/BB` (1–4 hex digits per channel) and `#`-hash forms.

**`colordepth` denial.** When XTGETTCAP replies with an invalid-capability
response for both `RGB` and `Tc`, the parser emits
`{ key: "colordepth", value:
D }` where `D` is derived from the static
`Capabilities.colors` field: `"16"` when `colors <= 16`, `"256"` otherwise. This
preserves TINV-3: the probe response takes precedence over static evidence,
including in the negative direction.

**OSC 21.** An OSC 21 reply may supply any subset of `foreground-color`,
`background-color`, and `cursor-color`. The parser emits one `CapabilityEvent`
per field the reply carries. OSC 21 arriving alongside OSC 10/11/12 replies does
not merge; each response yields its own event.

**OSC 22.** An OSC 22 reply sets `key: "pointer-shape", value: true`. The shape
name in the reply is discarded in v1; only protocol support is recorded.

**DA1.** The DA1 reply is recognized internally as the probe fence and MUST NOT
surface as a `CapabilityEvent`.

### 6.4 `RuntimeCapabilities` — merged view

```ts
interface RuntimeCapabilities extends Capabilities {
  readonly syncOutput: boolean;
  readonly kittyKeyboard: boolean;
  readonly kittyGraphics: boolean;
  readonly pointerShape: boolean;
  readonly theme: {
    readonly foreground?: Rgb;
    readonly background?: Rgb;
    readonly cursor?: Rgb;
  };
}
```

`RuntimeCapabilities` is the renderer's current merged view: the static
`Capabilities` fields plus all `CapabilityEvent` values folded in so far. The
`trueColor` field reflects the latest evidence at any precedence level; a
`colordepth` probe event overrides the static value. `RuntimeCapabilities` is
exposed as `term.capabilities` and is a frozen snapshot at the moment of access.

---

## 7. Baseline and environment evidence

_This section is normative._

### 7.1 Baseline

With no terminfo bytes, no environment evidence, and no probe responses,
`Capabilities` is initialized to:

| Field             | Default |
| ----------------- | ------- |
| `colors`          | 256     |
| `trueColor`       | `false` |
| `bce`             | `true`  |
| `autoMargin`      | `true`  |
| `xenl`            | `true`  |
| `altScreen`       | `true`  |
| `styledUnderline` | `false` |

Truecolor is not assumed at baseline. Per TINV-3, it requires positive evidence.

### 7.2 Environment evidence

`detectTerminal()` applies environment evidence after parsing the terminfo
entry:

- `COLORTERM` equal to `truecolor` or `24bit` sets `trueColor: true`.

Environment evidence outranks the terminfo entry and is outranked by probe
responses (TINV-3).

---

## 8. Terminfo binary parsing

_This section is normative._

`terminfo_parse(bytes, len, out)` accepts a compiled terminfo entry and
populates a `Capabilities`-shaped struct.

- Both storage formats MUST be supported: legacy (magic `0432`, 16-bit numbers)
  and extended number format (magic `01036`, 32-bit numbers).
- The extended-capability string table MUST be parsed for the user-defined
  capabilities `RGB`, `Tc`, `Su`, and `Smulx`.
- All reads are bounds-checked against `len`. Out-of-range offsets, truncated
  sections, and odd-length string tables yield the parse failure path (TINV-2).
- The maximum accepted size is 32 768 bytes, the extended ncurses format limit.
  The TypeScript boundary enforces this before bytes reach the parser.

Standard capability indices consumed: booleans `am` (1), `xenl` (4), `bce` (28);
number `max_colors` (13); strings `smcup` (28) and the `key_*` range (see Input
Specification §6.1 for the key set).

---

## 9. The probe

### 9.1 Query batch

_This section is normative._

`Detection.probe` contains the following queries as one `Uint8Array`, in order:

| #  | Query               | Bytes                                                | `CapabilityEvent` key |
| -- | ------------------- | ---------------------------------------------------- | --------------------- |
| 1  | Foreground color    | `OSC 10 ; ? BEL`                                     | `foreground-color`    |
| 2  | Background color    | `OSC 11 ; ? BEL`                                     | `background-color`    |
| 3  | Cursor color        | `OSC 12 ; ? BEL`                                     | `cursor-color`        |
| 4  | Kitty color         | `OSC 21 ; foreground=? ; background=? ; cursor=? ST` | (per field, see §6.3) |
| 5  | Pointer shape       | `OSC 22 ; ?__current__ ST`                           | `pointer-shape`       |
| 6  | Truecolor caps      | `DCS + q 524742 ; 5463 ST` (XTGETTCAP `RGB;Tc`)      | `colordepth`          |
| 7  | Synchronized output | `CSI ? 2026 $ p` (DECRQM)                            | `sync-output`         |
| 8  | Kitty keyboard      | `CSI ? u`                                            | `kitty-keyboard`      |
| 9  | Kitty graphics      | `APC _G i=31,s=1,v=1,a=q,t=d,f=24 ; AAAA ST`         | `kitty-graphics`      |
| 10 | **Fence:** DA1      | `CSI c`                                              | (internal only)       |

Terminals answer queries in order and ignore queries they do not understand. DA1
is answered by every terminal, so its response marks the probe complete. Any of
queries 1–9 not yet answered when the DA1 reply arrives will never be answered,
and the renderer keeps their current values.

The batch is safe to emit unconditionally: every query is either answered or
ignored; none changes terminal state.

### 9.2 Response path

Probe responses arrive on the terminal's input stream, potentially interleaved
with user input. The input parser recognizes and consumes them during its normal
`scan()` (see Input Specification §6.2). Each recognized response produces one
or more `CapabilityEvent` values in the `scan()` result, interleaved with key
and mouse events in arrival order. The host loop routes them to `term.update()`.

### 9.3 Capability change over time

A capability event can arrive after the renderer has already emitted frames.
`term.update()` folds it into the runtime snapshot. Any renderer-side output
invalidation or immediate bytes are defined by the focused feature specification
that consumes that capability.

---

## 10. Public API

_This section is normative for the shapes shown._

### 10.1 `detectTerminal`

```ts
function detectTerminal(options?: DetectOptions): Promise<Detection>;

interface DetectOptions {
  term?: string;
  env?: Record<string, string | undefined>;
  terminfo?: Uint8Array;
  signal?: AbortSignal;
}

interface Detection {
  readonly capabilities: Capabilities;
  /**
   * Write to stdout immediately after detection. Responses arrive as
   * CapabilityEvent values in input.scan().
   */
  readonly probe: Uint8Array;
  /** Raw terminfo key bytes. The input parser loads its trie from this. Opaque to callers. */
  readonly keys: KeyTable;
}

type KeyTable = Uint8Array;
```

`detectTerminal()`:

1. Locates and reads the compiled terminfo entry for the terminal (unless raw
   bytes are provided via `terminfo`), following the ncurses search path:
   `$TERMINFO`, `$HOME/.terminfo`, `$TERMINFO_DIRS` (empty entry = compiled-in
   defaults), then `/usr/share/terminfo`, `/etc/terminfo`, `/lib/terminfo`,
   `/usr/lib/terminfo`. Both directory layouts are probed: first-letter (Linux)
   and two-hex-digit (macOS). Names with path separators, NUL, or a leading `.`
   are rejected. Files are validated by magic number.
2. Parses the bytes into `Capabilities` and extracts key-sequence bytes into
   `keys`.
3. Applies environment evidence (§7.2) from the injectable `env`.
4. Constructs `probe` without performing any IO.
5. Resolves the `Detection`. It never rejects.

Every environmental dependency is injectable (`env`, `terminfo`), making the
function fully testable without a TTY or real terminfo files.

### 10.2 `createTerm`

```ts
function createTerm(options: {
  width: number;
  height: number;
  detection?: Detection;
}): Promise<Term>;
```

When `detection` is provided, the renderer initializes its private
`RuntimeCapabilities` from `detection.capabilities` and `RuntimeCapabilities`
dynamic fields at their baseline values. When omitted, the renderer uses the
§7.1 baseline for all fields.

### 10.3 `createInput`

```ts
function createInput(options?: {
  escLatency?: number;
  detection?: Detection;
}): Promise<Input>;
```

When `detection` is provided, the parser loads its key trie from
`detection.keys`. When omitted, the parser uses built-in xterm key sequences.

### 10.4 `applyUpdate`

```ts
function applyUpdate(
  current: RuntimeCapabilities,
  change: Update,
): { readonly next: RuntimeCapabilities; readonly bytes: Uint8Array };

type Update =
  | { width: number; height: number }
  | CapabilityEvent;
```

`applyUpdate` is a pure function. Given the current `RuntimeCapabilities` and
one `Update`, it returns the next `RuntimeCapabilities` and any bytes defined by
the consuming feature. The foundation returns an empty byte array;
`term.update()` is a loop over `applyUpdate`. Exporting the reducer allows tests
to assert `(next, bytes)` against literal values without a live `Term`.

### 10.5 `Term.update`

```ts
interface Term {
  render(ops: Op[], options?: RenderOptions): RenderResult;
  update(change: Update | readonly Update[]): Uint8Array;
  readonly capabilities: RuntimeCapabilities;
}
```

`update()` accepts one change or a batch. A batch is folded in order; the
returned bytes are concatenated. The return value is always a `Uint8Array`;
callers write it to their output stream when non-empty (TINV-5).

`term.capabilities` is a frozen snapshot of the current `RuntimeCapabilities`.

### 10.6 Host loop

```ts
import { detectTerminal } from "./terminfo.ts";
import { createTerm } from "./term.ts";
import { createInput } from "./input.ts";

const detection = await detectTerminal({ env: process.env });
const term = await createTerm({ width: 80, height: 24, detection });
const input = await createInput({ detection });

process.stdout.write(detection.probe);

process.stdin.on("data", (bytes: Uint8Array) => {
  const { events } = input.scan(bytes);
  for (const event of events) {
    switch (event.type) {
      case "capability":
      case "resize": {
        const out = term.update(event);
        if (out.length) process.stdout.write(out);
        break;
      }
      default:
        dispatch(event);
    }
  }
});

process.on("SIGWINCH", () => {
  const out = term.update({ width: cols(), height: rows() });
  if (out.length) process.stdout.write(out);
});
```

`createTerm` and `createInput` each take `detection` and build their own private
state from it. Passing the same `Detection` to both passes the same plain value
twice. There is no shared memory and no attachment guard.

---

## 11. Deferred / future areas

_Non-normative._

**OSC 4 palette queries.** The 256-entry palette is not probed; the theme group
covers foreground, background, and cursor (OSC 10/11/12) only.

**Theme-change notification (mode 2031).** The probe captures a snapshot; live
dark/light switching is not tracked.

**XTVERSION / DA2 / DA3 identity parsing.** The DA1 reply is used purely as a
fence; terminal identification is not extracted.

**Re-probing after suspend/resume.** `Detection.probe` may be written again by
the host at any time; responses arrive as events as normal. The spec does not
define a managed re-probe lifecycle.

**Pixel mouse (1016) and in-band resize (2048) probing.** Candidates for the
batch once consumers exist.

**terminfo string emission (`sgr`, `cup` from terminfo).** The renderer
continues to emit hardcoded ANSI; terminfo strings inform input parsing only.

---

## Open decisions

1. **What detects OSC 8 hyperlinks?** The
   [OSC 8 specification](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda)
   states no detection mechanism exists and the sequence degrades gracefully on
   unsupported terminals. Candidate sources: an extended user-capability
   convention, terminal identity heuristics from DA2/XTVERSION (currently
   unparsed), or treating OSC 8 as permanently ignore-safe.

2. **Should per-shape pointer support be probed?** The kitty pointer shape
   protocol's `?name,name,…` query reports support for individual shape names.
   v1 records protocol support only; a shape-vocabulary field would let the
   renderer pick portable shape names.

3. **`colordepth` values beyond `"truecolor" | "256" | "16"`.** The three-tier
   union covers every value XTGETTCAP can produce. Extend it only if a new probe
   source can deliver finer granularity.
