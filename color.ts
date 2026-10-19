import { convert, parse } from "hueful";

/**
 * A §8.5 terminal-themed color: an ANSI palette index (0–15), or a default
 * keyword naming the terminal default foreground ("fg-default") or
 * background ("bg-default"). Which default it names is fixed by the
 * keyword; whether it stays terminal-themed or resolves to a probed sRGB
 * color depends on the field it's packed into (see resolveForField).
 */
export interface TerminalColor {
  ansi: number | "fg-default" | "bg-default";
}

/** An 8-bit RGB color, structurally compatible with terminfo.ts's Rgb. */
export interface ThemeRgb {
  r: number;
  g: number;
  b: number;
}

/** The theme colors `pack()` resolves cross-field default keywords against. */
export interface ThemeColors {
  readonly foreground?: ThemeRgb;
  readonly background?: ThemeRgb;
}

export const systemColors = {
  canvas: "bg-default",
  buttonface: "bg-default",
  field: "bg-default",
  canvastext: "fg-default",
  buttontext: "fg-default",
  fieldtext: "fg-default",
  activetext: 1,
  mark: 3,
  linktext: 4,
  highlight: 4,
  selecteditem: 4,
  visitedtext: 5,
  accentcolor: 6,
  graytext: 8,
  buttonborder: 8,
  highlighttext: 15,
  selecteditemtext: 15,
  marktext: 0,
  accentcolortext: 0,
} as const satisfies Record<string, TerminalColor["ansi"]>;

function byte(unit: number): number {
  return Math.round(Math.min(Math.max(unit, 0), 1) * 255);
}

/**
 * A §8.5 `currentcolor` sentinel. In a `color` field it means "inherit"; in
 * any other field it means "this directive's own resolved color." Both
 * substitutions happen in `pack()`'s inheritance stack (ops.ts), not here.
 */
export const CURRENT_COLOR: { readonly current: true } = { current: true };
export type CurrentColor = typeof CURRENT_COLOR;

/** Narrows a `resolveColor()` result to the `currentcolor` sentinel. */
export function isCurrentColor(
  value: number | TerminalColor | CurrentColor,
): value is CurrentColor {
  return typeof value === "object" && "current" in value;
}

/**
 * Resolves a §8.5 CSS color string to the packed ARGB number the transfer
 * encoding carries, a terminal-themed color for a system color keyword, the
 * `currentcolor` sentinel, or `undefined` when the string is not a supported
 * color. Channels clamp to the sRGB range, so out-of-gamut colors clip per
 * channel.
 */
export function resolveColor(
  input: string,
): number | TerminalColor | CurrentColor | undefined {
  let lower = input.toLowerCase();
  if (lower === "currentcolor") return CURRENT_COLOR;
  if (Object.hasOwn(systemColors, lower)) {
    return { ansi: systemColors[lower as keyof typeof systemColors] };
  }
  let parsed = parse(input);
  if (parsed === null || parsed.space === "cmyk") return undefined;
  let [r, g, b, alpha = 1] = convert(parsed.space, "rgb", parsed.value);
  return (byte(alpha) << 24) | (byte(r / 255) << 16) | (byte(g / 255) << 8) |
    byte(b / 255);
}

/**
 * Resolves a terminal-themed color for the field it was packed into (§8.5).
 * A same-field default keyword and a palette entry stay terminal-themed. A
 * cross-field default keyword (a fg-default keyword in a bg field, or a
 * bg-default keyword in a fg field) resolves to the probed theme color for
 * the attribute it names, packed as an ordinary opaque ARGB number; absent
 * that probe, it falls back to the field's own terminal default.
 */
export function resolveForField(
  color: TerminalColor,
  field: "fg" | "bg",
  theme: ThemeColors | undefined,
): number | TerminalColor {
  let { ansi } = color;
  if (ansi !== "fg-default" && ansi !== "bg-default") return color;
  if (
    (ansi === "fg-default" && field === "fg") ||
    (ansi === "bg-default" && field === "bg")
  ) {
    return color;
  }
  let rgb = ansi === "fg-default" ? theme?.foreground : theme?.background;
  if (rgb === undefined) {
    return { ansi: field === "fg" ? "fg-default" : "bg-default" };
  }
  return (255 << 24) | (rgb.r << 16) | (rgb.g << 8) | rgb.b;
}
