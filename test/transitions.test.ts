import { describe, expect, it } from "./suite.ts";
import { close, createTerm, grow, open, text } from "../mod.ts";

describe("deltaTime", () => {
  it("accepts explicit deltaTime without throwing", async () => {
    let term = await createTerm({ width: 40, height: 10 });
    let result = term.render([
      open("root", { layout: { width: grow(), height: grow() } }),
      text("hi"),
      close(),
    ], { deltaTime: 0.016 });
    expect(result.output).toBeInstanceOf(Uint8Array);
  });
});

describe("animating", () => {
  it("reports animating=false for a static frame", async () => {
    let term = await createTerm({ width: 40, height: 10 });
    let result = term.render([
      open("root", { layout: { width: grow(), height: grow() } }),
      text("hi"),
      close(),
    ]);
    expect(result.animating).toBe(false);
  });
});
