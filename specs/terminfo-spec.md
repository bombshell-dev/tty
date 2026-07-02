# Clayterm Terminfo & Capability Specification

**Version:** 0.1 (draft) **Status:** Proposed. Normative for the shared
capability layer.

---

## 1. Purpose

This specification defines Clayterm's terminal capability layer: how static
capability data (compiled terminfo binaries) and runtime capability data
(query/response handshakes such as OSC color queries and DA1) are parsed into a
single shared capability struct, and how the renderer and the input parser
consume it.

The capability layer exists to answer one question for both consumers: **what
can this terminal do?** The renderer uses the answer to gate what it emits
(color encoding, erase strategy, synchronized-output frame wrapping). The input
parser uses the answer's raw material (terminal-specific key sequences) and is
the write path through which runtime query responses reach the struct.

---

## 2. Scope

### In scope (normative)

- The `TermInfo` capability struct: its field set, mutation rules, and the
  generation counter
- The shared-memory region model and its build constraints
- Compiled terminfo binary parsing (legacy and extended formats)
- The probe model: query batch, completion fence, and sans-IO contract
- The public API: `queryTermInfo()`, the `TermInfo` handle, and how the handle
  is passed to `createTerm` and `createInput`
- The baseline capability set and the progressive-enhancement evidence model

### Out of scope

- How the renderer maps capabilities to emitted bytes (see
  [Renderer Specification](renderer-spec.md) §7.6)
- How the input parser recognizes query responses byte-by-byte (see
  [Input Specification](input-spec.md) §6)
- Caller-layer mode management (alt screen, kitty push/pop, mouse enable) —
  capabilities inform these decisions but do not perform them

---

## 3. Terminology

**Capability struct (`TermInfo` struct).** A fixed-layout C struct holding the
resolved capability state of one terminal. Lives at a stable pointer for the
lifetime of the handle that owns it.

**Terminfo region.** A reserved range of linear memory holding the raw compiled
terminfo bytes and the capability struct.

**Handle (`TermInfo`).** The TypeScript object returned by `queryTermInfo()`.
Owns the shared `WebAssembly.Memory`, the terminfo region, and the pointer to
the capability struct. Passed to `createTerm` and `createInput` to attach them
to the same struct.

**Probe.** A batch of terminal query sequences emitted as bytes, whose responses
arrive on the input stream and are folded back into the capability struct.

**Fence.** The final query in a probe batch, chosen because every terminal
answers it. Its response marks the probe as complete. This specification uses
DA1 (`CSI c`) as the fence.

**Generation.** A monotonic counter on the capability struct, incremented on
every mutation. Consumers compare generations to detect capability change.

---

## 4. Architectural Model

### 4.1 One memory, three tenants

When a `TermInfo` handle is in use, a single `WebAssembly.Memory` is shared by
up to three tenants:

1. The **terminfo region** — raw bytes plus the capability struct, owned by the
   handle.
2. The **renderer instance** — heap and transfer buffers for `createTerm`.
3. The **input parser instance** — heap and scan buffer for `createInput`.

The handle owns the memory and allocates disjoint regions to each tenant. Both
WASM instances import the shared memory (`env.memory`) and receive their region
pointers explicitly, as they do today via `init(mem, …)` and
`input_init(mem, …)`. Each additionally receives the capability struct pointer.

### 4.2 Data flow

```
terminfo file bytes ──▶ terminfo_parse() ──▶ ┌───────────────┐
                                             │ TermInfo      │ ◀── reads ── renderer
probe bytes ──▶ terminal ──▶ stdin ──▶       │ struct        │
                input_scan() ── writes ────▶ │ (+generation) │ ◀── reads ── TS capabilities view
                                             └───────────────┘
```

- The **terminfo module** (`terminfo.c`) parses the raw bytes into the struct.
  It performs no IO.
- The **input parser** is the only runtime writer: when it recognizes a query
  response during a normal scan, it updates the struct and bumps the generation.
- The **renderer** only reads the struct, at render-transaction time.
- The **TypeScript layer** reads the struct through the handle's `capabilities`
  view. It writes only at handle creation: `terminfo_parse` plus environment
  evidence (§7.2).

The renderer and the input parser never communicate with each other. Both depend
on the terminfo layer, exactly as both depend on shared substrate modules today
(`mem.c`, `utf8.c`). This preserves the independence invariant (Renderer
Specification INV-7).

### 4.3 Standalone operation

`createTerm` and `createInput` remain usable without a handle. When no
`terminfo` option is provided, each factory creates its own private memory (as
today) containing a private capability struct initialized to the §7.1 baseline.
Behavior is identical to a handle with no terminfo bytes, no environment
evidence, and no probe responses.

---

## 5. Core Invariants

_This section is normative._

**TINV-1. Single source of truth.** All capability state lives in the capability
struct. Neither the renderer nor the input parser may cache capability values
across frames/scans in a way that survives a generation change.

**TINV-2. Monotonic generation.** Every mutation of the capability struct MUST
increment the generation counter exactly once per logical update. The counter
never decreases. A consumer that observes an unchanged generation MAY assume
every other field is unchanged.

**TINV-3. Pure parsing.** `terminfo_parse` performs no IO, allocates no memory,
and never traps on malformed input. Input larger than 32768 bytes is rejected at
the TypeScript boundary. Malformed or truncated binaries yield the §7.1 baseline
and a nonzero parse-result code; they MUST NOT partially apply.

**TINV-4. Single runtime writer.** Capability writes happen at handle creation
(terminfo parse plus environment evidence, §7) and thereafter only through the
input parser recognizing query responses. The renderer MUST NOT write the
struct. The TypeScript layer MUST NOT write it after creation.

**TINV-5. Progressive enhancement.** The capability layer starts from a
conservative baseline owned by the terminfo module — the built-in equivalent of
`xterm-256color` (§7) — and raises a capability only on positive evidence.
Evidence sources, in increasing precedence: the baseline, the terminfo entry,
environment evidence collected at handle creation (e.g. `COLORTERM`), and probe
responses. A capability bit no evidence supports stays unset; a
higher-precedence denial clears a lower-precedence grant. Consumers MUST NOT
assume capabilities beyond what the struct states.

**TINV-6. Sans-IO probe.** The probe core produces bytes (`probe()`) and
consumes bytes (via the input parser's scan path). It never touches a stream.
The convenience wrapper (`queryTermInfo`) performs IO but MUST resolve — never
reject — on timeout, non-TTY streams, missing terminfo files, or abort.

**TINV-7. Disjoint static footprints.** Any two WASM modules that import the
same memory MUST be linked with disjoint static data/heap base ranges (e.g.
coordinated `--global-base`) so that instantiating one cannot clobber the
other's data segments. Under the current single-module build this is trivially
satisfied; a split-module build (layout/input) MUST enforce it in the Makefile.

---

## 6. The Capability Struct

_This section is normative for the field set and semantics. Exact byte offsets
are defined by `terminfo.h` and mirrored in TypeScript via `typedef.ts`; they
are implementation surface, not contract._

| Field          | Type   | Meaning                                                        |
| -------------- | ------ | -------------------------------------------------------------- |
| `generation`   | uint32 | Mutation counter (TINV-2). Starts at 1 after initialization.   |
| `colors`       | uint32 | `max_colors` from terminfo; 0 when unknown.                    |
| `flags`        | uint32 | Bitfield of `TERMINFO_*` capability bits (below).              |
| `confirmed`    | uint32 | Subset of `flags` bits confirmed or denied by probe responses. |
| `theme_fg`     | uint32 | Theme foreground as `0x00RRGGBB`; valid bit in `flags`.        |
| `theme_bg`     | uint32 | Theme background as `0x00RRGGBB`; valid bit in `flags`.        |
| `theme_cursor` | uint32 | Theme cursor color as `0x00RRGGBB`; valid bit in `flags`.      |

The three `theme_*` fields form the **theme group**, surfaced in TypeScript as a
single `theme` object (§10.2).

Flag bits:

| Bit                         | Source (static)                                                         | Source (probe)              |
| --------------------------- | ----------------------------------------------------------------------- | --------------------------- |
| `TERMINFO_TRUECOLOR`        | `RGB`/`Tc` extended caps, or `colors` ≥ 1<<24; `COLORTERM` env evidence | XTGETTCAP `RGB`/`Tc` reply  |
| `TERMINFO_BCE`              | `bce` boolean                                                           | —                           |
| `TERMINFO_AM`               | `am` boolean                                                            | —                           |
| `TERMINFO_XENL`             | `xenl` boolean                                                          | —                           |
| `TERMINFO_ALTSCREEN`        | `smcup` string present                                                  | —                           |
| `TERMINFO_STYLED_UNDERLINE` | `Su` boolean / `Smulx` string                                           | —                           |
| `TERMINFO_SYNC`             | —                                                                       | DECRPM reply for mode 2026  |
| `TERMINFO_KITTY_KEYBOARD`   | —                                                                       | `CSI ? flags u` reply       |
| `TERMINFO_KITTY_GRAPHICS`   | —                                                                       | APC `_G…` reply             |
| `TERMINFO_KITTY_COLOR`      | —                                                                       | OSC 21 reply                |
| `TERMINFO_HYPERLINKS`       | reserved (Open Decision 4)                                              | reserved (Open Decision 4)  |
| `TERMINFO_POINTER_SHAPE`    | —                                                                       | OSC 22 `?__current__` reply |
| `TERMINFO_THEME_FG`         | —                                                                       | OSC 10 or OSC 21 reply      |
| `TERMINFO_THEME_BG`         | —                                                                       | OSC 11 or OSC 21 reply      |
| `TERMINFO_THEME_CURSOR`     | —                                                                       | OSC 12 or OSC 21 reply      |

Evidence precedence follows TINV-5: when a bit is set in `confirmed`, the
corresponding `flags` bit reflects the terminal's answer, not the terminfo file
or environment. A denial (e.g. XTGETTCAP invalid-capability reply) clears a
statically-set bit.

`TERMINFO_POINTER_SHAPE` (OSC 22) is detected via the
[kitty pointer shape protocol](https://sw.kovidgoyal.net/kitty/pointer-shapes/)
query `OSC 22 ; ?__current__ ST`: supporting terminals reply with the current
shape name; non-supporting terminals stay silent and the DA1 fence closes the
question. Note the flag records _protocol_ support only — shape-name
vocabularies vary by terminal (kitty and Ghostty use CSS names, xterm uses X11
names); per-shape support can be refined later via the protocol's `?name,name,…`
query form (deferred).

`TERMINFO_HYPERLINKS` (OSC 8) is allocated because a consumer is planned (#67),
but the
[OSC 8 specification](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda)
is explicit that no detection mechanism exists — see Open Decision 4. Until a
source is settled the bit stays unset. OSC 8 is ignore-safe by ECMA-48 parsing
rules: unsupported terminals render the link text without artifacts, so
consumers MAY emit it without capability confirmation.

Key sequence strings (`key_*` capabilities) are **not** stored in the struct.
The input parser reads them directly from the raw terminfo bytes in the terminfo
region at initialization time (see Input Specification §6.1). The struct carries
resolved _facts_; the raw region carries _material_.

---

## 7. Baseline and Environment Evidence

_This section is normative._

### 7.1 Baseline

The terminfo module owns the baseline: the built-in equivalent of the
`xterm-256color` terminfo entry. With no terminfo bytes, no environment
evidence, and no probe responses, the struct is initialized to:

| Field       | Default                          |
| ----------- | -------------------------------- |
| `colors`    | 256                              |
| `flags`     | `AM \| XENL \| ALTSCREEN \| BCE` |
| `confirmed` | 0                                |
| `theme_*`   | 0 (invalid; theme unknown)       |

Truecolor is **not** assumed at baseline. Per TINV-5 it is enhanced in by
evidence: `RGB`/`Tc` in the terminfo entry, `COLORTERM` in the environment, or
an XTGETTCAP probe reply. This supersedes the renderer's historical
unconditional truecolor emission — a Term with no capability evidence emits
256-color SGR (Renderer Specification §7.6).

### 7.2 Environment evidence

At handle creation, `queryTermInfo` applies evidence from the (injectable)
environment after parsing the terminfo entry and before the probe:

- `COLORTERM` equal to `truecolor` or `24bit` sets `TERMINFO_TRUECOLOR`.

Environment evidence outranks the terminfo entry and is outranked by probe
responses (TINV-5).

---

## 8. Terminfo Binary Parsing

_This section is normative._

`terminfo_parse(bytes, len, out)` accepts a compiled terminfo entry and
populates the capability struct.

- Both storage formats MUST be supported: legacy (magic `0432`, 16-bit numbers)
  and extended number format (magic `01036`, 32-bit numbers).
- The extended-capability string table (the ncurses extension block after the
  standard sections) MUST be parsed for the user-defined capabilities `RGB`,
  `Tc`, `Su`, and `Smulx`.
- Parsing is bounds-checked against `len` everywhere. Out-of-range string
  offsets, truncated sections, and odd-length string tables yield the parse
  failure path (TINV-3), never a trap or partial state.
- The maximum accepted size is 32768 bytes (`MAX_TERMINFO`), the extended
  ncurses format limit. The TypeScript boundary enforces this before the bytes
  reach linear memory.

The standard capability indices consumed are: booleans `am` (1), `xenl` (4),
`bce` (28); number `max_colors` (13); strings `smcup` (28) and the `key_*` range
(see Input Specification §6.1 for the key set).

---

## 9. The Probe

### 9.1 Query batch

_This section is normative._

`terminfo.probe()` returns the following queries as one `Uint8Array`, in order:

| #  | Query               | Bytes                                                | Answered by           |
| -- | ------------------- | ---------------------------------------------------- | --------------------- |
| 1  | Foreground color    | `OSC 10 ; ? BEL`                                     | OSC 10 reply          |
| 2  | Background color    | `OSC 11 ; ? BEL`                                     | OSC 11 reply          |
| 3  | Cursor color        | `OSC 12 ; ? BEL`                                     | OSC 12 reply          |
| 4  | Kitty color         | `OSC 21 ; foreground=? ; background=? ; cursor=? ST` | OSC 21 reply          |
| 5  | Pointer shape       | `OSC 22 ; ?__current__ ST`                           | OSC 22 reply          |
| 6  | Truecolor caps      | `DCS + q 524742 ; 5463 ST` (XTGETTCAP `RGB;Tc`)      | DCS `1 + r` / `0 + r` |
| 7  | Synchronized output | `CSI ? 2026 $ p` (DECRQM)                            | `CSI ? 2026 ; Ps $ y` |
| 8  | Kitty keyboard      | `CSI ? u`                                            | `CSI ? flags u`       |
| 9  | Kitty graphics      | `APC _G i=31,s=1,v=1,a=q,t=d,f=24 ; AAAA ST`         | APC `_Gi=31;…` reply  |
| 10 | **Fence:** DA1      | `CSI c`                                              | `CSI ? … c`           |

Terminals answer queries in order and ignore queries they do not understand. DA1
is answered by every terminal, so its response marks the probe complete: any of
queries 1–9 not yet answered when the DA1 reply arrives will never be answered,
and their capabilities keep their static/default values.

An [OSC 21](https://sw.kovidgoyal.net/kitty/color-stack/) reply echoes the
queried keys with `?` replaced by the encoded color (or empty when undefined);
it sets `TERMINFO_KITTY_COLOR` and MAY fill any theme fields it carries. The OSC
10/11/12 replies remain the portable theme source. Color values in OSC replies
MUST be recognized in at least the `rgb:RR/GG/BB` (1–4 hex digits per channel)
and `#`-hash forms; other encodings (`rgbi:`, named colors, `@alpha` suffixes)
MAY be ignored. An [OSC 22](https://sw.kovidgoyal.net/kitty/pointer-shapes/)
reply carries the current shape name; the reply's arrival sets
`TERMINFO_POINTER_SHAPE` and the name itself is discarded in v1.

The batch is safe to emit unconditionally: every query is either answered or
ignored; none changes terminal state.

### 9.2 Response path

Probe responses arrive on the terminal's input stream, potentially interleaved
with user input. They are recognized and consumed by the input parser during its
normal `scan()` (see Input Specification §6.2). Each recognized response updates
the capability struct, sets the relevant `confirmed` bit, and bumps the
generation. Responses are consumed silently; they do not surface as
`InputEvent`s in v1.

A render-only consumer (no `createInput`) that wants probe results MUST route
its input stream through the handle's input parser during the probe window;
`queryTermInfo` does exactly this internally.

### 9.3 Capability change over time

Capabilities may change after first use — a probe response can arrive after a
frame has already rendered. The generation counter is the mechanism: the
renderer compares the struct generation on each render transaction and
invalidates its diff state when it changed (Renderer Specification §7.6). No
consumer ceremony is required.

---

## 10. Public API

_This section is normative for the shapes shown. Option names follow the
existing codebase conventions._

### 10.1 queryTermInfo

```
queryTermInfo(options?: QueryTermInfoOptions): Promise<TermInfo>
```

The single blessed entry point. It:

1. Locates and reads the compiled terminfo entry for the terminal (unless raw
   bytes are provided), following the ncurses search path: `$TERMINFO`,
   `$HOME/.terminfo`, `$TERMINFO_DIRS` (empty entry = compiled-in defaults),
   then `/usr/share/terminfo`, `/etc/terminfo`, `/lib/terminfo`,
   `/usr/lib/terminfo`. Both directory layouts are probed: first-letter (Linux)
   and two-hex-digit (macOS). Names containing path separators, NUL, or a
   leading `.` are rejected. Files are validated by magic number.
2. Creates the shared memory, terminfo region, and capability struct; parses the
   bytes.
3. Applies environment evidence (§7.2) from the injectable `env`.
4. When `input` and `output` are TTYs: writes the probe batch to `output` and
   feeds `input` through the handle's parser until the DA1 fence or timeout. Raw
   mode is enabled for the probe window and restored afterward.
5. Resolves the handle.

```
interface QueryTermInfoOptions {
  term?: string;                    // terminal name; default env.TERM
  env?: Record<string, string | undefined>; // default process.env
  terminfo?: Uint8Array;            // raw bytes; skips filesystem lookup
  input?: ReadStream;               // default process.stdin
  output?: WriteStream;             // default process.stdout
  timeout?: number;                 // ms until probe abandonment; default 100
  signal?: AbortSignal;
}
```

Every environmental dependency is injectable (`env`, `terminfo`, `input`,
`output`), making the function fully mockable without a PTY. Per TINV-6 it
resolves — never rejects — when the terminfo file is missing, the streams are
not TTYs, the probe times out, or the signal aborts; the handle then carries
whatever subset of capabilities was resolved.

### 10.2 The TermInfo handle

```
interface TermInfo {
  readonly capabilities: Capabilities; // decoded live view of the struct
  probe(): Uint8Array;                 // the §9.1 query batch (sans-IO)
}
```

`capabilities` decodes the struct on read (cheap; a handful of field reads) so
it always reflects the current generation:

```
interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Capabilities {
  generation: number;
  colors: number;
  trueColor: boolean;
  bce: boolean;
  autoMargin: boolean;
  altScreen: boolean;
  styledUnderline: boolean;
  syncOutput: boolean;
  kittyKeyboard: boolean;
  kittyGraphics: boolean;
  kittyColor: boolean;
  hyperlinks: boolean;    // reserved; no detection source exists (Open Decision 4)
  pointerShape: boolean;  // kitty OSC 22 protocol support
  theme: {
    foreground?: Rgb; // OSC 10
    background?: Rgb; // OSC 11
    cursor?: Rgb;     // OSC 12
  };
}
```

The handle also carries the shared memory and region pointers as internal
(non-normative) surface consumed by `createTerm` and `createInput`.

### 10.3 Attachment

```
createTerm({ width, height, terminfo?: TermInfo }): Promise<Term>
createInput({ escLatency?, terminfo?: TermInfo }): Promise<Input>
```

Passing the same handle to both attaches them to the same memory and struct. A
handle MAY be attached to at most one `Term` and one `Input` at a time;
attaching a second is an error. Factories called without `terminfo` operate
standalone (§4.3).

The previous `terminfo?: Uint8Array` option on `createInput` is replaced by the
handle form. Raw bytes are provided via `queryTermInfo({ terminfo: bytes })`.

---

## 11. Deferred / Future Areas

_Non-normative. Intentional omissions._

**OSC 4 palette queries.** The 256-entry palette is not probed; the theme group
covers foreground, background, and cursor (OSC 10/11/12) only.

**Theme-change notification (mode 2031).** The probe captures a snapshot; live
dark/light switching is not tracked.

**XTVERSION / DA2 / DA3 identity parsing.** The DA1 reply is used purely as a
fence; terminal identification is not extracted.

**Surfacing capability changes as events.** Probe responses are consumed
silently. A `capabilitychange` input event or handle callback may be added once
a consumer needs reactivity beyond the generation counter.

**Pixel mouse (1016) and in-band resize (2048) probing.** Candidates for the
batch once consumers exist.

**terminfo string emission (`sgr`, `cup` from terminfo).** The renderer
continues to emit hardcoded ANSI; terminfo strings inform input parsing only.

---

## Open Decisions

1. **Should `capabilities` be an event emitter?** v1 is poll-only via
   `generation`. Reactive consumers may justify a subscription API.

2. **Where does the split-module `--global-base` coordination live?** TINV-7
   states the constraint; the mechanism (Makefile flags vs. a linker script) is
   a build-system decision for the PR that splits the modules.

3. **Should the probe be re-runnable?** `probe()` may be called any number of
   times, but `queryTermInfo` runs the managed probe exactly once. Re-probing
   after suspend/resume (terminal may have changed) is unaddressed.

4. **What detects OSC 8 hyperlinks?** The
   [OSC 8 specification](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda)
   states no detection mechanism exists, and the sequence degrades gracefully on
   unsupported terminals. Candidate sources: an extended user capability
   convention (none has settled), terminal identity heuristics from
   DA2/XTVERSION (currently unparsed, see Deferred), or treating OSC 8 as
   permanently ignore-safe and dropping the flag. The struct reserves the bit so
   consumers have a stable place to look once a source is chosen.

5. **Should per-shape pointer support be probed?** The kitty pointer shape
   protocol's `?name,name,…` query reports support for individual shape names.
   v1 records protocol support only; a shape-vocabulary field would let the
   renderer pick portable shape names.
