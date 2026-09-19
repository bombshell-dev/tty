import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";

import { compiled } from "./wasm.ts";
import { offsets, struct, uint32 } from "./typedef.ts";

export const MAX_TERMINFO = 32768;

/* Flag bits — must match src/terminfo.h. */
const FLAG_TRUECOLOR = 1 << 0;
const FLAG_BCE = 1 << 1;
const FLAG_AM = 1 << 2;
const FLAG_XENL = 1 << 3;
const FLAG_ALTSCREEN = 1 << 4;
const FLAG_STYLED_UNDERLINE = 1 << 5;

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

/** Static terminal capabilities, frozen at detection time. No WASM backing. */
export interface Capabilities {
  readonly colors: number;
  readonly trueColor: boolean;
  readonly bce: boolean;
  readonly autoMargin: boolean;
  readonly xenl: boolean;
  readonly altScreen: boolean;
  readonly styledUnderline: boolean;
}

/** Opaque type alias for the raw terminfo key-sequence bytes. */
export type KeyTable = Uint8Array;

/** Result of detectTerminal(). */
export interface Detection {
  /** Static capabilities, frozen at detection time. */
  readonly capabilities: Capabilities;
  /**
   * Write to stdout immediately after detection. Probe responses arrive
   * as CapabilityEvent values in input.scan().
   */
  readonly probe: Uint8Array;
  /** Raw terminfo key bytes. The input parser seeds its trie from this. */
  readonly keys: KeyTable;
}

export interface DetectOptions {
  /** Terminal name to resolve. Defaults to env.TERM. */
  term?: string;
  /**
   * Environment for TERM/TERMINFO/TERMINFO_DIRS/HOME/COLORTERM lookups.
   * Defaults to process.env. Injectable for testing.
   */
  env?: Record<string, string | undefined>;
  /** Raw compiled terminfo bytes; skips the filesystem lookup. */
  terminfo?: Uint8Array;
  signal?: AbortSignal;
}

const encoder = new TextEncoder();

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

const WASM_PAGE_BYTES = 65536;

function rgbOf(packed: number): Rgb {
  return {
    r: (packed >> 16) & 0xff,
    g: (packed >> 8) & 0xff,
    b: packed & 0xff,
  };
}

/**
 * Detect the terminal's capabilities from the compiled terminfo entry and
 * process environment. Pure: performs no IO beyond reading the terminfo file.
 * Never rejects. See specs/terminfo-spec.md.
 */
export async function detectTerminal(
  options: DetectOptions = {},
): Promise<Detection> {
  let env = options.env ?? process.env;
  let bytes = options.terminfo;

  if (bytes && bytes.byteLength > MAX_TERMINFO) {
    throw new RangeError(
      `terminfo exceeds ${MAX_TERMINFO} byte limit (got ${bytes.byteLength})`,
    );
  }

  if (!bytes) {
    bytes = await loadTerminfo({ term: options.term, env });
  }

  let memory = new WebAssembly.Memory({ initial: 2 });
  let instance = await WebAssembly.instantiate(compiled, {
    env: { memory },
    clay: {
      measureTextFunction() {},
      queryScrollOffsetFunction(ret: number) {
        let v = new DataView(memory.buffer);
        v.setFloat32(ret, 0, true);
        v.setFloat32(ret + 4, 0, true);
      },
    },
  });

  let exports = instance.exports as unknown as {
    __heap_base: WebAssembly.Global;
    terminfo_size(): number;
    terminfo_init(mem: number): number;
    terminfo_parse(bytes: number, len: number, ti: number): number;
    terminfo_grant(ti: number, flags: number): void;
  };

  let top = ((exports.__heap_base.value as number) + 7) & ~7;
  function alloc(size: number): number {
    let ptr = top;
    top += (size + 7) & ~7;
    let pages = Math.ceil(top / WASM_PAGE_BYTES);
    let current = memory.buffer.byteLength / WASM_PAGE_BYTES;
    if (pages > current) memory.grow(pages - current);
    return ptr;
  }

  let structPtr = alloc(exports.terminfo_size());
  exports.terminfo_init(structPtr);

  let keys: KeyTable = new Uint8Array(0);
  if (bytes) {
    let bytesPtr = alloc(MAX_TERMINFO);
    new Uint8Array(memory.buffer).set(bytes, bytesPtr);
    if (exports.terminfo_parse(bytesPtr, bytes.byteLength, structPtr) === 0) {
      keys = bytes.slice();
    }
  }

  let colorterm = env.COLORTERM;
  if (colorterm === "truecolor" || colorterm === "24bit") {
    exports.terminfo_grant(structPtr, FLAG_TRUECOLOR);
  }

  let view = new DataView(memory.buffer);
  let flags = view.getUint32(structPtr + TI.flags, true);
  let capabilities: Capabilities = Object.freeze({
    colors: view.getUint32(structPtr + TI.colors, true),
    trueColor: !!(flags & FLAG_TRUECOLOR),
    bce: !!(flags & FLAG_BCE),
    autoMargin: !!(flags & FLAG_AM),
    xenl: !!(flags & FLAG_XENL),
    altScreen: !!(flags & FLAG_ALTSCREEN),
    styledUnderline: !!(flags & FLAG_STYLED_UNDERLINE),
  });

  return Object.freeze<Detection>({
    capabilities,
    probe: PROBE.slice(),
    keys,
  });
}

/* ── terminfo filesystem lookup ───────────────────────────────────── */

interface LoadOptions {
  term?: string;
  env: Record<string, string | undefined>;
}

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
  if (
    name.startsWith(".") || name.includes("/") || name.includes("\\") ||
    name.includes("\0")
  ) {
    return undefined;
  }
  for (let base of searchPath(options.env)) {
    for (let url of candidates(base, name)) {
      let b = await tryRead(url);
      if (b && b.byteLength <= MAX_TERMINFO && hasTerminfoMagic(b)) {
        return b;
      }
    }
  }
  return undefined;
}

/* Re-export Rgb helper for consumers that need it. */
export { rgbOf };
