import { Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import type { Op } from "./ops.ts";
import type { RenderOptions, RenderResult, Term } from "./term.ts";

/* ── Range helpers (match bit-packing in pack()) ──────────────────── */

const u8 = Type.Integer({ minimum: 0, maximum: 255 });
const u16 = Type.Integer({ minimum: 0, maximum: 65535 });

/* RGBA color packed as (a << 24 | r << 16 | g << 8 | b). When alpha >= 128,
 * bit 31 is set and JavaScript interprets the value as a negative int32.
 * Accept both signed and unsigned representations of the same bit pattern. */
const rgba = Type.Integer({ minimum: -0x80000000, maximum: 0xFFFFFFFF });

/* ── Sizing axis (discriminated union) ────────────────────────────── */

const Fit = Type.Object({
  type: Type.Literal("fit"),
  min: Type.Optional(Type.Number()),
  max: Type.Optional(Type.Number()),
});

const Grow = Type.Object({
  type: Type.Literal("grow"),
  min: Type.Optional(Type.Number()),
  max: Type.Optional(Type.Number()),
});

const Percent = Type.Object({
  type: Type.Literal("percent"),
  value: Type.Number(),
});

const Fixed = Type.Object({
  type: Type.Literal("fixed"),
  value: Type.Number(),
});

const SizingAxis = Type.Union([Fit, Grow, Percent, Fixed]);

/* ── Sub-objects ──────────────────────────────────────────────────── */

const Padding = Type.Object({
  left: Type.Optional(u8),
  right: Type.Optional(u8),
  top: Type.Optional(u8),
  bottom: Type.Optional(u8),
});

const Layout = Type.Object({
  width: Type.Optional(SizingAxis),
  height: Type.Optional(SizingAxis),
  padding: Type.Optional(Padding),
  gap: Type.Optional(u16),
  direction: Type.Optional(
    Type.Union([Type.Literal("ltr"), Type.Literal("ttb")]),
  ),
  alignX: Type.Optional(u8),
  alignY: Type.Optional(u8),
});

const CornerRadius = Type.Object({
  tl: Type.Optional(u8),
  tr: Type.Optional(u8),
  bl: Type.Optional(u8),
  br: Type.Optional(u8),
});

const Border = Type.Object({
  color: rgba,
  left: Type.Optional(u8),
  right: Type.Optional(u8),
  top: Type.Optional(u8),
  bottom: Type.Optional(u8),
});

const Clip = Type.Object({
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
});

const Floating = Type.Object({
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  parent: Type.Optional(Type.Integer({ minimum: 0 })),
  attachTo: Type.Optional(u8),
  attachPoints: Type.Optional(u8),
  zIndex: Type.Optional(u16),
});

/* ── Op types (discriminated on `directive`) ──────────────────────── */

const CloseElement = Type.Object({ directive: Type.Literal(0x04) });

const OpenElement = Type.Object({
  directive: Type.Literal(0x02),
  id: Type.String(),
  layout: Type.Optional(Layout),
  bg: Type.Optional(rgba),
  cornerRadius: Type.Optional(CornerRadius),
  border: Type.Optional(Border),
  clip: Type.Optional(Clip),
  floating: Type.Optional(Floating),
});

const TextOp = Type.Object({
  directive: Type.Literal(0x03),
  content: Type.String(),
  color: Type.Optional(rgba),
  fontSize: Type.Optional(u8),
  fontId: Type.Optional(u8),
  wrap: Type.Optional(u8),
  attrs: Type.Optional(u8),
});

const Ops = Type.Array(Type.Union([OpenElement, TextOp, CloseElement]));

/* ── Compiled validator ───────────────────────────────────────────── */

const compiled = TypeCompiler.Compile(Ops);

export function validate(ops: unknown): ops is Op[] {
  return compiled.Check(ops);
}

export function assert(ops: unknown): asserts ops is Op[] {
  if (!compiled.Check(ops)) {
    let errors = [...compiled.Errors(ops)];
    let msg = errors
      .slice(0, 5)
      .map((e) => `${e.path}: ${e.message}`)
      .join("\n");
    throw new TypeError(`Invalid ops:\n${msg}`);
  }
}

/* ── Term wrapper ─────────────────────────────────────────────────── */

export function validated(term: Term): Term {
  return {
    render(ops: Op[], options?: RenderOptions): RenderResult {
      assert(ops);
      return term.render(ops, options);
    },
  };
}
