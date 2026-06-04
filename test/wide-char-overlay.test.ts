import { beforeEach, describe, expect, it } from "./suite.ts";
import { createTerm, type Term } from "../term.ts";
import { close, fixed, grow, open, text } from "../ops.ts";
import { print } from "./print.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe("wide-char trailing overlay", () => {
  let term: Term;
  beforeEach(async () => {
    term = await createTerm({ width: 12, height: 1 });
  });

  it("overlay on a wide char's trailing column clears the orphaned lead to a space", () => {
    // X is floated onto col 1, the trailing column of 你 (cols 0-1).
    let out = print(
      decode(
        term.render([
          open("root", { layout: { width: grow(), height: grow() } }),
          text("你好"),
          open("ov", {
            floating: { x: 1, y: 0, attachTo: 3 },
            layout: { width: fixed(1), height: fixed(1) },
          }),
          text("X"),
          close(),
          close(),
        ]).output,
      ),
      12,
      1,
    );
    // pins: half-overwritten 你 collapses to a space, X lands at col 1, 好 untouched at 2-3.
    expect(out).toBe(" X好         ");
  });

  it("emits an explicit byte for an overlay landing on a placeholder column", () => {
    let ansi = decode(
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        text("你好"),
        open("ov", {
          floating: { x: 1, y: 0, attachTo: 3 },
          layout: { width: fixed(1), height: fixed(1) },
        }),
        text("X"),
        close(),
        close(),
      ]).output,
    );
    // pins: the overlay glyph reaches the byte stream rather than being swallowed by the column skip.
    expect(ansi).toContain("X");
  });
});
