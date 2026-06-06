import { beforeEach, describe, expect, it } from "./suite.ts";
import { createTerm, type Term } from "../term.ts";
import { close, fixed, open, text } from "../ops.ts";
import { print } from "./print.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const trim = (s: string) => s.split("\n").map((l) => l.trimEnd()).join("\n");

describe("clip", () => {
  let term: Term;

  beforeEach(async () => {
    term = await createTerm({ width: 8, height: 8 });
  });

  it("restores the outer clip rect vertically for a sibling after a nested clip", () => {
    let out = term.render([
      open("outer", {
        layout: { width: fixed(8), height: fixed(4), direction: "ttb" },
        clip: { vertical: true, horizontal: true },
      }),
      open("inner", {
        layout: { width: fixed(4), height: fixed(2), direction: "ttb" },
        clip: { vertical: true, horizontal: true },
      }),
      open("innerContent", {
        layout: { width: fixed(4), height: fixed(4), direction: "ttb" },
      }),
      text("AAAA\nBBBB\nCCCC\nDDDD"),
      close(), // innerContent
      close(), // inner
      open("sibling", {
        layout: { width: fixed(4), height: fixed(4), direction: "ttb" },
      }),
      text("XXXX\nYYYY\nZZZZ\nWWWW"),
      close(), // sibling
      close(), // outer
    ]).output;

    let grid = trim(print(decode(out), 8, 8));
    // After the inner clip closes the outer rect must be restored, so the
    // sibling rows past the outer clip bottom (ZZZZ, WWWW) are clipped away.
    expect(grid).toEqual(
      [
        "AAAA", // inner content row 0 (inner clip = rows 0-1)
        "BBBB", // inner content row 1
        "XXXX", // sibling starts at row 2 — inside outer clip
        "YYYY", // sibling row 3 — last row inside outer clip
        "", // row 4: ZZZZ clipped by restored outer rect
        "", // row 5: WWWW clipped by restored outer rect
        "",
        "",
      ].join("\n"),
    );
  });

  it("restores the outer clip horizontal bound for a sibling after a nested clip", () => {
    let out = term.render([
      open("outer", {
        layout: { width: fixed(4), height: fixed(4), direction: "ttb" },
        clip: { vertical: true, horizontal: true },
      }),
      open("inner", {
        layout: { width: fixed(2), height: fixed(1), direction: "ttb" },
        clip: { vertical: true, horizontal: true },
      }),
      text("II"),
      close(), // inner
      open("sibling", {
        layout: { width: fixed(8), height: fixed(1), direction: "ttb" },
      }),
      text("SSSSSSSS"),
      close(), // sibling
      close(), // outer
    ]).output;

    let siblingRow = print(decode(out), 8, 4).split("\n")[1];
    // Outer clip width is 4; once the narrower inner clip closes the outer
    // horizontal bound must be restored so cols >= 4 of the sibling are clipped.
    expect(siblingRow).toEqual("SSSS    ");
  });
});
