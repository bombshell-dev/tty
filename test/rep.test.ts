import { close, fixed, open, rgba, text } from "../ops.ts";
import { createTerm } from "../term.ts";
import { describe, expect, it } from "./suite.ts";
import { print } from "./print.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const trim = (s: string) => s.split("\n").map((l) => l.trimEnd()).join("\n");

// REP is "\x1b[<n>b" — repeat the preceding graphic character n times.
function hasRep(ansi: string): boolean {
  for (
    let i = ansi.indexOf("\x1b[");
    i !== -1;
    i = ansi.indexOf("\x1b[", i + 1)
  ) {
    let j = i + 2;
    while (j < ansi.length && ansi[j] >= "0" && ansi[j] <= "9") j++;
    if (j > i + 2 && ansi[j] === "b") return true;
  }
  return false;
}

describe("REP (CSI b) coalescing", () => {
  it("coalesces a horizontal run of identical cells into a REP sequence", async () => {
    let term = await createTerm({ width: 40, height: 3 });

    // A bordered box: the top edge is ┌ + 36×─ + ┐ — a long run of the
    // identical box-drawing cell that REP can collapse.
    let ansi = decode(
      term.render([
        open("box", {
          layout: { width: fixed(38), height: fixed(3), direction: "ttb" },
          border: {
            color: rgba(255, 255, 255),
            left: 1,
            right: 1,
            top: 1,
            bottom: 1,
          },
        }),
        text("hi"),
        close(),
      ]).output,
    );

    expect(hasRep(ansi)).toBe(true);
  });

  it("renders the same grid the repeated cells would have produced", async () => {
    let term = await createTerm({ width: 40, height: 3 });

    let out = print(
      decode(
        term.render([
          open("box", {
            layout: { width: fixed(38), height: fixed(3), direction: "ttb" },
            border: {
              color: rgba(255, 255, 255),
              left: 1,
              right: 1,
              top: 1,
              bottom: 1,
            },
          }),
          text("hi"),
          close(),
        ]).output,
      ),
      40,
      3,
    );

    expect(trim(out).split("\n")[0]).toBe("┌" + "─".repeat(36) + "┐");
  });

  it("does not use REP for a short single-byte run that would not save bytes", async () => {
    let term = await createTerm({ width: 40, height: 1 });

    // Frame 1: a full row of 'a'. Frame 2: change the first 5 cells to 'b'.
    // The diff is an isolated 5-cell run — REP (\x1b[4b) is break-even, so
    // emitting "bbbbb" inline is preferred.
    term.render([text("a".repeat(40))]);
    let ansi = decode(
      term.render([text("b".repeat(5) + "a".repeat(35))]).output,
    );

    expect(ansi).toContain("bbbbb");
    expect(hasRep(ansi)).toBe(false);
  });

  it("uses REP once a single-byte run is long enough to save bytes", async () => {
    let term = await createTerm({ width: 40, height: 1 });

    // Frame 2 changes the first 6 cells to 'b'. run*1=6 > 1+3+1=5, so the
    // run collapses to one 'b' + \x1b[5b.
    term.render([text("a".repeat(40))]);
    let ansi = decode(
      term.render([text("b".repeat(6) + "a".repeat(34))]).output,
    );

    expect(ansi).toContain("\x1b[5b");
  });
});
