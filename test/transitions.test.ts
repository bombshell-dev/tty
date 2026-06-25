import { describe, expect, it } from "./suite.ts";
import {
  close,
  createTerm,
  fixed,
  grow,
  type Op,
  open,
  rgba,
  text,
} from "../mod.ts";
import { print } from "./print.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/* eighth-block ramps used for sub-cell rect edges: ▏▎▍▌▋▊▉ and ▁▂▃▄▅▆▇ */
const EIGHTH_BLOCKS = /[▁-▇▉-▏]/;

describe("transitions", () => {
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

  describe("lifecycle", () => {
    it("animates bg change between frames", async () => {
      let term = await createTerm({ width: 20, height: 5 });
      let frame = (bg: number): Op[] => [
        open("box", {
          layout: { width: fixed(10), height: fixed(3) },
          bg,
          transition: {
            duration: 0.2,
            easing: "easeInOut",
            properties: ["bg"],
          },
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

  describe("sub-cell edges", () => {
    it("renders a partial-block edge for a fractional rect width", async () => {
      let W = 16, H = 4;
      let term = await createTerm({ width: W, height: H });
      let frame = (w: number): Op[] => [
        open("root", { layout: { width: grow(), height: grow() } }),
        open("box", {
          layout: { width: fixed(w), height: fixed(2) },
          bg: rgba(255, 0, 0),
          transition: {
            duration: 0.3,
            easing: "easeInOut",
            properties: ["width"],
          },
        }),
        close(),
        close(),
      ];

      // establish start width, then retarget so the box is mid-transition
      term.render(frame(4), { deltaTime: 0 });
      term.render(frame(12), { deltaTime: 0 });

      // step through the curve; the leading edge lands on fractional columns,
      // which must render as eighth-block glyphs rather than snapping.
      let sawPartial = false;
      for (let dt of [0.05, 0.08, 0.1, 0.12, 0.15]) {
        let r = term.render(frame(12), { deltaTime: dt });
        if (EIGHTH_BLOCKS.test(print(decode(r.output), W, H))) {
          sawPartial = true;
          break;
        }
      }
      expect(sawPartial).toBe(true);
    });
  });

  describe("line mode", () => {
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
});
