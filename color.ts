import { convert, parse } from "hueful";

/**
 * A §8.5 terminal-themed color: an ANSI palette index (0–15), or the
 * terminal default color of whichever attribute the field sets.
 */
export interface TerminalColor {
  ansi: number | "default";
}

export const systemColors = {
  canvas: "default",
  buttonface: "default",
  field: "default",
  canvastext: "default",
  buttontext: "default",
  fieldtext: "default",
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
 * Resolves a §8.5 CSS color string to the packed ARGB number the transfer
 * encoding carries, a terminal-themed color for a system color keyword, or
 * `undefined` when the string is not a supported color. Channels clamp to
 * the sRGB range, so out-of-gamut colors clip per channel.
 */
export function resolveColor(
  input: string,
): number | TerminalColor | undefined {
  let lower = input.toLowerCase();
  if (Object.hasOwn(systemColors, lower)) {
    return { ansi: systemColors[lower as keyof typeof systemColors] };
  }
  let parsed = parse(input);
  if (parsed === null || parsed.space === "cmyk") return undefined;
  let [r, g, b, alpha = 1] = convert(parsed.space, "rgb", parsed.value);
  return (byte(alpha) << 24) | (byte(r / 255) << 16) | (byte(g / 255) << 8) |
    byte(b / 255);
}
