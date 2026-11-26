import { f32, offsets, struct } from "./typedef.ts";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const BoundingBoxStruct = struct<BoundingBox>({
  x: f32(),
  y: f32(),
  width: f32(),
  height: f32(),
});

const BOUNDING_BOX = offsets(BoundingBoxStruct);

const WASM_PAGE_BYTES = 65536;
const TEXT_TRANSFER_BUFFER_BYTES = 1024 * 1024;
const CLAY_DEFAULT_MAX_ELEMENT_COUNT = 8192;

// Conservative fixed wire-format budget per element. This covers the largest
// non-text open/close element encoding we currently support; text, element id,
// and snapshot payload bytes live in TEXT_TRANSFER_BUFFER_BYTES.
const MAX_FIXED_ELEMENT_WIRE_BYTES = 120;

/** Capability evidence the renderer consumes for emission. */
export interface RenderCapabilities {
  syncOutput: boolean;
  pointerShape: boolean;
}

const RENDER_CAP_SYNC_OUTPUT = 1 << 0;
const RENDER_CAP_POINTER_SHAPE = 1 << 1;

/** Pointer passed to reduce(): absent, up, or down. */
export const POINTER_ABSENT = 0;
export const POINTER_UP = 1;
export const POINTER_DOWN = 2;

export interface Native {
  memory: WebAssembly.Memory;
  statePtr: number;
  opsBuf: number;
  /**
   * Rebuild dimension-dependent renderer storage in place (renderer-spec 7.7).
   * Reuses this instance and memory; statePtr stays fixed and opsBuf may move.
   * Growing memory detaches prior buffer views.
   */
  update(w: number, h: number): void;
  /**
   * Push capability evidence into the renderer. The renderer holds it across
   * frames and resize updates. Returns true when withdrawing pointerShape leaves a
   * non-default shape on screen that the caller must reset.
   */
  setCapabilities(caps: RenderCapabilities): boolean;
  reduce(
    ct: number,
    buf: number,
    len: number,
    mode: number,
    row: number,
    deltaTime: number,
    px: number,
    py: number,
    pointer: number,
  ): void;
  output(ct: number): number;
  length(ct: number): number;
  getPointerOverIds(): string[];
  getElementBounds(id: string): BoundingBox | undefined;
  animating(ct: number): number;
  errorCount(ct: number): number;
  errorType(ct: number, index: number): number;
  errorMessage(ct: number, index: number): string;
}

import { compiled } from "./wasm.ts";

export async function createTermNative(
  w: number,
  h: number,
  caps: RenderCapabilities,
): Promise<Native> {
  let memory = new WebAssembly.Memory({ initial: 2 });
  let exports: Record<string, CallableFunction> = {};

  let instance = await WebAssembly.instantiate(compiled, {
    env: { memory },
    clay: {
      measureTextFunction(
        ret: number,
        text: number,
        _config: number,
        _userData: number,
      ) {
        exports.measure(ret, text);
      },
      queryScrollOffsetFunction(
        ret: number,
        _elementId: number,
        _userData: number,
      ) {
        let view = new DataView(memory.buffer);
        view.setFloat32(ret, 0, true);
        view.setFloat32(ret + 4, 0, true);
      },
    },
  });

  Object.assign(exports, instance.exports);

  let ct = exports as unknown as {
    __heap_base: WebAssembly.Global;
    clayterm_size(w: number, h: number): number;
    clayterm_init(mem: number, w: number, h: number): number;
    clayterm_resize(ct: number, w: number, h: number): void;
    reduce(
      ct: number,
      buf: number,
      len: number,
      mode: number,
      row: number,
      deltaTime: number,
      px: number,
      py: number,
      pointer: number,
    ): void;
    output(ct: number): number;
    length(ct: number): number;
    set_capabilities(ct: number, caps: number): number;
    pointer_over_count(): number;
    pointer_over_id_string_length(index: number): number;
    pointer_over_id_string_ptr(index: number): number;
    get_element_bounds(name: number, len: number, out: number): number;
    animating(ct: number): number;
    error_count(ct: number): number;
    error_type(ct: number, index: number): number;
    error_message_length(ct: number, index: number): number;
    error_message_ptr(ct: number, index: number): number;
  };

  // The transfer budget is intentionally fixed: text/id/snapshot payload bytes
  // get 1MB, and fixed op overhead gets one max-sized element per Clay element.
  // Do not grow this dynamically per render; improve the wire format instead.
  let transferBytes = TEXT_TRANSFER_BUFFER_BYTES +
    CLAY_DEFAULT_MAX_ELEMENT_COUNT * MAX_FIXED_ELEMENT_WIRE_BYTES;

  let statePtr: number | undefined;
  let opsBuf = 0;
  function setCaps(next: RenderCapabilities): boolean {
    let flags = (next.syncOutput ? RENDER_CAP_SYNC_OUTPUT : 0) |
      (next.pointerShape ? RENDER_CAP_POINTER_SHAPE : 0);
    return ct.set_capabilities(statePtr!, flags) !== 0;
  }

  // Renderer state and the fixed transfer buffer share linear memory as
  // [heap: state][opsBuf]; opsBuf moves when the state size changes. Memory is
  // grown to fit but never reclaimed, so a downsize keeps the high-water mark
  // (renderer-spec 7.7). The instance is initialized once; resize rebuilds only
  // its dimension-dependent storage.
  function layout(lw: number, lh: number): void {
    let heap = ct.__heap_base.value as number;
    let size = ct.clayterm_size(lw, lh);
    let needed = heap + size + transferBytes;
    let pages = Math.ceil(needed / WASM_PAGE_BYTES);
    let current = memory.buffer.byteLength / WASM_PAGE_BYTES;
    if (pages > current) {
      memory.grow(pages - current);
    }
    if (statePtr === undefined) {
      statePtr = ct.clayterm_init(heap, lw, lh);
    } else {
      ct.clayterm_resize(statePtr, lw, lh);
    }
    opsBuf = (heap + size + 3) & ~3;
  }
  layout(w, h);
  setCaps(caps);

  return {
    memory,
    get statePtr() {
      return statePtr!;
    },
    get opsBuf() {
      return opsBuf;
    },
    update(uw: number, uh: number): void {
      layout(uw, uh);
    },
    setCapabilities(next: RenderCapabilities): boolean {
      return setCaps(next);
    },
    reduce: ct.reduce,
    output: ct.output,
    length: ct.length,
    animating: ct.animating,
    getPointerOverIds(): string[] {
      let decoder = new TextDecoder();
      let count = ct.pointer_over_count();
      let ids: string[] = [];
      for (let i = 0; i < count; i++) {
        let len = ct.pointer_over_id_string_length(i);
        if (len === 0) continue;
        let ptr = ct.pointer_over_id_string_ptr(i);
        ids.push(decoder.decode(new Uint8Array(memory.buffer, ptr, len)));
      }
      return ids;
    },
    getElementBounds(id: string): BoundingBox | undefined {
      let enc = new TextEncoder();
      let bytes = enc.encode(id);
      new Uint8Array(memory.buffer).set(bytes, opsBuf);
      let out = opsBuf + 256;
      let found = ct.get_element_bounds(opsBuf, bytes.length, out);
      if (!found) {
        return undefined;
      }
      let view = new DataView(memory.buffer);
      return {
        x: view.getFloat32(out + BOUNDING_BOX.x, true),
        y: view.getFloat32(out + BOUNDING_BOX.y, true),
        width: view.getFloat32(out + BOUNDING_BOX.width, true),
        height: view.getFloat32(out + BOUNDING_BOX.height, true),
      };
    },
    errorCount(ptr: number): number {
      return ct.error_count(ptr);
    },
    errorType(ptr: number, index: number): number {
      return ct.error_type(ptr, index);
    },
    errorMessage(ptr: number, index: number): string {
      let len = ct.error_message_length(ptr, index);
      if (len === 0) return "";
      let p = ct.error_message_ptr(ptr, index);
      let decoder = new TextDecoder();
      return decoder.decode(new Uint8Array(memory.buffer, p, len));
    },
  };
}
