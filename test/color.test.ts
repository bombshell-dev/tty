import { text } from "../ops.ts";
import { createTerm } from "../term.ts";
import { describe, expect, it } from "./suite.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe("foreground", () => {
  it("emits uncolored text with no foreground", async () => {
    let term = await createTerm({ width: 12, height: 1 });
    let ansi = decode(term.render([text("hi")]).output);

    expect(ansi).toContain("hi");
    expect(ansi).not.toContain("\x1b[38;2;255;255;255");
  });
});
