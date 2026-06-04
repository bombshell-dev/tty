import { describe, expect, it } from "./suite.ts";
import * as mod from "../mod.ts";

// stringWidth/charWidth are not exported yet. Cast keeps this type-checking
// (the cast makes them `any`) while the runtime values are `undefined` today,
// so calling them throws -> the assertions below fail at runtime, not compile.
let charWidth = (mod as Record<string, unknown>).charWidth as (
  cp: number,
) => number;
let stringWidth = (mod as Record<string, unknown>).stringWidth as (
  s: string,
) => number;

describe("display-width helpers", () => {
  it("charWidth returns terminal cell columns per codepoint", () => {
    expect(charWidth(0x41)).toBe(1); // 'A' ASCII occupies 1 cell
    expect(charWidth(0x4f60)).toBe(2); // CJK 你 is wide -> 2 cells
    expect(charWidth(0x301)).toBe(0); // combining acute (Mn) -> 0 cells
    expect(charWidth(0x07)).toBe(0); // BEL control clamped to 0, not -1
  });

  it("stringWidth sums per-codepoint display width", () => {
    expect(stringWidth("hello")).toBe(5); // 5 ASCII cells
    expect(stringWidth("你好")).toBe(4); // two wide CJK -> 4 cells
    expect(stringWidth("🍔")).toBe(2); // astral emoji is wide -> 2 cells
  });

  it("stringWidth ignores zero-width combining marks", () => {
    // decomposed: 'e' (U+0065) + combining acute (U+0301), not precomposed U+00E9
    expect(stringWidth("é")).toBe(1); // 1 (e) + 0 (mark) = 1 cell
  });

  it("stringWidth treats a VS16 emoji cluster as 2 cells", () => {
    // U+2764 (1) + U+FE0F (0): VS16 promotes the cluster to emoji width
    expect(stringWidth("❤️")).toBe(2);
  });
});
