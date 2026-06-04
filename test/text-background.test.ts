import { beforeEach, describe, expect, it } from "./suite.ts";
import { createTerm, type Term } from "../term.ts";
import { close, grow, open, rgba, text } from "../ops.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe("text background color", () => {
  let term: Term;
  beforeEach(async () => {
    term = await createTerm({ width: 20, height: 1 });
  });

  it("fills glyph cells with the text-level bg", () => {
    let ansi = decode(
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        // PROPOSED: text() gains a `bg` prop; cast so it type-checks today
        // deno-lint-ignore no-explicit-any
        text("Hi", { bg: rgba(255, 0, 0) } as any),
        close(),
      ]).output,
    );

    // pins down: the bg SGR is active when the first glyph "H" is emitted
    let before = ansi.slice(0, ansi.indexOf("H"));
    expect(before).toContain("\x1b[48;2;255;0;0");
  });

  it("fills only glyph cells, not the surrounding box fill", () => {
    let ansi = decode(
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        // deno-lint-ignore no-explicit-any
        text("Hi", { bg: rgba(255, 0, 0) } as any),
        close(),
      ]).output,
    );

    // pins down: bg present on the two glyph cells ...
    let before = ansi.slice(0, ansi.indexOf("H"));
    expect(before).toContain("\x1b[48;2;255;0;0");
    // ... but absent from the trailing box fill past the glyphs (stays default)
    let afterGlyphs = ansi.slice(ansi.indexOf("Hi") + 2);
    expect(afterGlyphs).not.toContain("\x1b[48;2;255;0;0");
  });
});
