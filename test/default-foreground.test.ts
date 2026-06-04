import { describe, expect, it } from "./suite.ts";
import { createTerm } from "../term.ts";
import { close, grow, open, text } from "../ops.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe("true default foreground", () => {
  it("uncolored text emits no concrete foreground", async () => {
    let term = await createTerm({ width: 12, height: 1 });
    let ansi = decode(
      term.render([
        open("root", { layout: { width: grow(), height: grow() } }),
        text("hi"),
        close(),
      ]).output,
    );

    let before = ansi.slice(0, ansi.indexOf("h"));
    // pins: color-less text must leave the terminal default fg, not force white
    expect(before).not.toContain("\x1b[38;2;255;255;255");
  });
});
