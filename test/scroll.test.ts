import { beforeEach, describe, expect, it } from "./suite.ts";
import { createTerm, type Term } from "../term.ts";
import { close, fixed, grow, open, text } from "../ops.ts";
import { print } from "./print.ts";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("scroll", () => {
  let term: Term;

  beforeEach(async () => {
    term = await createTerm({ width: 20, height: 5 });
  });

  it("clips children with manual y offset", () => {
    let out = print(
      decode(
        term.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          open("viewport", {
            layout: { width: fixed(10), height: fixed(3) },
            clip: { y: -1 },
          }),
          open("content", {
            layout: {
              width: fixed(10),
              height: fixed(6),
              direction: "ttb",
            },
          }),
          text("LINE-0"),
          text("LINE-1"),
          text("LINE-2"),
          text("LINE-3"),
          text("LINE-4"),
          text("LINE-5"),
          close(),
          close(),
          close(),
        ]).output,
      ),
      20,
      5,
    );
    expect(out).toContain("LINE-1");
    expect(out).not.toContain("LINE-0");
  });

  it("clips children with manual x offset", () => {
    let out = print(
      decode(
        term.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          open("viewport", {
            layout: { width: fixed(8), height: fixed(1) },
            clip: { x: -2 },
          }),
          open("track", {
            layout: {
              width: fixed(12),
              height: fixed(1),
              direction: "ltr",
            },
          }),
          open("a", { layout: { width: fixed(4), height: fixed(1) } }),
          text("AAAA"),
          close(),
          open("b", { layout: { width: fixed(4), height: fixed(1) } }),
          text("BBBB"),
          close(),
          open("c", { layout: { width: fixed(4), height: fixed(1) } }),
          text("CCCC"),
          close(),
          close(),
          close(),
          close(),
        ]).output,
      ),
      20,
      5,
    );
    expect(out).toContain("AA");
    expect(out).toContain("BBBB");
  });

  it("offset updates between frames change visible content", () => {
    let ops = (offset: number) => [
      open("root", {
        layout: { width: grow(), height: grow(), direction: "ttb" },
      }),
      open("viewport", {
        layout: { width: grow(), height: fixed(1) },
        clip: { y: offset },
      }),
      open("content", {
        layout: { width: grow(), height: fixed(3), direction: "ttb" },
      }),
      text("FIRST"),
      text("SECOND"),
      text("THIRD"),
      close(),
      close(),
      close(),
    ];

    let out = print(decode(term.render(ops(0)).output), 20, 5);
    expect(out).toContain("FIRST");

    out = print(decode(term.render(ops(-1)).output), 20, 5);
    expect(out).toContain("SECOND");
    expect(out).not.toContain("FIRST");
  });

  it("clip with zero offset clips without scrolling", () => {
    let out = print(
      decode(
        term.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          open("viewport", {
            layout: { width: fixed(10), height: fixed(2) },
            clip: { y: 0 },
          }),
          open("content", {
            layout: {
              width: fixed(10),
              height: fixed(4),
              direction: "ttb",
            },
          }),
          text("VISIBLE"),
          text("ALSO-VIS"),
          text("CLIPPED1"),
          text("CLIPPED2"),
          close(),
          close(),
          close(),
        ]).output,
      ),
      20,
      5,
    );
    expect(out).toContain("VISIBLE");
    expect(out).not.toContain("CLIPPED1");
  });
});
