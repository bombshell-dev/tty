import { describe, expect, it } from "./suite.ts";
import { createTerm } from "../term.ts";
import { close, fixed, grow, open, type SizingAxis, text } from "../ops.ts";
import { print } from "./print.ts";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("grow() padding", () => {
  // (a) Exact repro of the A/B bug: fixed() and grow() roots must produce identical layouts.
  // Before the fix, a grow() root's minDimensions reflected content width rather than the
  // configured min (0), preventing compression to terminal width when content + padding > termW.
  it("fixed() and grow() roots produce identical child positions", async () => {
    let mkRoot = (w: SizingAxis) => [
      open("root", {
        layout: {
          width: w,
          height: grow(),
          padding: { left: 4, right: 4, top: 1, bottom: 1 },
          direction: "ttb",
        },
      }),
      open("row", { layout: { width: grow(), direction: "ltr" } }),
      text("L"),
      open("spacer", { layout: { width: grow() } }),
      close(),
      text("R"),
      close(),
      close(),
    ];

    let termA = await createTerm({ width: 40, height: 4 });
    let termB = await createTerm({ width: 40, height: 4 });

    let resultA = termA.render(mkRoot(fixed(40)));
    let resultB = termB.render(mkRoot(grow()));

    let gridA = print(decode(resultA.output), 40, 4).split("\n");
    let gridB = print(decode(resultB.output), 40, 4).split("\n");

    // Root content box: x=4, width=32. L at col 4, R at col 35.
    expect(gridA[1][4]).toBe("L");
    expect(gridA[1][35]).toBe("R");
    expect(gridA[1]).toEqual(gridB[1]); // grow() root must match fixed() root

    expect(resultA.info.get("root")!.bounds.width).toBe(40);
    expect(resultB.info.get("root")!.bounds.width).toBe(40);
  });

  // (b) Asymmetric padding: R must respect the larger right padding, not overflow it.
  it("right-aligned element respects asymmetric padding under grow() root", async () => {
    let term = await createTerm({ width: 40, height: 3 });
    let grid = print(
      decode(
        term.render([
          open("root", {
            layout: {
              width: grow(),
              height: grow(),
              padding: { left: 2, right: 6, top: 1, bottom: 1 },
              direction: "ttb",
            },
          }),
          open("row", { layout: { width: grow(), direction: "ltr" } }),
          text("L"),
          open("spacer", { layout: { width: grow() } }),
          close(),
          text("R"),
          close(),
          close(),
        ]).output,
      ),
      40,
      3,
    ).split("\n");

    // Content box: 40 - 2(left) - 6(right) = 32 wide, starting at col 2.
    // L at col 2, R at col 33. Cols 34-39 are right padding — must be empty.
    expect(grid[1][2]).toBe("L");
    expect(grid[1][33]).toBe("R");
    expect(grid[1][34]).toBe(" ");
  });

  // (c) Two levels of nesting: each intermediate grow() box also respects its parent content box.
  it("two levels of grow() nesting preserve content-box sizing", async () => {
    let term = await createTerm({ width: 40, height: 6 });
    let grid = print(
      decode(
        term.render([
          open("root", {
            layout: {
              width: grow(),
              height: grow(),
              padding: { left: 2, right: 2, top: 1, bottom: 1 },
              direction: "ttb",
            },
          }),
          open("col", {
            layout: {
              width: grow(),
              height: grow(),
              padding: { left: 2, right: 2, top: 1, bottom: 1 },
              direction: "ttb",
            },
          }),
          open("row", { layout: { width: grow(), direction: "ltr" } }),
          text("L"),
          open("spacer", { layout: { width: grow() } }),
          close(),
          text("R"),
          close(),
          close(),
          close(),
        ]).output,
      ),
      40,
      6,
    ).split("\n");

    // Root pad left=2, col pad left=2 → content starts at col 4, width 32.
    // L at col 4, R at col 35. Col right padding at 36-37, root right padding at 38-39.
    // Row appears at y=2 (root top=1 + col top=1).
    expect(grid[2][4]).toBe("L");
    expect(grid[2][35]).toBe("R");
    expect(grid[2][36]).toBe(" ");
  });

  // (d) Height axis: a grow() root with vertical padding must compress to terminal height,
  // not expand to fit content + padding when that sum exceeds the terminal.
  it("grow() root height is bounded to terminal height under vertical padding", async () => {
    let term = await createTerm({ width: 10, height: 8 });

    // 5 text rows + padding 4 = 9 > termH 8.
    // Before the fix, root.bounds.height was 9; after, it must be 8.
    let result = term.render([
      open("root", {
        layout: {
          width: grow(),
          height: grow(),
          padding: { top: 2, bottom: 2 },
          direction: "ttb",
        },
      }),
      text("row1"),
      text("row2"),
      text("row3"),
      text("row4"),
      text("row5"),
      close(),
    ]);

    let root = result.info.get("root");
    expect(root).toBeDefined();
    expect(root!.bounds.height).toBe(8);
    expect(root!.bounds.width).toBe(10);
  });
});
