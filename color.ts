import { convert, parse } from "hueful";

function byte(unit: number): number {
  return Math.round(Math.min(Math.max(unit, 0), 1) * 255);
}

/**
 * Resolves a §8.5 CSS color string to the packed ARGB number the transfer
 * encoding carries, or `undefined` when the string is not a supported color.
 * Channels clamp to the sRGB range, so out-of-gamut colors clip per channel.
 */
export function resolveColor(input: string): number | undefined {
  let parsed = parse(input);
  if (parsed === null || parsed.space === "cmyk") return undefined;
  let [r, g, b, alpha = 1] = convert(parsed.space, "rgb", parsed.value);
  return (byte(alpha) << 24) | (byte(r / 255) << 16) | (byte(g / 255) << 8) |
    byte(b / 255);
}
