import { type Op, pack } from "./ops.ts";
import { type BoundingBox, createTermNative } from "./term-native.ts";

export interface TermOptions {
  height: number;
  width: number;
}

export interface RenderOptions {
  mode?: "line";

  /**
   * Row where to begin rendering. This should only be used when
   * rendering into a region as part of the CLI main screen. For
   * interfaces that use the entire screen, leave unset which will
   * default to 0. This is 1-based which which is the DSR native
   * format.
   *
   * https://www.ecma-international.org/publications-and-standards/standards/ecma-48/
   */
  row?: number;

  pointer?: {
    x: number;
    y: number;
    down: boolean;
  };
}

export type PointerEvent =
  | { type: "pointerenter"; id: string }
  | { type: "pointerleave"; id: string }
  | { type: "pointerclick"; id: string };

export type { BoundingBox };

export interface ElementInfo {
  bounds: BoundingBox;
}

const WINDOWS_WRAP_DISABLE = new Uint8Array([0x1b, 0x5b, 0x3f, 0x37, 0x6c]);
const WINDOWS_WRAP_ENABLE = new Uint8Array([0x1b, 0x5b, 0x3f, 0x37, 0x68]);

function normalizeWindowsLineOutput(output: Uint8Array): Uint8Array {
  // Windows fullscreen line-mode output needs an explicit home cursor move and
  // CRLF row separators; bare LF can leave the cursor in the wrong column and
  // visually clip later rows in some terminal stacks.
  let extra = 0;
  for (let i = 0; i < output.length; i++) {
    if (output[i] === 0x0a && (i === 0 || output[i - 1] !== 0x0d)) {
      extra++;
    }
  }

  let prefix = new Uint8Array([
    ...WINDOWS_WRAP_DISABLE,
    0x1b,
    0x5b,
    0x48,
  ]);
  let suffix = WINDOWS_WRAP_ENABLE;
  let normalized = new Uint8Array(
    prefix.length + output.length + extra + suffix.length,
  );
  normalized.set(prefix, 0);

  let offset = prefix.length;
  for (let i = 0; i < output.length; i++) {
    let byte = output[i];
    if (byte === 0x0a && (i === 0 || output[i - 1] !== 0x0d)) {
      normalized[offset++] = 0x0d;
    }
    normalized[offset++] = byte;
  }

  normalized.set(suffix, offset);

  return normalized as Uint8Array;
}

function wrapWindowsFullscreenOutput(output: Uint8Array): Uint8Array {
  // Disabling autowrap around a fullscreen frame avoids Windows terminal
  // redraw quirks observed at the right edge.
  // xterm defines CSI ? 7 h / CSI ? 7 l as auto-wrap on/off.
  let wrapped = new Uint8Array(
    WINDOWS_WRAP_DISABLE.length + output.length + WINDOWS_WRAP_ENABLE.length,
  );
  wrapped.set(WINDOWS_WRAP_DISABLE, 0);
  wrapped.set(output, WINDOWS_WRAP_DISABLE.length);
  wrapped.set(WINDOWS_WRAP_ENABLE, WINDOWS_WRAP_DISABLE.length + output.length);
  return wrapped;
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
}

export interface Term {
  render(ops: Op[], options?: RenderOptions): RenderResult;
}

export async function createTerm(options: TermOptions): Promise<Term> {
  let { width, height } = options;
  let native = await createTermNative(width, height);
  let { memory, statePtr, opsBuf } = native;

  let prev = new Set<string>();
  let pressed = new Set<string>();
  let wasDown = false;

  return {
    render(ops: Op[], options?: RenderOptions): RenderResult {
      let len = pack(ops, memory.buffer, opsBuf, memory.buffer.byteLength);
      let mode = options?.mode === "line" ? 1 : 0;
      let row = options?.row ?? 1;
      let autoLineMode = false;
      let windowsFullscreen = row === 1 && Deno.build.os === "windows";

      // Windows terminals have historically been less reliable with many
      // absolute cursor CUP updates in full-screen diff mode. Use the
      // line-oriented render path by default on Windows for fullscreen
      // layouts to improve redraw reliability.
      if (mode === 0 && options?.mode === undefined && windowsFullscreen) {
        mode = 1;
        autoLineMode = true;
      }

      native.reduce(statePtr, opsBuf, len, mode, row);

      if (options?.pointer) {
        let { x, y, down } = options.pointer;
        native.setPointer(x, y, down);
      }

      let output: Uint8Array<ArrayBufferLike> = new Uint8Array(
        memory.buffer,
        native.output(statePtr),
        native.length(statePtr),
      );

      if (autoLineMode) {
        output = normalizeWindowsLineOutput(output);
      } else if (windowsFullscreen) {
        output = wrapWindowsFullscreenOutput(output);
      }

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
          if (bounds) {
            return { bounds };
          }
          return undefined;
        },
      };

      let errors: ClayError[] = [];
      let count = native.errorCount(statePtr);
      for (let i = 0; i < count; i++) {
        let code = native.errorType(statePtr, i);
        errors.push({
          type: ERROR_TYPES[code] ?? `UNKNOWN_${code}`,
          message: native.errorMessage(statePtr, i),
        });
      }

      return { output, events, info, errors };
    },
  };
}
