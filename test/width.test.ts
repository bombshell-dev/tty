import { describe, expect, it } from "./suite.ts";
import { createTerm } from "../term.ts";
import { close, grow, open, text } from "../ops.ts";
import { print } from "./print.ts";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("width", () => {
  it("measures non-printable codepoints as one replacement cell", async () => {
    let term = await createTerm({ width: 20, height: 4 });

    // U+FDD0 is a noncharacter: wcwidth() reports it non-printable and the
    // renderer emits it as U+FFFD in a single cell, so measurement must
    // count it as one cell too or fit-sized boxes end up too narrow.
    let result = term.render([
      open("root", {
        layout: { width: grow(), height: grow(), direction: "ttb" },
      }),
      open("box"),
      text("a﷐b"),
      close(),
      close(),
    ]);

    expect(result.info.get("box")?.bounds.width).toBe(3);
  });

  it("renders a noncharacter as a single replacement cell", async () => {
    let term = await createTerm({ width: 20, height: 4 });

    let out = print(
      decode(
        term.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          text("a﷐b"),
          close(),
        ]).output,
      ),
      20,
      4,
    );

    expect(out).toContain("a�b");
  });
});
