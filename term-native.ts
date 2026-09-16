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

const MAX_FIXED_ELEMENT_WIRE_BYTES = 116;

/* Flag bits — must match TERMINFO_* in src/terminfo.h */
const FLAG_TRUECOLOR = 1 << 0;
const FLAG_SYNC = 1 << 6;

export interface Native {
  memory: WebAssembly.Memory;
  statePtr: number;
  opsBuf: number;
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
  setPointer(x: number, y: number, down: boolean): void;
  getPointerOverIds(): string[];
  getElementBounds(id: string): BoundingBox | undefined;
  animating(ct: number): number;
  errorCount(ct: number): number;
  errorType(ct: number, index: number): number;
  errorMessage(ct: number, index: number): string;
  /** Confirm (set/clear) a single capability flag on the private TermInfo struct. */
  confirmFlag(bit: number, on: boolean): void;
}

import { compiled } from "./wasm.ts";

export async function createTermNative(
  w: number,
  h: number,
  keys?: Uint8Array,
  trueColor?: boolean,
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
    init(mem: number, w: number, h: number, ti: number): number;
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
    terminfo_size(): number;
    terminfo_init(mem: number): number;
    terminfo_parse(bytes: number, len: number, ti: number): number;
    terminfo_grant(ti: number, flags: number): void;
    terminfo_confirm(ti: number, bit: number, on: number): void;
  };

  let transferBytes = TEXT_TRANSFER_BUFFER_BYTES +
    CLAY_DEFAULT_MAX_ELEMENT_COUNT * MAX_FIXED_ELEMENT_WIRE_BYTES;

  let heap = (ct.__heap_base.value as number + 7) & ~7;
  let top = heap;

  function grow(needed: number): void {
    let pages = Math.ceil(needed / WASM_PAGE_BYTES);
    let current = memory.buffer.byteLength / WASM_PAGE_BYTES;
    if (pages > current) memory.grow(pages - current);
  }

  function bump(size: number, align = 8): number {
    top = (top + align - 1) & ~(align - 1);
    let ptr = top;
    top += (size + 7) & ~7;
    grow(top);
    return ptr;
  }

  /* Allocate and initialize the private TermInfo struct. */
  let tiPtr = bump(ct.terminfo_size());
  ct.terminfo_init(tiPtr);

  if (keys && keys.byteLength > 0) {
    let keysPtr = bump(keys.byteLength);
    new Uint8Array(memory.buffer).set(keys, keysPtr);
    ct.terminfo_parse(keysPtr, keys.byteLength, tiPtr);
  }

  if (trueColor) {
    ct.terminfo_grant(tiPtr, FLAG_TRUECOLOR);
  }

  let statePtr!: number;
  let opsBuf = 0;

  function layout(lw: number, lh: number): void {
    let sz = ct.clayterm_size(lw, lh);
    let arena = bump(sz);
    if (!opsBuf) opsBuf = bump(transferBytes, 4);
    statePtr = ct.init(arena, lw, lh, tiPtr);
  }
  layout(w, h);

  return {
    memory,
    get statePtr() {
      return statePtr;
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
    animating: ct.animating,
    confirmFlag(bit: number, on: boolean): void {
      ct.terminfo_confirm(tiPtr, bit, on ? 1 : 0);
    },
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
      if (!found) return undefined;
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

export { FLAG_SYNC, FLAG_TRUECOLOR };
