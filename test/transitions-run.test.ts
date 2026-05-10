import { describe, expect, it } from "./suite.ts";
import { close, createTerm, fixed, type Op, open, rgba } from "../mod.ts";

describe("transition lifecycle", () => {
  it("animates bg change between frames", async () => {
    let term = await createTerm({ width: 20, height: 5 });
    let frame = (bg: number): Op[] => [
      open("box", {
        layout: { width: fixed(10), height: fixed(3) },
        bg,
        transition: { duration: 0.2, easing: "easeInOut", properties: ["bg"] },
      }),
      close(),
    ];

    let r0 = term.render(frame(rgba(255, 0, 0)), { deltaTime: 0 });
    expect(r0.animating).toBe(false);

    term.render(frame(rgba(0, 0, 255)), { deltaTime: 0 });
    let mid = term.render(frame(rgba(0, 0, 255)), { deltaTime: 0.1 });
    expect(mid.animating).toBe(true);

    term.render(frame(rgba(0, 0, 255)), { deltaTime: 0.15 });
    let done = term.render(frame(rgba(0, 0, 255)), { deltaTime: 0.05 });
    expect(done.animating).toBe(false);
  });

  it("reports animating=false when duration is 0", async () => {
    let term = await createTerm({ width: 10, height: 3 });
    let frame = (bg: number): Op[] => [
      open("box", {
        layout: { width: fixed(5), height: fixed(2) },
        bg,
        transition: { duration: 0, properties: ["bg"] },
      }),
      close(),
    ];

    term.render(frame(rgba(255, 0, 0)), { deltaTime: 0 });
    let r = term.render(frame(rgba(0, 0, 255)), { deltaTime: 0.1 });
    expect(r.animating).toBe(false);
  });
});

describe("transitions in line mode", () => {
  it("runs color transitions in line mode", async () => {
    let term = await createTerm({ width: 20, height: 5 });
    let frame = (bg: number): Op[] => [
      open("box", {
        layout: { width: fixed(10), height: fixed(2) },
        bg,
        transition: { duration: 0.2, properties: ["bg"] },
      }),
      close(),
    ];

    term.render(frame(rgba(255, 0, 0)), { deltaTime: 0, mode: "line" });
    term.render(frame(rgba(0, 255, 0)), { deltaTime: 0, mode: "line" });
    let r = term.render(frame(rgba(0, 255, 0)), {
      deltaTime: 0.1,
      mode: "line",
    });
    expect(r.animating).toBe(true);
    expect(r.output).toBeInstanceOf(Uint8Array);
  });
});
