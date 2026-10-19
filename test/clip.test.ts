import { describe, expect, it } from "./suite.ts";
import { createTerm } from "../term.ts";
import { close, fixed, grow, open, rgba, text } from "../ops.ts";
import { print } from "./print.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const trim = (s: string) => s.split("\n").map((l) => l.trimEnd()).join("\n");

const white = rgba(255, 255, 255);
const border = { color: white, left: 1, right: 1, top: 1, bottom: 1 };
const pad = { left: 1, right: 1, top: 1, bottom: 1 };

describe("clip", () => {
  // rulesr marks the bottom of an invisible 14×4 clip(outer);
  //   ┌────┐
  //   │    │
  //   └────┘
  //   ┌────────┐
  //   ──────────────
  //   │clipped │
  //   └────────┘
  it("restores outer vertical bound for a sibling after a nested clip", async () => {
    let term = await createTerm({ width: 14, height: 8 });

    let out = term.render([
      open("root", {
        layout: { width: grow(), height: grow(), direction: "ttb" },
      }),
      open("outer", {
        layout: { width: fixed(14), height: fixed(4), direction: "ttb" },
        clip: { vertical: true, horizontal: true },
      }),
      open("inner", {
        layout: { width: fixed(6), height: fixed(3), direction: "ttb" },
        clip: { vertical: true, horizontal: true },
        border,
      }),
      close(),
      open("sibling", {
        layout: {
          width: fixed(10),
          height: fixed(3),
          direction: "ttb",
          padding: pad,
        },
        border,
      }),
      text("clipped"),
      close(),
      close(),
      open("ruler", {
        layout: { width: fixed(14), height: fixed(1), direction: "ttb" },
      }),
      text("──────────────"),
      close(),
      close(),
    ]).output;

    expect(trim(print(decode(out), 14, 8)).trim()).toEqual(`
┌────┐
│    │
└────┘
┌────────┐
──────────────
`.trim());
  });

  // ruler marks the right boundary of an invisible 8×3 ltr clip
  //   ┌─┐┌────│───┐
  //   │ ││clip│ed │
  //   └─┘└────│───┘
  it("restores outer horizontal bound for a sibling after a nested clip", async () => {
    let term = await createTerm({ width: 14, height: 6 });

    let out = term.render([
      open("root", {
        layout: { width: grow(), height: grow(), direction: "ltr" },
      }),
      open("outer", {
        layout: { width: fixed(8), height: fixed(3), direction: "ltr" },
        clip: { vertical: true, horizontal: true },
      }),
      open("inner", {
        layout: { width: fixed(3), height: fixed(3), direction: "ttb" },
        clip: { vertical: true, horizontal: true },
        border,
      }),
      close(),
      open("sibling", {
        layout: {
          width: fixed(10),
          height: fixed(3),
          direction: "ttb",
        },
        border,
      }),
      text("clipped"),
      close(),
      close(),
      open("ruler", {
        layout: { width: fixed(1), height: fixed(3), direction: "ttb" },
      }),
      text("│\n│\n│"),
      close(),
      close(),
    ]).output;

    expect(trim(print(decode(out), 14, 6)).trim()).toEqual(`
┌─┐┌────│
│ ││clip│
└─┘└────│
`.trim());
  });

  // Nesting clips past the renderer's tracking limit must not break push/pop
  // symmetry: the over-deep levels coalesce into the deepest tracked clip, and
  // closing them leaves the outer clip intact for a later sibling. With a
  // border on the outermost nested clip, the over-deep frame must render
  // identically to the depth-2 case above — the ruler marks the 8-wide outer
  // bound and the sibling is cut there.
  //   ┌─┐┌────│
  //   │ ││clip│
  //   └─┘└────│
  it("preserves the outer clip for a sibling after over-deep nesting", async () => {
    let term = await createTerm({ width: 14, height: 6 });

    let nest: ReturnType<typeof open>[] = [];
    for (let d = 0; d < 20; d++) {
      nest.push(open(`deep${d}`, {
        layout: { width: fixed(3), height: fixed(3), direction: "ttb" },
        clip: { vertical: true, horizontal: true },
        ...(d === 0 ? { border } : {}),
      }));
    }
    let unnest = nest.map(() => close());

    let result = term.render([
      open("root", {
        layout: { width: grow(), height: grow(), direction: "ltr" },
      }),
      open("outer", {
        layout: { width: fixed(8), height: fixed(3), direction: "ltr" },
        clip: { vertical: true, horizontal: true },
      }),
      ...nest,
      ...unnest,
      open("sibling", {
        layout: {
          width: fixed(10),
          height: fixed(3),
          direction: "ttb",
        },
        border,
      }),
      text("clipped"),
      close(),
      close(),
      open("ruler", {
        layout: { width: fixed(1), height: fixed(3), direction: "ttb" },
      }),
      text("│\n│\n│"),
      close(),
      close(),
    ]);

    expect(trim(print(decode(result.output), 14, 6)).trim()).toEqual(`
┌─┐┌────│
│ ││clip│
└─┘└────│
`.trim());

    expect(result.errors.map((e) => e.type)).toContain("CLIP_DEPTH_EXCEEDED");
  });
});
