export const EVENT_KEY = 1;
export const EVENT_MOUSE = 2;
export const EVENT_RESIZE = 3;
export const EVENT_CURSOR = 4;

export const MOD_ALT = 1;
export const MOD_CTRL = 2;
export const MOD_SHIFT = 4;
export const MOD_MOTION = 8;
export const MOD_RELEASE = 16;

export const KEY_F1 = 0xFFFF;
export const KEY_F2 = 0xFFFE;
export const KEY_F3 = 0xFFFD;
export const KEY_F4 = 0xFFFC;
export const KEY_F5 = 0xFFFB;
export const KEY_F6 = 0xFFFA;
export const KEY_F7 = 0xFFF9;
export const KEY_F8 = 0xFFF8;
export const KEY_F9 = 0xFFF7;
export const KEY_F10 = 0xFFF6;
export const KEY_F11 = 0xFFF5;
export const KEY_F12 = 0xFFF4;
export const KEY_ARROW_UP = 0xFFF3;
export const KEY_ARROW_DOWN = 0xFFF2;
export const KEY_ARROW_LEFT = 0xFFF1;
export const KEY_ARROW_RIGHT = 0xFFF0;
export const KEY_HOME = 0xFFEF;
export const KEY_END = 0xFFEE;
export const KEY_INSERT = 0xFFED;
export const KEY_DELETE = 0xFFEC;
export const KEY_PGUP = 0xFFEB;
export const KEY_PGDN = 0xFFEA;
export const KEY_BACKTAB = 0xFFE9;
export const KEY_NUMPAD_0 = 0xFFE2;
export const KEY_NUMPAD_1 = 0xFFE1;
export const KEY_NUMPAD_2 = 0xFFE0;
export const KEY_NUMPAD_3 = 0xFFDF;
export const KEY_NUMPAD_4 = 0xFFDE;
export const KEY_NUMPAD_5 = 0xFFDD;
export const KEY_NUMPAD_6 = 0xFFDC;
export const KEY_NUMPAD_7 = 0xFFDB;
export const KEY_NUMPAD_8 = 0xFFDA;
export const KEY_NUMPAD_9 = 0xFFD9;
export const KEY_NUMPAD_DECIMAL = 0xFFD8;
export const KEY_NUMPAD_DIVIDE = 0xFFD7;
export const KEY_NUMPAD_MULTIPLY = 0xFFD6;
export const KEY_NUMPAD_SUBTRACT = 0xFFD5;
export const KEY_NUMPAD_ADD = 0xFFD4;
export const KEY_NUMPAD_ENTER = 0xFFD3;
export const KEY_NUMPAD_EQUAL = 0xFFD2;

export const KEY_SHIFT_LEFT = 0xFFD1;
export const KEY_SHIFT_RIGHT = 0xFFD0;
export const KEY_CONTROL_LEFT = 0xFFCF;
export const KEY_CONTROL_RIGHT = 0xFFCE;
export const KEY_ALT_LEFT = 0xFFCD;
export const KEY_ALT_RIGHT = 0xFFCC;
export const KEY_SUPER_LEFT = 0xFFCB;
export const KEY_SUPER_RIGHT = 0xFFCA;
export const KEY_HYPER_LEFT = 0xFFC9;
export const KEY_HYPER_RIGHT = 0xFFC8;
export const KEY_META_LEFT = 0xFFC7;
export const KEY_META_RIGHT = 0xFFC6;
export const KEY_CAPS_LOCK = 0xFFC5;
export const KEY_NUM_LOCK = 0xFFC4;
export const KEY_SCROLL_LOCK = 0xFFC3;

export const KEY_MOUSE_LEFT = 0xFFE8;
export const KEY_MOUSE_RIGHT = 0xFFE7;
export const KEY_MOUSE_MIDDLE = 0xFFE6;
export const KEY_MOUSE_RELEASE = 0xFFE5;
export const KEY_MOUSE_WHEEL_UP = 0xFFE4;
export const KEY_MOUSE_WHEEL_DOWN = 0xFFE3;
export const KEY_ESC = 0x1B;
export const KEY_ENTER = 0x0D;
export const KEY_TAB = 0x09;
export const KEY_BACKSPACE = 0x7F;
export const KEY_SPACE = 0x20;

import {
  array,
  int32,
  offsets,
  struct,
  uint16,
  uint32,
  uint8,
} from "./typedef.ts";

const MAX_TEXT_CODEPOINTS = 8;

const InputEventLayout = struct({
  type: uint8(),
  mod: uint8(),
  key: uint16(),
  ch: uint32(),
  x: int32(),
  y: int32(),
  w: int32(),
  h: int32(),
  action: uint8(),
  shifted: uint32(),
  base: uint32(),
  text: array(uint32(), MAX_TEXT_CODEPOINTS),
  text_len: uint8(),
});

const {
  type: OFFSET_TYPE,
  mod: OFFSET_MOD,
  key: OFFSET_KEY,
  ch: OFFSET_CH,
  x: OFFSET_X,
  y: OFFSET_Y,
  w: OFFSET_W,
  h: OFFSET_H,
  action: OFFSET_ACTION,
  text_len: OFFSET_TEXT_LEN,
  shifted: OFFSET_SHIFTED,
  base: OFFSET_BASE,
  text: OFFSET_TEXT,
} = offsets(InputEventLayout);

export interface NativeInputEvent {
  type: number;
  mod: number;
  key: number;
  ch: number;
  x: number;
  y: number;
  w: number;
  h: number;
  action: number;
  shifted: number;
  base: number;
  text: number[];
}

export function readEvent(view: DataView, ptr: number): NativeInputEvent {
  let len = view.getUint8(ptr + OFFSET_TEXT_LEN);
  let text: number[] = [];
  for (let i = 0; i < len && i < MAX_TEXT_CODEPOINTS; i++) {
    text.push(view.getUint32(ptr + OFFSET_TEXT + i * 4, true));
  }
  return {
    type: view.getUint8(ptr + OFFSET_TYPE),
    mod: view.getUint8(ptr + OFFSET_MOD),
    key: view.getUint16(ptr + OFFSET_KEY, true),
    ch: view.getUint32(ptr + OFFSET_CH, true),
    x: view.getInt32(ptr + OFFSET_X, true),
    y: view.getInt32(ptr + OFFSET_Y, true),
    w: view.getInt32(ptr + OFFSET_W, true),
    h: view.getInt32(ptr + OFFSET_H, true),
    action: view.getUint8(ptr + OFFSET_ACTION),
    shifted: view.getUint32(ptr + OFFSET_SHIFTED, true),
    base: view.getUint32(ptr + OFFSET_BASE, true),
    text,
  };
}

export interface InputNative {
  memory: WebAssembly.Memory;
  state: number;
  buffer: number;
  scan(st: number, buf: number, len: number, now: number): number;
  count(st: number): number;
  event(st: number, index: number): number;
  delay(st: number): number;
}

import { compiled } from "./input.wasm.ts";

export async function createInputNative(
  escLatency: number,
): Promise<InputNative> {
  let memory = new WebAssembly.Memory({ initial: 4 });

  let instance = await WebAssembly.instantiate(compiled, {
    env: { memory },
  });

  let exports = instance.exports as unknown as {
    __heap_base: WebAssembly.Global;
    input_size(): number;
    input_init(mem: number, escLatency: number): number;
    input_scan(st: number, buf: number, len: number, now: number): number;
    input_count(st: number): number;
    input_event(st: number, index: number): number;
    input_delay(st: number): number;
  };

  let heap = exports.__heap_base.value as number;
  let size = exports.input_size();
  let state = exports.input_init(heap, escLatency);
  let buffer = (heap + size + 7) & ~7;

  return {
    memory,
    state,
    buffer,
    scan: exports.input_scan,
    count: exports.input_count,
    event: exports.input_event,
    delay: exports.input_delay,
  };
}

// Compiled terminfo entries are limited to 4096 bytes (legacy) or 32768
// bytes (extended ncurses format). We use the extended limit as our upper
// bound. See https://man7.org/linux/man-pages/man5/term.5.html
export const MAX_TERMINFO = 32768;

// Must match SCAN_BUFFER_SIZE in input.c — the maximum bytes input_scan()
// can accept in a single call.
export const SCAN_BUFFER_SIZE = 4096;
