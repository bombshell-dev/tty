import { type Op, pack } from "./ops.ts";
import {
  type BoundingBox,
  createTermNative,
  FLAG_SYNC,
  FLAG_TRUECOLOR,
} from "./term-native.ts";
import type { CapabilityEvent, ColorDepth, InputEvent } from "./input.ts";
import type { Capabilities, Detection, Rgb } from "./terminfo.ts";

export type { BoundingBox };

export interface TermOptions {
  height: number;
  width: number;
  /**
   * Detection from detectTerminal(). Initializes the renderer with the
   * static capabilities from the detection and seeds the private TermInfo
   * struct. When omitted, the renderer uses the 256-color baseline.
   */
  detection?: Detection;
}

/**
 * The renderer's merged view of capabilities: the static Capabilities fields
 * plus all CapabilityEvent values folded in by update() calls.
 */
export interface RuntimeCapabilities extends Capabilities {
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

/**
 * One change accepted by term.update(). Either a structural resize or a
 * CapabilityEvent routed from scan(). Non-capability InputEvents are silently
 * ignored, so the full events array from scan() can be passed without filtering.
 */
export type Update = { width: number; height: number } | InputEvent;

/**
 * Apply one Update to the current RuntimeCapabilities and return the next
 * snapshot plus any bytes to write now. Pure: performs no IO, no WASM calls.
 */
export function applyUpdate(
  current: RuntimeCapabilities,
  change: Update,
): { readonly next: RuntimeCapabilities; readonly bytes: Uint8Array } {
  if ("width" in change) {
    return { next: current, bytes: new Uint8Array(0) };
  }
  if ((change as { type?: string }).type !== "capability") {
    return { next: current, bytes: new Uint8Array(0) };
  }
  let cap = change as CapabilityEvent;
  let next: RuntimeCapabilities;
  switch (cap.key) {
    case "foreground-color":
      next = { ...current, theme: { ...current.theme, foreground: cap.value } };
      break;
    case "background-color":
      next = { ...current, theme: { ...current.theme, background: cap.value } };
      break;
    case "cursor-color":
      next = { ...current, theme: { ...current.theme, cursor: cap.value } };
      break;
    case "colordepth": {
      let trueColor = (cap.value as ColorDepth) === "truecolor";
      next = { ...current, trueColor };
      break;
    }
    case "sync-output":
      next = { ...current, syncOutput: cap.value as boolean };
      break;
    case "kitty-keyboard":
      next = { ...current, kittyKeyboard: cap.value as boolean };
      break;
    case "kitty-graphics":
      next = { ...current, kittyGraphics: cap.value as boolean };
      break;
    case "pointer-shape":
      next = { ...current, pointerShape: cap.value as boolean };
      break;
    default:
      next = current;
  }
  return { next: Object.freeze(next), bytes: new Uint8Array(0) };
}

function runtimeFromStatic(caps: Capabilities): RuntimeCapabilities {
  return Object.freeze<RuntimeCapabilities>({
    ...caps,
    syncOutput: false,
    kittyKeyboard: false,
    kittyGraphics: false,
    pointerShape: false,
    theme: Object.freeze({}),
  });
}

export interface RenderOptions {
  mode?: "line";
  row?: number;
  pointer?: {
    x: number;
    y: number;
    down: boolean;
  };
  deltaTime?: number;
}

export type PointerEvent =
  | { type: "pointerenter"; id: string }
  | { type: "pointerleave"; id: string }
  | { type: "pointerclick"; id: string };

export interface ElementInfo {
  bounds: BoundingBox;
}

const ERROR_TYPES = [
  "TEXT_MEASUREMENT_FUNCTION_NOT_PROVIDED",
  "ARENA_CAPACITY_EXCEEDED",
  "ELEMENTS_CAPACITY_EXCEEDED",
  "TEXT_MEASUREMENT_CAPACITY_EXCEEDED",
  "DUPLICATE_ID",
  "FLOATING_CONTAINER_PARENT_NOT_FOUND",
  "PERCENTAGE_OVER_1",
  "INTERNAL_ERROR",
  "UNBALANCED_OPEN_CLOSE",
  "CLIP_DEPTH_EXCEEDED",
] as const;

export interface ClayError {
  type: string;
  message: string;
}

export interface RenderInfo {
  get(id: string): ElementInfo | undefined;
}

export interface RenderResult {
  output: Uint8Array;
  events: PointerEvent[];
  info: RenderInfo;
  errors: ClayError[];
  animating: boolean;
}

export interface Term {
  render(ops: Op[], options?: RenderOptions): RenderResult;

  /**
   * Apply one change or a batch of changes. Returns bytes to write now.
   * An empty array is valid when no immediate output is needed (TINV-5).
   *
   * Route CapabilityEvents from scan() here. For resize, pass
   * { width, height }.
   */
  update(change: Update | readonly Update[]): Uint8Array;

  /** Frozen snapshot of the current merged capability state. */
  readonly capabilities: RuntimeCapabilities;
}

export async function createTerm(options: TermOptions): Promise<Term> {
  let { width, height, detection } = options;

  let native = await createTermNative(
    width,
    height,
    detection?.keys,
    detection?.capabilities.trueColor,
  );
  let { memory } = native;

  let currentCaps: RuntimeCapabilities = runtimeFromStatic(
    detection?.capabilities ?? {
      colors: 256,
      trueColor: false,
      bce: true,
      autoMargin: true,
      xenl: true,
      altScreen: true,
      styledUnderline: false,
    },
  );

  let prev = new Set<string>();
  let pressed = new Set<string>();
  let wasDown = false;
  let lastRenderAt: number | undefined;
  let wasAnimating = false;

  return {
    get capabilities(): RuntimeCapabilities {
      return currentCaps;
    },

    render(ops: Op[], options?: RenderOptions): RenderResult {
      let len = pack(
        ops,
        memory.buffer,
        native.opsBuf,
        memory.buffer.byteLength,
      );
      let mode = options?.mode === "line" ? 1 : 0;
      let row = options?.row ?? 1;
      let now = performance.now() / 1000;
      let dt: number;
      if (options?.deltaTime !== undefined) {
        dt = options.deltaTime;
      } else if (!wasAnimating || lastRenderAt === undefined) {
        dt = 0;
      } else {
        dt = now - lastRenderAt;
      }
      lastRenderAt = now;
      native.reduce(native.statePtr, native.opsBuf, len, mode, row, dt);

      if (options?.pointer) {
        let { x, y, down } = options.pointer;
        native.setPointer(x, y, down);
      }

      let output = new Uint8Array(
        memory.buffer,
        native.output(native.statePtr),
        native.length(native.statePtr),
      );

      let current = new Set(
        options?.pointer ? native.getPointerOverIds() : [],
      );
      let down = options?.pointer?.down ?? false;
      let events: PointerEvent[] = [];

      for (let id of current) {
        if (!prev.has(id)) {
          events.push({ type: "pointerenter", id });
        }
      }

      for (let id of prev) {
        if (!current.has(id)) {
          events.push({ type: "pointerleave", id });
        }
      }

      if (wasDown && !down) {
        for (let id of pressed) {
          if (current.has(id)) {
            events.push({ type: "pointerclick", id });
          }
        }
      }

      if (down && !wasDown) {
        pressed = new Set(current);
      } else if (!down) {
        pressed.clear();
      }

      prev = current;
      wasDown = down;

      let info: RenderInfo = {
        get(id: string): ElementInfo | undefined {
          let bounds = native.getElementBounds(id);
          if (bounds) return { bounds };
          return undefined;
        },
      };

      let errors: ClayError[] = [];
      let count = native.errorCount(native.statePtr);
      for (let i = 0; i < count; i++) {
        let code = native.errorType(native.statePtr, i);
        errors.push({
          type: ERROR_TYPES[code] ?? `UNKNOWN_${code}`,
          message: native.errorMessage(native.statePtr, i),
        });
      }

      let animating = native.animating(native.statePtr) > 0;
      wasAnimating = animating;
      return { output, events, info, errors, animating };
    },

    update(change: Update | readonly Update[]): Uint8Array {
      let changes = Array.isArray(change) ? change : [change];
      let out: Uint8Array[] = [];

      for (let c of changes as Update[]) {
        let { next, bytes } = applyUpdate(currentCaps, c);

        if ("width" in c) {
          let w = c.width;
          let h = c.height;
          if (
            !Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0
          ) {
            throw new RangeError(`invalid terminal dimensions ${w}x${h}`);
          }
          if (w !== width || h !== height) {
            width = w;
            height = h;
            native.update(width, height);
            prev = new Set();
            pressed = new Set();
            wasDown = false;
            lastRenderAt = undefined;
            wasAnimating = false;
          }
        } else {
          let cap = c as CapabilityEvent;
          if (cap.key === "colordepth") {
            native.confirmFlag(FLAG_TRUECOLOR, cap.value === "truecolor");
          } else if (cap.key === "sync-output") {
            native.confirmFlag(FLAG_SYNC, cap.value as boolean);
          }
        }

        currentCaps = next;
        if (bytes.length) out.push(bytes);
      }

      if (out.length === 0) return new Uint8Array(0);
      let total = out.reduce((n, b) => n + b.length, 0);
      let result = new Uint8Array(total);
      let offset = 0;
      for (let b of out) {
        result.set(b, offset);
        offset += b.length;
      }
      return result;
    },
  };
}
