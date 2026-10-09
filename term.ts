import { type Op, pack } from "./ops.ts";
import { type BoundingBox, createTermNative } from "./term-native.ts";
import type { InputEvent } from "./input.ts";
import type { Capabilities, Rgb, TerminalInfo } from "./terminfo.ts";

export type { BoundingBox };

export interface TermOptions {
  height: number;
  width: number;
  /**
   * Terminal info from detectTerminal(). Seeds term.capabilities from
   * terminfo.capabilities. When omitted, the renderer uses the 256-color
   * baseline.
   */
  terminfo?: TerminalInfo;
  /**
   * Sizes the Term's carved image pixel pool (Graphics Specification §5.3).
   * Default 4 MiB. The registry never grows at runtime (INV-I8).
   */
  imagePoolBytes?: number;
}

/**
 * Decoded raster pixels for the image registry (Graphics Specification
 * §6.2): straight (non-premultiplied) RGBA8, top-to-bottom rows.
 */
export interface ImageData {
  width: number; // positive integer
  height: number; // positive integer
  pixels: Uint8Array; // exactly width * height * 4 bytes
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
 * Fold one InputEvent into the current RuntimeCapabilities and return the next
 * snapshot plus any bytes to write now. Pure: performs no IO, no WASM calls.
 */
function applyUpdate(
  current: RuntimeCapabilities,
  event: InputEvent,
): { readonly next: RuntimeCapabilities; readonly bytes: Uint8Array } {
  if (event.type !== "capability") {
    return { next: current, bytes: new Uint8Array(0) };
  }
  let next: RuntimeCapabilities;
  switch (event.key) {
    case "foreground-color":
      next = {
        ...current,
        theme: { ...current.theme, foreground: event.value },
      };
      break;
    case "background-color":
      next = {
        ...current,
        theme: { ...current.theme, background: event.value },
      };
      break;
    case "cursor-color":
      next = { ...current, theme: { ...current.theme, cursor: event.value } };
      break;
    case "colordepth": {
      let trueColor = event.value === "truecolor";
      next = { ...current, trueColor };
      break;
    }
    case "sync-output":
      next = { ...current, syncOutput: event.value };
      break;
    case "kitty-keyboard":
      next = { ...current, kittyKeyboard: event.value };
      break;
    case "kitty-graphics":
      next = { ...current, kittyGraphics: event.value };
      break;
    case "pointer-shape":
      next = { ...current, pointerShape: event.value };
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
  "COMBINING_MARKS_EXCEEDED",
  "IMAGE_NOT_FOUND",
  "IMAGE_PLACEMENTS_EXCEEDED",
  "IMAGE_PLACEMENT_COLLISION",
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
   * Fold InputEvents in order. Returns bytes to write now. An empty array is
   * valid when no immediate output is needed (TINV-5).
   *
   * Pass the events array from scan() directly. For an out-of-band resize,
   * pass [{ type: "resize", width, height }].
   */
  update(events: readonly InputEvent[]): Uint8Array;

  /**
   * Put a decoded image into the Term's pixel-surface registry (Graphics
   * Specification §6.2). Synchronous, byte-free: transmission is lazy, on
   * the first render that places the image. Throws RangeError on
   * validation failure or pool/registry exhaustion. Re-setting a live id
   * replaces the image and re-transmits on the next placing render.
   */
  setImage(id: number, data: ImageData): void;

  /**
   * Remove a registry image. Returns bytes to write now: the terminal's
   * data-freeing deletion block when the id was live, empty otherwise.
   * Idempotent; the covered cells are reconciled so the next render
   * repaints them.
   */
  removeImage(id: number): Uint8Array;

  /** Frozen snapshot of the current merged capability state. */
  readonly capabilities: RuntimeCapabilities;
}

const IMAGE_ERROR_MESSAGES: Record<number, string> = {
  [-1]: "registry id outside [1, 4294967295]",
  [-2]: "width and height must be positive integers",
  [-4]: "image registry table full",
  [-5]: "image pixel pool exhausted (raise the imagePoolBytes option)",
  [-6]: "unknown registry id",
};

function imageRangeError(n: number): RangeError {
  return new RangeError(
    `setImage failed: ${IMAGE_ERROR_MESSAGES[n] ?? `native error ${n}`}`,
  );
}

export async function createTerm(options: TermOptions): Promise<Term> {
  let { width, height, terminfo, imagePoolBytes } = options;

  let native = await createTermNative(width, height, imagePoolBytes);
  let { memory } = native;

  let currentCaps: RuntimeCapabilities = runtimeFromStatic(
    terminfo?.capabilities ?? {
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

    setImage(id: number, data: ImageData): void {
      if (!Number.isInteger(id) || id < 1 || id > 4294967295) {
        throw new RangeError(`invalid image registry id ${id}`);
      }
      if (
        !Number.isInteger(data.width) || data.width < 1 ||
        !Number.isInteger(data.height) || data.height < 1
      ) {
        throw new RangeError(
          `invalid image dimensions ${data.width}x${data.height}`,
        );
      }
      if (data.pixels.length !== data.width * data.height * 4) {
        throw new RangeError(
          `image pixels length ${data.pixels.length} !== ${data.width} * ${data.height} * 4`,
        );
      }
      let addr = native.imageBegin(
        native.statePtr,
        id,
        data.width,
        data.height,
      );
      if (addr < 0) {
        throw imageRangeError(addr);
      }
      new Uint8Array(memory.buffer).set(data.pixels, addr);
      let committed = native.imageCommit(native.statePtr, id);
      if (committed < 0) {
        throw imageRangeError(committed);
      }
    },

    removeImage(id: number): Uint8Array {
      let n = native.imageRemove(native.statePtr, id);
      if (n <= 0) {
        return new Uint8Array(0);
      }
      // copy: the native output buffer is reused by the next call; these
      // bytes are the caller's to write now (TINV-5)
      return new Uint8Array(memory.buffer, native.output(native.statePtr), n)
        .slice();
    },

    update(events: readonly InputEvent[]): Uint8Array {
      let out: Uint8Array[] = [];

      for (let c of events) {
        let { next, bytes } = applyUpdate(currentCaps, c);

        if (c.type === "resize") {
          let w = c.width;
          let h = c.height;
          if (
            !Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0
          ) {
            throw new RangeError(`invalid terminal dimensions ${w}x${h}`);
          }
          if (w !== width || h !== height) {
            // Graphics Specification §10.5: deletion bytes for live
            // placements precede the placements record's discard
            let prepared = native.graphicsResizePrepare(native.statePtr);
            if (prepared > 0) {
              out.push(
                new Uint8Array(
                  memory.buffer,
                  native.output(native.statePtr),
                  prepared,
                ).slice(),
              );
            }
            width = w;
            height = h;
            native.update(width, height);
            prev = new Set();
            pressed = new Set();
            wasDown = false;
            lastRenderAt = undefined;
            wasAnimating = false;
          }
        } else if (
          c.type === "capability" && c.key === "kitty-graphics"
        ) {
          // the renderer's capability mirror (terminfo-spec §4.2); the
          // denial path emits §11.2's deletion bytes immediately (TINV-5)
          let kitty = c.value ? 1 : 0;
          let wrote = native.graphicsCapability(native.statePtr, kitty);
          if (wrote > 0) {
            out.push(
              new Uint8Array(
                memory.buffer,
                native.output(native.statePtr),
                wrote,
              ).slice(),
            );
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
