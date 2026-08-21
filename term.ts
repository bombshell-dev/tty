import { isOpen, type Op, pack } from "./ops.ts";
import { type BoundingBox, createTermNative } from "./term-native.ts";
import { type CursorShape, POINTERSHAPE } from "./termcodes.ts";

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
  deltaTime?: number;

  /**
   * Track the mouse pointer shape across frames. When enabled, the element
   * currently under the pointer that declares a `cursor` shape drives the
   * terminal's mouse pointer, and {@link RenderResult.cursor} carries the OSC 22
   * bytes for any change. Requires `pointer` to be provided for the shape to
   * follow the cursor. See the renderer specification, Section 12.6.
   */
  trackCursor?: boolean;
}

export type PointerEvent =
  | { type: "pointerenter"; id: string }
  | { type: "pointerleave"; id: string }
  | { type: "pointerclick"; id: string };

export type { BoundingBox };

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

  /**
   * OSC 22 bytes that update the terminal's mouse pointer shape this frame.
   * Present only when `trackCursor` is enabled and the shape changed; write it
   * to the terminal separately from `output`. See the renderer specification,
   * Section 12.6.
   */
  cursor?: Uint8Array;
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
  let lastRenderAt: number | undefined;
  let wasAnimating = false;
  let cursorShape: CursorShape = "default";

  return {
    render(ops: Op[], options?: RenderOptions): RenderResult {
      let len = pack(ops, memory.buffer, opsBuf, memory.buffer.byteLength);
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
      native.reduce(statePtr, opsBuf, len, mode, row, dt);

      if (options?.pointer) {
        let { x, y, down } = options.pointer;
        native.setPointer(x, y, down);
      }

      let output = new Uint8Array(
        memory.buffer,
        native.output(statePtr),
        native.length(statePtr),
      );

      let overIds = options?.pointer ? native.getPointerOverIds() : [];
      let current = new Set(overIds);
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

      let cursor: Uint8Array | undefined;
      if (options?.trackCursor) {
        // Set-only OSC 22: the base is "default" (kitty and Ghostty both honor
        // a bare set; the kitty push/pop stack is ignored by set-only terminals
        // like Ghostty).
        let active: CursorShape = "default";
        if (overIds.length > 0) {
          let shapes = new Map<string, CursorShape>();
          for (let op of ops) {
            if (isOpen(op) && op.cursor) shapes.set(op.id, op.cursor);
          }
          // pointerOverIds is outermost-first; the innermost (topmost)
          // declaring element wins, so scan from the end.
          for (let i = overIds.length - 1; i >= 0; i--) {
            let shape = shapes.get(overIds[i]);
            if (shape) {
              active = shape;
              break;
            }
          }
        }
        if (active !== cursorShape) {
          cursor = POINTERSHAPE(active);
          cursorShape = active;
        }
      }

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

      let animating = native.animating(statePtr) > 0;
      wasAnimating = animating;
      return { output, events, info, errors, animating, cursor };
    },
  };
}
