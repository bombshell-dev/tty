import type { CursorShape } from "./termcodes.ts";

export type TransitionProperty =
  | "x"
  | "y"
  | "position"
  | "width"
  | "height"
  | "size"
  | "bg"
  | "overlay"
  | "borderColor"
  | "borderWidth"
  | "all";

export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut";

export interface Transition {
  duration: number;
  easing?: Easing;
  properties: TransitionProperty[];
  interactive?: boolean;
}

/* Command buffer opcodes — mirrors ops.h */
const OP_OPEN_ELEMENT = 0x02;
const OP_TEXT = 0x03;
const OP_CLOSE_ELEMENT = 0x04;
const OP_SNAPSHOT = 0x05;

/* Property group masks for OPEN_ELEMENT */
const PROP_LAYOUT = 0x01;
const PROP_BG_COLOR = 0x02;
const PROP_CORNER_RADIUS = 0x04;
const PROP_BORDER = 0x08;
const PROP_CLIP = 0x10;
const PROP_FLOATING = 0x20;
const PROP_TRANSITION = 0x40;

const encoder = new TextEncoder();

function packAxis(view: DataView, offset: number, axis: SizingAxis): number {
  let o = offset;
  switch (axis.type) {
    case "fit":
      view.setUint32(o, 0, true);
      o += 4;
      view.setFloat32(o, axis.min ?? 0, true);
      o += 4;
      view.setFloat32(o, axis.max ?? 0, true);
      o += 4;
      break;
    case "grow":
      view.setUint32(o, 1, true);
      o += 4;
      view.setFloat32(o, axis.min ?? 0, true);
      o += 4;
      view.setFloat32(o, axis.max ?? 0, true);
      o += 4;
      break;
    case "percent":
      view.setUint32(o, 2, true);
      o += 4;
      view.setFloat32(o, axis.value, true);
      o += 4;
      view.setFloat32(o, 0, true);
      o += 4;
      break;
    case "fixed":
      view.setUint32(o, 3, true);
      o += 4;
      view.setFloat32(o, axis.value, true);
      o += 4;
      view.setFloat32(o, 0, true);
      o += 4;
      break;
  }
  return o;
}

function sideWidth(side: BorderSide | undefined): number {
  return typeof side === "number" ? side : side?.width ?? 0;
}

function sideFg(side: BorderSide | undefined, shared: number): number {
  let color = typeof side === "object" && side.color !== undefined
    ? side.color
    : shared;
  return color & 0x00FFFFFF;
}

function sideBg(
  side: BorderSide | undefined,
  shared: number | undefined,
): number {
  let bg = typeof side === "object" && side.bg !== undefined ? side.bg : shared;
  // ATTR_DEFAULT sentinel (bit 31 set) means "keep the existing cell bg"
  return bg === undefined ? 0x80000000 : bg & 0x00FFFFFF;
}

function packString(
  view: DataView,
  bytes: Uint8Array,
  o: number,
  end: number,
  context: string,
): number {
  let paddedLength = Math.ceil(bytes.length / 4) * 4;
  let next = o + 4 + paddedLength;
  if (next > end) {
    throw new RangeError(
      `transfer buffer capacity exceeded while packing ${context} ` +
        `(${next} byte offset, ${end} byte limit). ` +
        `Render a smaller visible slice or reduce frame content.`,
    );
  }

  view.setUint32(o, bytes.length, true);
  o += 4;
  new Uint8Array(view.buffer).set(bytes, o);
  o += paddedLength;
  return o;
}

export function pack(
  ops: Op[],
  mem: ArrayBufferLike,
  offset: number,
  limit?: number,
): number {
  let view = new DataView(mem);
  let end = limit ?? mem.byteLength;
  let o = offset;

  for (let op of ops) {
    switch (op.directive) {
      case OP_CLOSE_ELEMENT:
        view.setUint32(o, op.directive, true);
        o += 4;
        break;

      case OP_OPEN_ELEMENT: {
        view.setUint32(o, OP_OPEN_ELEMENT, true);
        o += 4;

        let bytes = encoder.encode(op.id);
        o = packString(view, bytes, o, end, "element id");

        let mask = 0;
        if (op.layout) mask |= PROP_LAYOUT;
        if (op.bg !== undefined) mask |= PROP_BG_COLOR;
        if (op.cornerRadius) mask |= PROP_CORNER_RADIUS;
        if (op.border) mask |= PROP_BORDER;
        if (op.clip) mask |= PROP_CLIP;
        if (op.floating) mask |= PROP_FLOATING;
        if (op.transition) mask |= PROP_TRANSITION;
        view.setUint32(o, mask, true);
        o += 4;

        if (op.layout) {
          let l = op.layout;
          o = packAxis(view, o, l.width ?? { type: "fit" });
          o = packAxis(view, o, l.height ?? { type: "fit" });

          let p = l.padding ?? {};
          view.setUint32(
            o,
            (p.left ?? 0) | ((p.right ?? 0) << 8) | ((p.top ?? 0) << 16) |
              ((p.bottom ?? 0) << 24),
            true,
          );
          o += 4;

          view.setUint32(
            o,
            (l.gap ?? 0) | ((l.direction === "ttb" ? 1 : 0) << 16),
            true,
          );
          o += 4;

          let alignX = l.alignX === "right" ? 1 : l.alignX === "center" ? 2 : 0;

          let alignY = l.alignY === "bottom"
            ? 1
            : l.alignY === "center"
            ? 2
            : 0;

          view.setUint32(o, alignX | (alignY << 8), true);
          o += 4;
        }

        if (op.bg !== undefined) {
          view.setUint32(o, op.bg, true);
          o += 4;
        }

        if (op.cornerRadius) {
          let cr = op.cornerRadius;
          view.setUint32(
            o,
            (cr.tl ?? 0) | ((cr.tr ?? 0) << 8) | ((cr.bl ?? 0) << 16) |
              ((cr.br ?? 0) << 24),
            true,
          );
          o += 4;
        }

        if (op.border) {
          let b = op.border;
          view.setUint32(
            o,
            sideWidth(b.left) | (sideWidth(b.right) << 8) |
              (sideWidth(b.top) << 16) | (sideWidth(b.bottom) << 24),
            true,
          );
          o += 4;

          // Must match render_border() in src/clayterm.c.
          // Resolve CSS-like side fallbacks here, then write eight required
          // attribute words: fg/bg pairs in top, right, bottom, left order.
          // C treats the presence and order of these words as a wire-format
          // invariant and only consumes the explicit values.
          for (let side of [b.top, b.right, b.bottom, b.left]) {
            view.setUint32(o, sideFg(side, b.color), true);
            o += 4;
            view.setUint32(o, sideBg(side, b.bg), true);
            o += 4;
          }
        }

        if (op.clip) {
          view.setUint32(
            o,
            (op.clip.horizontal ? 1 : 0) | ((op.clip.vertical ? 1 : 0) << 8),
            true,
          );
          o += 4;
        }

        if (op.floating) {
          let f = op.floating;
          view.setFloat32(o, f.x ?? 0, true);
          o += 4;
          view.setFloat32(o, f.y ?? 0, true);
          o += 4;
          view.setFloat32(o, f.expand?.width ?? 0, true);
          o += 4;
          view.setFloat32(o, f.expand?.height ?? 0, true);
          o += 4;
          view.setUint32(o, f.parent ?? 0, true);
          o += 4;
          view.setUint32(
            o,
            encodeAttachTo(f.attachTo) |
              (encodeAttachPoint(f.attachPoints?.element) << 8) |
              (encodeAttachPoint(f.attachPoints?.parent) << 16) |
              (encodePointerCaptureMode(f.pointerCaptureMode) << 24),
            true,
          );
          o += 4;
          view.setUint32(
            o,
            encodeClipTo(f.clipTo) | (((f.zIndex ?? 0) & 0xffff) << 8),
            true,
          );
          o += 4;
        }

        if (op.transition) {
          let t = op.transition;
          let pmask = 0;
          for (let name of t.properties) pmask |= propertyMask(name);

          view.setFloat32(o, t.duration, true);
          o += 4;
          view.setUint16(o, pmask, true);
          o += 2;
          view.setUint8(o, easingByte(t.easing ?? "linear"));
          o += 1;
          view.setUint8(o, t.interactive ? 1 : 0);
          o += 1;
        }
        break;
      }

      case OP_SNAPSHOT: {
        new Uint8Array(mem).set(op.data, o);
        o += op.data.length;
        break;
      }

      case OP_TEXT: {
        view.setUint32(o, OP_TEXT, true);
        o += 4;
        // No explicit color: leave the terminal default foreground by writing
        // 0 and setting ATTR_DEFAULT (0x80 in the attrs byte). The C path ORs
        // it into fg and emit_attr skips the foreground SGR (mirrors unset bg).
        let textDefault = op.color === undefined;
        view.setUint32(o, op.color ?? 0, true);
        o += 4;

        // No explicit bg: leave the terminal default bg by writing
        // 0 and setting ATTR_DEFAULT (0x80 in the attrs byte). The C path ORs
        // it into bg and emit_attr skips the background SGR
        let bg = op.bg === undefined ? 0x80000000 : op.bg & 0x00FFFFFF;
        view.setUint32(o, bg, true);
        o += 4;

        view.setUint32(
          o,
          (op.fontSize ?? 1) |
            ((op.fontId ?? 0) << 8) |
            ((op.wrap ?? 0) << 16) |
            (((op.attrs ?? 0) | (textDefault ? 0x80 : 0)) << 24),
          true,
        );
        o += 4;

        let str = encoder.encode(op.content);
        o = packString(view, str, o, end, "text content");
        break;
      }
    }
    if (o > end) {
      throw new RangeError(
        `ops exceed buffer capacity (${o - offset} bytes packed, ${
          end - offset
        } available)`,
      );
    }
  }

  return (o - offset) / 4;
}

export function rgba(r: number, g: number, b: number, a = 255): number {
  return ((a & 0xFF) << 24) | ((r & 0xFF) << 16) | ((g & 0xFF) << 8) |
    (b & 0xFF);
}

export type SizingAxis =
  | { type: "fit"; min?: number; max?: number }
  | { type: "grow"; min?: number; max?: number }
  | { type: "percent"; value: number }
  | { type: "fixed"; value: number };

export const fit = (min = 0, max = 0): SizingAxis => ({
  type: "fit",
  min,
  max,
});
export const grow = (min = 0, max = 0): SizingAxis => ({
  type: "grow",
  min,
  max,
});
export const percent = (value: number): SizingAxis => ({
  type: "percent",
  value,
});
export const fixed = (value: number): SizingAxis => ({ type: "fixed", value });

export interface CloseElement {
  directive: typeof OP_CLOSE_ELEMENT;
}

export type BorderSide =
  | number
  | {
    width: number;
    color?: number;
    bg?: number;
  };

export interface OpenElement {
  directive: typeof OP_OPEN_ELEMENT;
  id: string;
  layout?: {
    width?: SizingAxis;
    height?: SizingAxis;
    padding?: { left?: number; right?: number; top?: number; bottom?: number };
    gap?: number;
    direction?: "ltr" | "ttb";
    alignX?: "left" | "center" | "right";
    alignY?: "top" | "center" | "bottom";
  };
  bg?: number;
  cornerRadius?: { tl?: number; tr?: number; bl?: number; br?: number };
  border?: {
    color: number;
    bg?: number;
    left?: BorderSide;
    right?: BorderSide;
    top?: BorderSide;
    bottom?: BorderSide;
  };
  clip?: { horizontal?: boolean; vertical?: boolean };
  /**
   * Mouse pointer shape to request while the pointer is over this element.
   *
   * This is a pure annotation: it does not affect layout or output and is not
   * sent to the WASM module. It is consumed only when pointer-shape tracking is
   * enabled via the `trackCursor` render option.
   */
  cursor?: CursorShape;
  floating?: {
    x?: number;
    y?: number;
    expand?: { width?: number; height?: number };
    parent?: number;
    attachTo?: AttachTo;
    attachPoints?: { element?: AttachPoint; parent?: AttachPoint };
    pointerCaptureMode?: PointerCaptureMode;
    clipTo?: ClipTo;
    zIndex?: number;
  };
  transition?: Transition;
}

export type AttachPoint =
  | "left-top"
  | "left-center"
  | "left-bottom"
  | "center-top"
  | "center-center"
  | "center-bottom"
  | "right-top"
  | "right-center"
  | "right-bottom";

export type AttachTo = "none" | "parent" | "element" | "root";

export type PointerCaptureMode = "capture" | "passthrough";

export type ClipTo = "none" | "attached-parent";

const ATTACH_POINT: Record<AttachPoint, number> = {
  "left-top": 0,
  "left-center": 1,
  "left-bottom": 2,
  "center-top": 3,
  "center-center": 4,
  "center-bottom": 5,
  "right-top": 6,
  "right-center": 7,
  "right-bottom": 8,
};

const ATTACH_TO: Record<AttachTo, number> = {
  none: 0,
  parent: 1,
  element: 2,
  root: 3,
};

const POINTER_CAPTURE_MODE: Record<PointerCaptureMode, number> = {
  capture: 0,
  passthrough: 1,
};

const CLIP_TO: Record<ClipTo, number> = {
  none: 0,
  "attached-parent": 1,
};

function encodeAttachPoint(value: AttachPoint | undefined): number {
  return value === undefined ? 0 : ATTACH_POINT[value];
}

function encodeAttachTo(value: AttachTo | undefined): number {
  return value === undefined ? 0 : ATTACH_TO[value];
}

function encodePointerCaptureMode(
  value: PointerCaptureMode | undefined,
): number {
  return value === undefined ? 0 : POINTER_CAPTURE_MODE[value];
}

function encodeClipTo(value: ClipTo | undefined): number {
  return value === undefined ? 0 : CLIP_TO[value];
}

export interface Text {
  directive: typeof OP_TEXT;
  content: string;
  color?: number;
  bg?: number;
  fontSize?: number;
  fontId?: number;
  wrap?: number;
  attrs?: number;
}

interface Snapshot {
  directive: typeof OP_SNAPSHOT;
  data: Uint8Array;
}

export type Op = OpenElement | Text | CloseElement | Snapshot;

export function open(
  id: string,
  props: Omit<OpenElement, "directive" | "id"> = {},
): OpenElement {
  return { directive: OP_OPEN_ELEMENT, id, ...props };
}

export function text(
  content: string,
  props: Omit<Text, "directive" | "content"> = {},
): Text {
  return { directive: OP_TEXT, content, ...props };
}

export function close(): CloseElement {
  return { directive: OP_CLOSE_ELEMENT };
}

/** Narrow an `Op` to an element-open directive. */
export function isOpen(op: Op): op is OpenElement {
  return op.directive === OP_OPEN_ELEMENT;
}

function packSize(ops: Op[]): number {
  let n = 0;
  for (let op of ops) {
    switch (op.directive) {
      case OP_CLOSE_ELEMENT:
        n += 4;
        break;
      case OP_SNAPSHOT:
        n += op.data.length;
        break;
      case OP_OPEN_ELEMENT: {
        n += 4; // opcode
        n += 4 + Math.ceil(encoder.encode(op.id).length / 4) * 4; // id string
        n += 4; // mask
        if (op.layout) n += 6 * 4 + 4 + 4 + 4; // 2 axes (3 words each) + pad + gap + align
        if (op.bg !== undefined) n += 4;
        if (op.cornerRadius) n += 4;
        if (op.border) n += 36; // widths word + 4 sides × (fg + bg)
        if (op.clip) n += 4;
        // x, y, expand width/height, parent, attach/pointer, clip/z
        if (op.floating) n += 7 * 4;
        if (op.transition) n += 8;
        break;
      }
      case OP_TEXT: {
        n += 4 + 4 + 4 + 4; // opcode + color + bg + cfg
        n += 4 + Math.ceil(encoder.encode(op.content).length / 4) * 4; // string
        break;
      }
    }
  }
  return n;
}

export function snapshot(ops: Op[]): Op {
  let size = packSize(ops);
  let buf = new ArrayBuffer(size);
  let words = pack(ops, buf, 0, size);
  return { directive: OP_SNAPSHOT, data: new Uint8Array(buf, 0, words * 4) };
}

const TP_X = 1;
const TP_Y = 2;
const TP_WIDTH = 4;
const TP_HEIGHT = 8;
const TP_BG = 16;
const TP_OVERLAY = 32;
const TP_BORDER_COLOR = 128;
const TP_BORDER_WIDTH = 256;

const TP_POSITION = TP_X | TP_Y;
const TP_SIZE = TP_WIDTH | TP_HEIGHT;
const TP_ALL = TP_X | TP_Y | TP_WIDTH | TP_HEIGHT |
  TP_BG | TP_OVERLAY | TP_BORDER_COLOR | TP_BORDER_WIDTH;

function propertyMask(name: TransitionProperty): number {
  switch (name) {
    case "x":
      return TP_X;
    case "y":
      return TP_Y;
    case "position":
      return TP_POSITION;
    case "width":
      return TP_WIDTH;
    case "height":
      return TP_HEIGHT;
    case "size":
      return TP_SIZE;
    case "bg":
      return TP_BG;
    case "overlay":
      return TP_OVERLAY;
    case "borderColor":
      return TP_BORDER_COLOR;
    case "borderWidth":
      return TP_BORDER_WIDTH;
    case "all":
      return TP_ALL;
  }
}

const EASING_LINEAR = 0;
const EASING_EASE_IN = 1;
const EASING_EASE_OUT = 2;
const EASING_EASE_IN_OUT = 3;

function easingByte(easing: Easing): number {
  switch (easing) {
    case "linear":
      return EASING_LINEAR;
    case "easeIn":
      return EASING_EASE_IN;
    case "easeOut":
      return EASING_EASE_OUT;
    case "easeInOut":
      return EASING_EASE_IN_OUT;
  }
}
