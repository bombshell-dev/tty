import { type Op, pack } from "./ops.ts";
import type { InputEvent } from "./input.ts";
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

  /** @deprecated Use `event` instead. */
  pointer?: {
    x: number;
    y: number;
    down: boolean;
  };

  event?: InputEvent;
}

export type PointerEvent =
  | { type: "pointerenter"; id: string }
  | { type: "pointerleave"; id: string }
  | { type: "pointerclick"; id: string };

export type { BoundingBox };

export interface ElementInfo {
  bounds: BoundingBox;
  scrollDelta: { x: number; y: number };
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
  let pointerX = 0;
  let pointerY = 0;
  let pointerDown = false;
  let hasPointer = false;

  return {
    render(ops: Op[], options?: RenderOptions): RenderResult {
      let dx = 0;
      let dy = 0;

      if (options?.event) {
        let ev = options.event;
        if ("x" in ev && "y" in ev) {
          pointerX = ev.x;
          pointerY = ev.y;
          hasPointer = true;
        }
        if (ev.type === "mousedown") {
          pointerDown = true;
        } else if (ev.type === "mouseup") {
          pointerDown = false;
        }
        if (ev.type === "wheel") {
          dy = ev.direction === "down" ? -1 : 1;
        }
      } else if (options?.pointer) {
        pointerX = options.pointer.x;
        pointerY = options.pointer.y;
        pointerDown = options.pointer.down;
        hasPointer = true;
      } else {
        hasPointer = false;
      }

      if (hasPointer) {
        native.setPointer(pointerX, pointerY, pointerDown);
      }
      if (dx !== 0 || dy !== 0) {
        native.updateScrollContainers(dx, dy);
      }

      let len = pack(ops, memory.buffer, opsBuf, memory.buffer.byteLength);
      let mode = options?.mode === "line" ? 1 : 0;
      let row = options?.row ?? 1;
      native.reduce(statePtr, opsBuf, len, mode, row);

      if (hasPointer) {
        native.setPointer(pointerX, pointerY, pointerDown);
      }

      let output = new Uint8Array(
        memory.buffer,
        native.output(statePtr),
        native.length(statePtr),
      );

      let current = new Set(
        hasPointer ? native.getPointerOverIds() : [],
      );
      let down = pointerDown;
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

      let zero = { x: 0, y: 0 };
      let info: RenderInfo = {
        get(id: string): ElementInfo | undefined {
          let bounds = native.getElementBounds(id);
          if (bounds) {
            let scrollDelta = native.getScrollDelta(statePtr, id);
            return {
              bounds,
              scrollDelta: scrollDelta.x === 0 && scrollDelta.y === 0
                ? zero
                : scrollDelta,
            };
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
