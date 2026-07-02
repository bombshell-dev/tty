/**
 * Terminal capability layer.
 *
 * Loads compiled terminfo binaries, probes the terminal with query
 * escape sequences, and resolves both into a single capability struct
 * shared (via one WebAssembly.Memory) with the renderer and the input
 * parser. See specs/terminfo-spec.md.
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";

import { compiled } from "./wasm.ts";
import { offsets, struct, uint32 } from "./typedef.ts";

/**
 * Compiled terminfo entries are limited to 4096 bytes (legacy) or 32768
 * bytes (extended ncurses format). We use the extended limit as our
 * upper bound. See https://man7.org/linux/man-pages/man5/term.5.html
 */
export const MAX_TERMINFO = 32768;

/* Flag bits — must match src/terminfo.h. */
const FLAG_TRUECOLOR = 1 << 0;
const FLAG_BCE = 1 << 1;
const FLAG_AM = 1 << 2;
const FLAG_ALTSCREEN = 1 << 4;
const FLAG_STYLED_UNDERLINE = 1 << 5;
const FLAG_SYNC = 1 << 6;
const FLAG_KITTY_KEYBOARD = 1 << 7;
const FLAG_KITTY_GRAPHICS = 1 << 8;
const FLAG_KITTY_COLOR = 1 << 9;
const FLAG_HYPERLINKS = 1 << 10;
const FLAG_POINTER_SHAPE = 1 << 11;
const FLAG_THEME_FG = 1 << 12;
const FLAG_THEME_BG = 1 << 13;
const FLAG_THEME_CURSOR = 1 << 14;
/* Probe-fence marker, set in `confirmed` when a DA1 report arrives. */
const FLAG_DA1 = 0x80000000;

const TermInfoStruct = struct({
  generation: uint32(),
  colors: uint32(),
  flags: uint32(),
  confirmed: uint32(),
  theme_fg: uint32(),
  theme_bg: uint32(),
  theme_cursor: uint32(),
});

const TI = offsets(TermInfoStruct);

/** 8-bit RGB, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Decoded live view of the capability struct. */
export interface Capabilities {
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
  hyperlinks: boolean;
  pointerShape: boolean;
  theme: {
    foreground?: Rgb;
    background?: Rgb;
    cursor?: Rgb;
  };
}

export interface TermInfo {
  /** Decoded live view of the capability struct. */
  readonly capabilities: Capabilities;
  /** The probe query batch, fenced by DA1 (sans-IO). */
  probe(): Uint8Array;
}

/** Minimal read-stream surface consumed by the probe (mockable). */
export interface ProbeInput {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?(raw: boolean): void;
  on(event: "data", cb: (chunk: Uint8Array) => void): unknown;
  off(event: "data", cb: (chunk: Uint8Array) => void): unknown;
  resume?(): void;
  pause?(): void;
  isPaused?(): boolean;
}

/** Minimal write-stream surface consumed by the probe (mockable). */
export interface ProbeOutput {
  isTTY?: boolean;
  write(bytes: Uint8Array): unknown;
}

export interface QueryTermInfoOptions {
  /** Terminal name to resolve. Defaults to env.TERM. */
  term?: string;
  /**
   * Environment for TERM / TERMINFO / TERMINFO_DIRS / HOME / COLORTERM
   * lookups. Defaults to process.env. Injectable for testing.
   */
  env?: Record<string, string | undefined>;
  /** Raw compiled terminfo bytes; skips the filesystem lookup. */
  terminfo?: Uint8Array;
  /** Read stream for probe responses. Default: process.stdin. */
  input?: ProbeInput;
  /** Write stream for probe queries. Default: process.stdout. */
  output?: ProbeOutput;
  /** Milliseconds before the probe is abandoned. Default: 100. */
  timeout?: number;
  signal?: AbortSignal;
}

const encoder = new TextEncoder();

/**
 * Probe query batch (terminfo-spec section 9.1): theme colors, kitty
 * color and pointer shape protocols, XTGETTCAP RGB;Tc, DECRQM 2026,
 * kitty keyboard and graphics — fenced by DA1, which every terminal
 * answers.
 */
const PROBE = encoder.encode(
  "\x1b]10;?\x07" +
    "\x1b]11;?\x07" +
    "\x1b]12;?\x07" +
    "\x1b]21;foreground=?;background=?;cursor=?\x1b\\" +
    "\x1b]22;?__current__\x1b\\" +
    "\x1bP+q524742;5463\x1b\\" +
    "\x1b[?2026$p" +
    "\x1b[?u" +
    "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\" +
    "\x1b[c",
);

interface TermInfoNative {
  memory: WebAssembly.Memory;
  /**
   * The handle's WASM instance exports. Attached consumers reuse this
   * instance rather than instantiating the module again: instantiation
   * rewrites the module's data segments, which would clobber the static
   * state of anything already initialized in the shared memory.
   */
  exports: Record<string, CallableFunction>;
  structPtr: number;
  bytesPtr: number;
  bytesLen: number;
  alloc(size: number, align?: number): number;
  /* At most one Input and one Term may attach (terminfo-spec 10.3). */
  inputAttached?: boolean;
  termAttached?: boolean;
}

/**
 * Internal surface consumed by createTerm/createInput to attach to the
 * handle's shared memory. Not public API.
 */
export function internals(ti: TermInfo): TermInfoNative {
  let native = NATIVE.get(ti);
  if (!native) {
    throw new TypeError("not a TermInfo handle");
  }
  return native;
}

const NATIVE = new WeakMap<TermInfo, TermInfoNative>();

const WASM_PAGE_BYTES = 65536;

function rgbOf(packed: number): Rgb {
  return {
    r: (packed >> 16) & 0xff,
    g: (packed >> 8) & 0xff,
    b: packed & 0xff,
  };
}

function readCapabilities(native: TermInfoNative): Capabilities {
  let view = new DataView(native.memory.buffer);
  let ptr = native.structPtr;
  let flags = view.getUint32(ptr + TI.flags, true);
  let theme: Capabilities["theme"] = {};
  if (flags & FLAG_THEME_FG) {
    theme.foreground = rgbOf(view.getUint32(ptr + TI.theme_fg, true));
  }
  if (flags & FLAG_THEME_BG) {
    theme.background = rgbOf(view.getUint32(ptr + TI.theme_bg, true));
  }
  if (flags & FLAG_THEME_CURSOR) {
    theme.cursor = rgbOf(view.getUint32(ptr + TI.theme_cursor, true));
  }
  return {
    generation: view.getUint32(ptr + TI.generation, true),
    colors: view.getUint32(ptr + TI.colors, true),
    trueColor: !!(flags & FLAG_TRUECOLOR),
    bce: !!(flags & FLAG_BCE),
    autoMargin: !!(flags & FLAG_AM),
    altScreen: !!(flags & FLAG_ALTSCREEN),
    styledUnderline: !!(flags & FLAG_STYLED_UNDERLINE),
    syncOutput: !!(flags & FLAG_SYNC),
    kittyKeyboard: !!(flags & FLAG_KITTY_KEYBOARD),
    kittyGraphics: !!(flags & FLAG_KITTY_GRAPHICS),
    kittyColor: !!(flags & FLAG_KITTY_COLOR),
    hyperlinks: !!(flags & FLAG_HYPERLINKS),
    pointerShape: !!(flags & FLAG_POINTER_SHAPE),
    theme,
  };
}

export async function queryTermInfo(
  options: QueryTermInfoOptions = {},
): Promise<TermInfo> {
  let env = options.env ?? process.env;
  let timeout = options.timeout ?? 100;
  let bytes = options.terminfo;

  if (bytes && bytes.byteLength > MAX_TERMINFO) {
    throw new RangeError(
      `terminfo exceeds ${MAX_TERMINFO} byte limit (got ${bytes.byteLength})`,
    );
  }

  if (!bytes) {
    bytes = await loadTerminfo({ term: options.term, env });
  }

  let memory = new WebAssembly.Memory({ initial: 4 });
  let allExports: Record<string, CallableFunction> = {};
  let instance = await WebAssembly.instantiate(compiled, {
    env: { memory },
    clay: {
      measureTextFunction(ret: number, text: number) {
        allExports.measure(ret, text);
      },
      queryScrollOffsetFunction(ret: number) {
        let view = new DataView(memory.buffer);
        view.setFloat32(ret, 0, true);
        view.setFloat32(ret + 4, 0, true);
      },
    },
  });
  Object.assign(allExports, instance.exports);

  let exports = instance.exports as unknown as {
    __heap_base: WebAssembly.Global;
    terminfo_size(): number;
    terminfo_init(mem: number): number;
    terminfo_parse(bytes: number, len: number, ti: number): number;
    terminfo_grant(ti: number, flags: number): void;
    input_size(): number;
    input_init(
      mem: number,
      escLatency: number,
      terminfo: number,
      terminfoLen: number,
      ti: number,
    ): number;
    input_scan(st: number, buf: number, len: number, now: number): number;
  };

  let top = ((exports.__heap_base.value as number) + 7) & ~7;
  function alloc(size: number, align = 8): number {
    top = (top + align - 1) & ~(align - 1);
    let ptr = top;
    top += size;
    let pages = Math.ceil(top / WASM_PAGE_BYTES);
    let current = memory.buffer.byteLength / WASM_PAGE_BYTES;
    if (pages > current) {
      memory.grow(pages - current);
    }
    return ptr;
  }

  let structPtr = alloc(exports.terminfo_size());
  exports.terminfo_init(structPtr);

  let bytesPtr = alloc(MAX_TERMINFO);
  let bytesLen = 0;
  if (bytes) {
    new Uint8Array(memory.buffer).set(bytes, bytesPtr);
    if (exports.terminfo_parse(bytesPtr, bytes.byteLength, structPtr) === 0) {
      bytesLen = bytes.byteLength;
    }
  }

  let colorterm = env.COLORTERM;
  if (colorterm === "truecolor" || colorterm === "24bit") {
    exports.terminfo_grant(structPtr, FLAG_TRUECOLOR);
  }

  let native: TermInfoNative = {
    memory,
    exports: allExports,
    structPtr,
    bytesPtr,
    bytesLen,
    alloc,
  };

  let handle: TermInfo = {
    get capabilities(): Capabilities {
      return readCapabilities(native);
    },
    probe(): Uint8Array {
      return PROBE.slice();
    },
  };
  NATIVE.set(handle, native);

  let input = options.input ?? process.stdin;
  let output = options.output ?? process.stdout;
  if (input.isTTY && output.isTTY && !options.signal?.aborted) {
    // Probe-window parser: a private input parser over the shared
    // memory whose only job is folding responses into the struct and
    // spotting the DA1 fence. Abandoned once the probe resolves; the
    // consumer's own createInput({ terminfo }) parser takes over.
    let scanState = exports.input_init(
      alloc(exports.input_size()),
      25,
      0,
      0,
      structPtr,
    );
    let scanBuf = alloc(SCAN_CHUNK);

    let feed = (chunk: Uint8Array): boolean => {
      let offset = 0;
      while (offset < chunk.length) {
        let part = chunk.subarray(offset, offset + SCAN_CHUNK);
        new Uint8Array(memory.buffer).set(part, scanBuf);
        let accepted = exports.input_scan(
          scanState,
          scanBuf,
          part.length,
          Date.now(),
        );
        if (accepted <= 0) break;
        offset += accepted;
      }
      let view = new DataView(memory.buffer);
      let confirmed = view.getUint32(structPtr + TI.confirmed, true);
      return (confirmed & FLAG_DA1) !== 0;
    };

    await runProbe(input, output, timeout, feed, options.signal);
  }

  return handle;
}

/* Must match SCAN_BUFFER_SIZE in input.c. */
const SCAN_CHUNK = 4096;

function runProbe(
  input: ProbeInput,
  output: ProbeOutput,
  timeout: number,
  feed: (chunk: Uint8Array) => boolean,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let prevRaw = input.isRaw ?? false;
    let wasPaused = input.isPaused?.() ?? false;

    function finish(): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.off("data", onData);
      signal?.removeEventListener("abort", onAbort);
      input.setRawMode?.(prevRaw);
      if (wasPaused) input.pause?.();
      resolve();
    }

    function onData(chunk: Uint8Array): void {
      if (feed(chunk)) finish();
    }

    let onAbort = () => finish();
    let timer = setTimeout(finish, timeout);
    signal?.addEventListener("abort", onAbort);

    input.setRawMode?.(true);
    input.resume?.();
    input.on("data", onData);
    output.write(PROBE);
  });
}

/* ── terminfo filesystem lookup ───────────────────────────────────── */

interface LoadOptions {
  term?: string;
  env: Record<string, string | undefined>;
}

// Compiled-in fallback locations, searched in order (ncurses convention).
const DEFAULT_DIRS = [
  "/usr/share/terminfo",
  "/etc/terminfo",
  "/lib/terminfo",
  "/usr/lib/terminfo",
];

const MAGIC_LEGACY = 0x011a;
const MAGIC_EXTENDED = 0x021e;

function hasTerminfoMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  let magic = bytes[0] | (bytes[1] << 8);
  return magic === MAGIC_LEGACY || magic === MAGIC_EXTENDED;
}

// Turn a directory path into a file URL ending in "/" so that
// `new URL(child, dir)` resolves children *under* it.
function dirUrl(path: string): URL {
  return pathToFileURL(path.endsWith("/") ? path : `${path}/`);
}

function searchPath(env: Record<string, string | undefined>): URL[] {
  let dirs: URL[] = [];
  let seen = new Set<string>();
  let add = (url: URL): void => {
    if (!seen.has(url.href)) {
      seen.add(url.href);
      dirs.push(url);
    }
  };
  if (env.TERMINFO) add(dirUrl(env.TERMINFO));
  if (env.HOME) add(new URL(".terminfo/", dirUrl(env.HOME)));
  if (env.TERMINFO_DIRS) {
    for (let entry of env.TERMINFO_DIRS.split(":")) {
      // An empty entry stands in for the compiled-in defaults.
      if (entry === "") {
        for (let dir of DEFAULT_DIRS) add(dirUrl(dir));
      } else {
        add(dirUrl(entry));
      }
    }
  }
  for (let dir of DEFAULT_DIRS) add(dirUrl(dir));
  return dirs;
}

function candidates(base: URL, name: string): URL[] {
  let first = name[0];
  // macOS stores under a two-hex-digit dir; Linux uses the first letter.
  let hex = first.charCodeAt(0).toString(16).padStart(2, "0");
  return [new URL(`${first}/${name}`, base), new URL(`${hex}/${name}`, base)];
}

async function tryRead(url: URL): Promise<Uint8Array | undefined> {
  try {
    return await readFile(url);
  } catch {
    return undefined;
  }
}

async function loadTerminfo(
  options: LoadOptions,
): Promise<Uint8Array | undefined> {
  let name = options.term ?? options.env.TERM;
  if (!name) return undefined;
  // Reject path separators, NUL, and leading dots (no traversal;
  // terminfo names never begin with '.').
  if (
    name.startsWith(".") || name.includes("/") || name.includes("\\") ||
    name.includes("\0")
  ) {
    return undefined;
  }
  for (let base of searchPath(options.env)) {
    for (let url of candidates(base, name)) {
      let bytes = await tryRead(url);
      if (
        bytes && bytes.byteLength <= MAX_TERMINFO && hasTerminfoMagic(bytes)
      ) {
        return bytes;
      }
    }
  }
  return undefined;
}
