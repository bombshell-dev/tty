import { describe, expect, it } from "./suite.ts";
import { createTerm } from "../term.ts";
import { close, fixed, grow, type Op, open, text } from "../ops.ts";
import { print } from "./print.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const trim = (s: string) => s.split("\n").map((l) => l.trimEnd()).join("\n");

const LABELS = ["zero", "one", "two-long", "three"];

// a 4-row panel floating at y over a 12×4 grid, one label per row
function panel(y: number): Op[] {
  return [
    open("root", { layout: { width: grow(), height: grow() } }),
    open("panel", {
      layout: { width: fixed(10), height: fixed(4), direction: "ttb" },
      floating: { x: 0, y, attachTo: "root" },
    }),
    ...LABELS.flatMap((label, i) => [
      open(`row${i}`, { layout: { width: grow(), height: fixed(1) } }),
      text(label),
      close(),
    ]),
    close(),
    close(),
  ];
}

async function draw(ops: Op[], width: number, height: number) {
  let term = await createTerm({ width, height });
  return trim(print(decode(term.render(ops).output), width, height));
}

async function over(
  ops: Op[],
  [width, height]: [number, number],
  [x, y]: [number, number],
  ids: string[],
) {
  let term = await createTerm({ width, height });
  return term.render(ops, { pointer: { x, y, down: false } }).events
    .map((event) => event.id)
    .filter((id) => ids.includes(id));
}

describe("cell coverage", () => {
  it("clips the rows of a panel that sit above the top edge", async () => {
    expect(await draw(panel(-2.5), 12, 4)).toEqual(
      ["three", "", "", ""].join("\n"),
    );
  });

  it("draws an edge more than halfway into a cell from the next cell", async () => {
    expect(await draw(panel(0.7), 12, 4)).toEqual(
      ["", "zero", "one", "two-long"].join("\n"),
    );
  });

  it("draws an edge exactly halfway into a cell from that cell", async () => {
    expect(await draw(panel(0.5), 12, 4)).toEqual(
      ["zero", "one", "two-long", "three"].join("\n"),
    );
  });

  it("puts the pointer over the row drawn in each cell", async () => {
    let rows = LABELS.map((_, i) => `row${i}`);
    for (let step = 0; step <= 40; step++) {
      let y = -3 + step / 10;
      let drawn = (await draw(panel(y), 12, 4)).split("\n");
      for (let row = 0; row < 4; row++) {
        let label = drawn[row].trim();
        let hit = (await over(panel(y), [12, 4], [1, row], rows))
          .map((id) => LABELS[rows.indexOf(id)]);
        expect({ y, row, hit }).toEqual({ y, row, hit: label ? [label] : [] });
      }
    }
  });

  it("gives a cell on a half-cell boundary to one element", async () => {
    let split: Op[] = [
      open("root", {
        layout: { width: grow(), height: grow(), direction: "ltr" },
      }),
      open("left", { layout: { width: grow(), height: grow() } }),
      text("L"),
      close(),
      open("right", { layout: { width: grow(), height: grow() } }),
      text("R"),
      close(),
      close(),
    ];
    expect((await draw(split, 41, 1)).trim()).toEqual(`L${" ".repeat(19)}R`);
    expect(await over(split, [41, 1], [19, 0], ["left", "right"])).toEqual([
      "left",
    ]);
    expect(await over(split, [41, 1], [20, 0], ["left", "right"])).toEqual([
      "right",
    ]);
  });
});
