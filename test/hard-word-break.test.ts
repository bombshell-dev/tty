import { describe, expect, it } from "./suite.ts";
import { createTerm } from "../term.ts";
import { close, fixed, open, rgba, text } from "../ops.ts";
import { print } from "./print.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const trim = (s: string) => s.split("\n").map((l) => l.trimEnd()).join("\n");

// Proposed hard-break wrap mode (overflow-wrap: anywhere).
// Today the renderer only has WORDS=0 / NEWLINES=1 / NONE=2, so this
// value type-checks (wrap is a number) but is ignored at runtime.
const WRAP_HARD = 3;

describe("hard word-break", () => {
  it("hard-breaks overlong words inside a padded content width", async () => {
    let term = await createTerm({ width: 12, height: 5 });
    let out = print(
      decode(
        term.render([
          open("box", {
            layout: {
              width: fixed(5),
              height: fixed(5),
              direction: "ttb",
              padding: { left: 1, right: 1 },
            },
          }),
          // content width is 3 cols; "Hello"/"World" must hard-break
          text("Hello World", { wrap: WRAP_HARD }),
          close(),
        ]).output,
      ),
      12,
      5,
    );
    // pins: each overlong word splits to fit the 3-col content, padded by 1
    expect(trim(out)).toEqual(
      [" Hel", " lo", " Wor", " ld", ""].join("\n").trimEnd(),
    );
  });

  it("hard-breaks an overlong word across rows then wraps the rest", async () => {
    let term = await createTerm({ width: 20, height: 8 });
    let out = print(
      decode(
        term.render([
          open("box", {
            layout: {
              width: fixed(10),
              height: fixed(8),
              direction: "ttb",
              padding: { left: 1, right: 1 },
            },
            border: {
              color: rgba(255, 255, 255),
              left: 1,
              right: 1,
              top: 1,
              bottom: 1,
            },
          }),
          // content width 8; "Hellooooooooooooo" must split across lines
          text("Hellooooooooooooo World", { wrap: WRAP_HARD }),
          close(),
        ]).output,
      ),
      20,
      8,
    );
    // pins: an overlong run splits across rows, then "World" wraps normally
    expect(trim(out)).toEqual(`
┌────────┐
│Helloooo│
│oooooooo│
│o World │
│        │
│        │
└────────┘`.trim());
  });

  it("never bleeds text past the right edge of the container", async () => {
    let term = await createTerm({ width: 20, height: 8 });
    let grid = print(
      decode(
        term.render([
          open("box", {
            layout: {
              width: fixed(10),
              height: fixed(8),
              direction: "ttb",
              padding: { left: 1, right: 1 },
            },
            border: {
              color: rgba(255, 255, 255),
              left: 1,
              right: 1,
              top: 1,
              bottom: 1,
            },
          }),
          text("Hellooooooooooooo World", { wrap: WRAP_HARD }),
          close(),
        ]).output,
      ),
      20,
      8,
    );
    // pins: nothing is drawn at columns >= the 10-wide box's right edge
    for (let line of grid.split("\n")) {
      expect(line.slice(10).trim()).toEqual("");
    }
  });
});
