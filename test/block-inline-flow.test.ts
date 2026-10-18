import { beforeEach, describe, expect, it } from "./suite.ts";
import { createTerm, type Term } from "../term.ts";
import { close, fixed, type Op, open, rgba, text } from "../ops.ts";
import { print } from "./print.ts";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const trim = (s: string) => s.split("\n").map((l) => l.trimEnd()).join("\n");

describe("block/inline flow", () => {
  let term: Term;

  beforeEach(async () => {
    term = await createTerm({ width: 20, height: 4 });
  });

  let grid = (ops: Op[]) => trim(print(decode(term.render(ops).output), 20, 4));

  it("flows sibling text runs as one wrapping paragraph", () => {
    expect(grid([
      open(
        "p",
        {
          layout: { width: fixed(12), display: "block" },
        } as Parameters<typeof open>[1],
      ),
      text("Hello "),
      text("world", { color: rgba(0, 255, 0) }),
      text("! it wraps"),
      close(),
    ])).toEqual(trim([
      "Hello world!",
      "it wraps",
      "",
      "",
    ].join("\n")));
  });

  it("splits runs around a block-level child into anonymous blocks", () => {
    expect(grid([
      open(
        "p",
        {
          layout: { width: fixed(12), display: "block" },
        } as Parameters<typeof open>[1],
      ),
      text("one "),
      text("two"),
      open("rule", { layout: { height: fixed(1) } }),
      text("------------"),
      close(),
      text("three"),
      close(),
    ])).toEqual(trim([
      "one two",
      "------------",
      "three",
      "",
    ].join("\n")));
  });
});
