import { beforeEach, describe, expect, it } from "./suite.ts";
import { createTerm, type Term } from "../term.ts";
import { close, fit, open, text } from "../ops.ts";
import { print } from "./print.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

const VS16 = "\u{1F321}\u{FE0F}\u{26A0}\u{FE0F}\u{2705}"; // 🌡️⚠️✅

describe("vs16 emoji width measurement", () => {
  let term: Term;
  beforeEach(async () => {
    term = await createTerm({ width: 24, height: 3 });
  });

  it("measures base emoji + U+FE0F as width-2 clusters", () => {
    let r = term.render([
      open("box", { layout: { width: fit(), height: fit() } }),
      text(VS16),
      close(),
    ]);
    // three emoji-presentation clusters at width 2 each => 6, not 4
    expect(r.info.get("box")!.bounds.width).toBe(6);
  });

  it("upgrades a single base+FE0F cluster (⚠️) to width 2", () => {
    let r = term.render([
      open("box", { layout: { width: fit(), height: fit() } }),
      text("\u{26A0}\u{FE0F}"), // ⚠️
      close(),
    ]);
    // ⚠ alone is text-presentation width 1; +U+FE0F selects emoji width 2
    expect(r.info.get("box")!.bounds.width).toBe(2);
  });

  it("renders each base+FE0F as a width-2 cluster and drops the selector", () => {
    let r = term.render([
      open("box", { layout: { width: fit(), height: fit() } }),
      text(VS16),
      close(),
    ]);
    let grid = print(decode(r.output), 24, 3);
    // each cluster occupies two columns (base glyph + trailing cell), so the
    // bases land on even columns; U+FE0F is consumed, never emitted.
    expect(grid.split("\n")[0].trimEnd()).toBe("🌡 ⚠ ✅");
    expect(grid).not.toContain("\u{FE0F}");
  });
});
