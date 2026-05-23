/* Command buffer opcodes — mirrors ops.h */
const OP_OPEN_ELEMENT = 0x02;
const OP_TEXT = 0x03;
const OP_CLOSE_ELEMENT = 0x04;

/* Property group masks for OPEN_ELEMENT */
const PROP_LAYOUT = 0x01;
const PROP_BG_COLOR = 0x02;
const PROP_CORNER_RADIUS = 0x04;
const PROP_BORDER = 0x08;
const PROP_CLIP = 0x10;
const PROP_FLOATING = 0x20;

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

function packString(view: DataView, bytes: Uint8Array, o: number): number {
  view.setUint32(o, bytes.length, true);
  o += 4;
  new Uint8Array(view.buffer).set(bytes, o);
  o += Math.ceil(bytes.length / 4) * 4;
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
        o = packString(view, bytes, o);

        let mask = 0;
        if (op.layout) mask |= PROP_LAYOUT;
        if (op.bg !== undefined) mask |= PROP_BG_COLOR;
        if (op.cornerRadius) mask |= PROP_CORNER_RADIUS;
        if (op.border) mask |= PROP_BORDER;
        if (op.clip) mask |= PROP_CLIP;
        if (op.floating) mask |= PROP_FLOATING;
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

          view.setUint32(o, (l.alignX ?? 0) | ((l.alignY ?? 0) << 8), true);
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
          view.setUint32(o, b.color, true);
          o += 4;
          view.setUint32(
            o,
            (b.left ?? 0) | ((b.right ?? 0) << 8) | ((b.top ?? 0) << 16) |
              ((b.bottom ?? 0) << 24),
            true,
          );
          o += 4;
        }

        if (op.clip) {
          let xm = op.clip.x !== undefined ? 1 : 0;
          let ym = op.clip.y !== undefined ? 1 : 0;
          view.setUint32(o, xm | (ym << 8), true);
          o += 4;
          if (xm) {
            view.setFloat32(o, op.clip.x!, true);
            o += 4;
          }
          if (ym) {
            view.setFloat32(o, op.clip.y!, true);
            o += 4;
          }
        }

        if (op.floating) {
          let f = op.floating;
          view.setFloat32(o, f.x ?? 0, true);
          o += 4;
          view.setFloat32(o, f.y ?? 0, true);
          o += 4;
          view.setUint32(o, f.parent ?? 0, true);
          o += 4;
          view.setUint32(
            o,
            (f.attachTo ?? 0) | ((f.attachPoints ?? 0) << 8) |
              ((f.zIndex ?? 0) << 16),
            true,
          );
          o += 4;
        }
        break;
      }

      case OP_TEXT: {
        view.setUint32(o, OP_TEXT, true);
        o += 4;
        view.setUint32(o, op.color ?? 0xFFFFFFFF, true);
        o += 4;
        view.setUint32(
          o,
          (op.fontSize ?? 1) |
            ((op.fontId ?? 0) << 8) |
            ((op.wrap ?? 0) << 16) |
            ((op.attrs ?? 0) << 24),
          true,
        );
        o += 4;

        let str = encoder.encode(op.content);
        o = packString(view, str, o);
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

export interface OpenElement {
  directive: typeof OP_OPEN_ELEMENT;
  id: string;
  layout?: {
    width?: SizingAxis;
    height?: SizingAxis;
    padding?: { left?: number; right?: number; top?: number; bottom?: number };
    gap?: number;
    direction?: "ltr" | "ttb";
    alignX?: number;
    alignY?: number;
  };
  bg?: number;
  cornerRadius?: { tl?: number; tr?: number; bl?: number; br?: number };
  border?: {
    color: number;
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
  };
  clip?: { x?: number; y?: number };
  floating?: {
    x?: number;
    y?: number;
    parent?: number;
    attachTo?: number;
    attachPoints?: number;
    zIndex?: number;
  };
}

export interface Text {
  directive: typeof OP_TEXT;
  content: string;
  color?: number;
  fontSize?: number;
  fontId?: number;
  wrap?: number;
  attrs?: number;
}

export type Op = OpenElement | Text | CloseElement;

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
