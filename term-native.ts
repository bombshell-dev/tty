import { f32, offsets, struct } from "./typedef.ts";

/* Graphics Specification §5.3: the image pixel pool's normative default.
 * Exposed as the createTerm `imagePoolBytes` option by term.ts. */
export const DEFAULT_IMAGE_POOL_BYTES = 4194304;

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
const MAX_FIXED_ELEMENT_WIRE_BYTES = 116;

export interface Native {
  memory: WebAssembly.Memory;
  statePtr: number;
  opsBuf: number;
  /**
   * Re-initialize renderer state for new dimensions in place
   * (renderer-spec 7.7). Reuses this instance and memory; statePtr and
   * opsBuf may change. Growing memory detaches prior buffer views.
   */
  update(w: number, h: number): void;
  reduce(
    ct: number,
    buf: number,
    len: number,
    mode: number,
    row: number,
    deltaTime: number,
  ): void;
  output(ct: number): number;
  length(ct: number): number;
  /** The graphics carve's base (Graphics Specification §5.1); the pool and
   * registry live here. Exposed for surface-address math (PR: zero-copy
   * canvas views). */
  readonly gfxPtr: number;
  /** Graphics substrate surface (native; the public surface lives on Term). */
  imageBegin(ct: number, id: number, w: number, h: number): number;
  imageCommit(ct: number, id: number): number;
  imageRemove(ct: number, id: number): number;
  graphicsCapability(ct: number, kitty: number): void;
  graphicsResizePrepare(ct: number): number;
  setPointer(x: number, y: number, down: boolean): void;
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
    init(mem: number, w: number, h: number, gfx: number): number;
    reduce(
      ct: number,
      buf: number,
      len: number,
      mode: number,
      row: number,
      deltaTime: number,
    ): void;
    output(ct: number): number;
    length(ct: number): number;
    graphics_size(poolBytes: number): number;
    graphics_init(mem: number, poolBytes: number): number;
    image_begin(ct: number, id: number, w: number, h: number): number;
    image_commit(ct: number, id: number): number;
    image_remove(ct: number, id: number): number;
    graphics_capability(ct: number, kitty: number): void;
    graphics_resize_prepare(ct: number): number;
    Clay_SetPointerState(vec: number, down: number): void;
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

  let statePtr!: number;
  let opsBuf = 0;
  let gfxPtr = 0;
  let gfxBytes = 0;

  // Linear memory layout: [heap: gfx carve][clayterm carve][opsBuf].
  // The gfx carve (Graphics Specification §5.1) is dimension-independent:
  // allocated once and never re-initialized, so the image registry, pixel
  // pool, and placements tables survive resize unchanged (§10.5). The
  // clayterm carve and opsBuf move on resize exactly as before
  // (renderer-spec 7.7): memory is grown to fit but never reclaimed.
  function layout(lw: number, lh: number): void {
    let heap = ct.__heap_base.value as number;
    if (gfxPtr === 0) {
      gfxBytes = ct.graphics_size(DEFAULT_IMAGE_POOL_BYTES);
      gfxPtr = heap;
      ct.graphics_init(gfxPtr, DEFAULT_IMAGE_POOL_BYTES);
    }
    let size = ct.clayterm_size(lw, lh);
    let clayBase = gfxPtr + gfxBytes;
    let needed = clayBase + size + transferBytes;
    let pages = Math.ceil(needed / WASM_PAGE_BYTES);
    let current = memory.buffer.byteLength / WASM_PAGE_BYTES;
    if (pages > current) {
      memory.grow(pages - current);
    }
    statePtr = ct.init(clayBase, lw, lh, gfxPtr);
    opsBuf = (clayBase + size + 3) & ~3;
  }
  layout(w, h);

  return {
    memory,
    get statePtr() {
      return statePtr;
    },
    get gfxPtr() {
      return gfxPtr;
    },
    get opsBuf() {
      return opsBuf;
    },
    update(uw: number, uh: number): void {
      layout(uw, uh);
    },
    reduce: ct.reduce,
    output: ct.output,
    length: ct.length,
    imageBegin: ct.image_begin,
    imageCommit: ct.image_commit,
    imageRemove: ct.image_remove,
    graphicsCapability: ct.graphics_capability,
    graphicsResizePrepare: ct.graphics_resize_prepare,
    animating: ct.animating,
    setPointer(x: number, y: number, down: boolean) {
      let view = new DataView(memory.buffer);
      view.setFloat32(opsBuf, x, true);
      view.setFloat32(opsBuf + 4, y, true);
      ct.Clay_SetPointerState(opsBuf, down ? 1 : 0);
    },
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
