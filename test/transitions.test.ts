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

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const trim = (value: string) =>
  value.split("\n").map((line) => line.trimEnd()).join("\n");

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
    it("advances replayed transition targets with each render's deltaTime", async () => {
      let direct = await createTerm({ width: 6, height: 2 });
      let cached = await createTerm({ width: 6, height: 2 });
      let frame = (bg: number) => [
        open("box", {
          layout: { width: fixed(4), height: fixed(1) },
          bg,
          transition: { duration: 0.2, properties: ["bg"] as const },
        }),
        text("T"),
        close(),
      ];
      let initial = frame(rgba(255, 0, 0));
      let target = frame(rgba(0, 0, 255));
      direct.render(initial, { deltaTime: 0 });
      cached.render(initial, { deltaTime: 0 });
      direct.render(target, { deltaTime: 0 });
      let previous = cached.render(target, { deltaTime: 0 });
      let states: boolean[] = [];
      for (let deltaTime of [0.05, 0.05, 0.1, 0.1, 0.1]) {
        let expected = direct.render(target, { deltaTime, mode: "line" });
        previous = cached.render([previous.info.get("box")!.replay], {
          deltaTime,
          mode: "line",
        });
        expect(previous.animating).toBe(expected.animating);
        expect(decode(previous.output)).toEqual(decode(expected.output));
        expect(trim(print(decode(previous.output), 6, 2))).toEqual("T\n");
        states.push(previous.animating);
      }
      expect(states).toContain(true);
      expect(states.at(-1)).toBe(false);
    });

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
