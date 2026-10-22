import { describe, expect, it } from "./suite.ts";
import * as mod from "../mod.ts";
import {
  close,
  fit,
  fixed,
  grow,
  type Op,
  open,
  pack,
  percent,
  snapshot,
  stretch,
  text,
} from "../ops.ts";
import { createTerm, type RenderResult } from "../term.ts";
import { validate } from "../validate.ts";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function bounds(result: RenderResult, id: string) {
  let info = result.info.get(id);
  expect(info).toBeDefined();
  return info!.bounds;
}

function ttbRoot(width: number, height: number, extraLayout = {}) {
  return open("root", {
    layout: {
      width: fixed(width),
      height: fixed(height),
      direction: "ttb" as const,
      ...extraLayout,
    },
  });
}

function ltrRoot(width: number, height: number, extraLayout = {}) {
  return open("root", {
    layout: {
      width: fixed(width),
      height: fixed(height),
      direction: "ltr" as const,
      ...extraLayout,
    },
  });
}

describe("flex layout controls", () => {
  it("exports stretch() as a plain sizing object and does not export #80 helpers", () => {
    expect(stretch()).toEqual({ type: "stretch" });
    expect(mod.stretch()).toEqual({ type: "stretch" });
    expect(Object.getPrototypeOf(stretch())).toBe(Object.prototype);

    let exported = mod as unknown as Record<string, unknown>;
    expect("basis" in exported).toBe(false);
    expect("flexBasis" in exported).toBe(false);
    expect("shrinkWeight" in exported).toBe(false);
    expect("flexShrink" in exported).toBe(false);
  });

  it("validates supported alignSelf values and stretch axes", () => {
    let values = [
      "auto",
      "normal",
      "stretch",
      "center",
      "start",
      "end",
      "flex-start",
      "flex-end",
    ] as const;

    for (let alignSelf of values) {
      expect(validate([
        open("root"),
        open("child", { layout: { alignSelf } }),
        close(),
        close(),
      ])).toBe(true);
    }

    expect(validate([
      open("root", { layout: { width: stretch(), height: stretch() } }),
      close(),
    ])).toBe(true);
  });

  it("rejects invalid alignSelf values and invalid sizing discriminators", () => {
    expect(validate([
      { directive: 0x02, id: "x", layout: { alignSelf: "baseline" } },
      { directive: 0x04 },
    ])).toBe(false);

    expect(validate([
      { directive: 0x02, id: "x", layout: { alignSelf: 1 } },
      { directive: 0x04 },
    ])).toBe(false);

    expect(validate([
      { directive: 0x02, id: "x", layout: { width: { type: "stretched" } } },
      { directive: 0x04 },
    ])).toBe(false);

    for (let alignSelf of ["self-start", "safe center", "unsafe center"]) {
      expect(validate([
        { directive: 0x02, id: "x", layout: { alignSelf } },
        { directive: 0x04 },
      ])).toBe(false);
    }
  });

  it("packs stretch axes and snapshots ops containing stretch and alignSelf", () => {
    let widthStretch = [
      open("root", { layout: { width: stretch(), height: fixed(1) } }),
      close(),
    ];
    let heightStretch = [
      open("root", { layout: { width: fixed(1), height: stretch() } }),
      close(),
    ];
    let alignSelf = [
      ttbRoot(12, 1),
      open("child", { layout: { width: fit(), alignSelf: "flex-end" } }),
      text("B"),
      close(),
      close(),
    ];

    expect(() => pack(widthStretch, new ArrayBuffer(512), 0, 512)).not
      .toThrow();
    expect(() => pack(heightStretch, new ArrayBuffer(512), 0, 512)).not
      .toThrow();
    expect(() => snapshot(widthStretch)).not.toThrow();
    expect(() => snapshot(heightStretch)).not.toThrow();
    expect(() => snapshot(alignSelf)).not.toThrow();
  });

  it("aligns one ttb child to cross-end without moving siblings", async () => {
    let term = await createTerm({ width: 12, height: 4 });
    let result = term.render([
      ttbRoot(12, 4),
      open("a", { layout: { width: fit(), height: fixed(1) } }),
      text("A"),
      close(),
      open("b", {
        layout: { width: fit(), height: fixed(1), alignSelf: "flex-end" },
      }),
      text("B"),
      close(),
      close(),
    ]);

    expect(bounds(result, "a")).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(bounds(result, "b")).toEqual({ x: 11, y: 1, width: 1, height: 1 });
    expect(result.info.get("")).toBeUndefined();
  });

  it("aligns one ltr child to cross-end", async () => {
    let term = await createTerm({ width: 3, height: 5 });
    let result = term.render([
      ltrRoot(3, 5),
      open("b", {
        layout: { width: fixed(1), height: fit(), alignSelf: "flex-end" },
      }),
      text("B"),
      close(),
      close(),
    ]);

    expect(bounds(result, "b")).toEqual({ x: 0, y: 4, width: 1, height: 1 });
  });

  it("maps start and flex-start to cross-start in both directions", async () => {
    let term = await createTerm({ width: 12, height: 6 });

    for (let alignSelf of ["start", "flex-start"] as const) {
      let ttb = term.render([
        ttbRoot(12, 3, { alignX: "right" as const }),
        open("child", {
          layout: { width: fit(), height: fixed(1), alignSelf },
        }),
        text("C"),
        close(),
        close(),
      ]);
      expect(bounds(ttb, "child").x).toBe(0);

      let ltr = term.render([
        ltrRoot(3, 6, { alignY: "bottom" as const }),
        open("child", {
          layout: { width: fixed(1), height: fit(), alignSelf },
        }),
        text("C"),
        close(),
        close(),
      ]);
      expect(bounds(ltr, "child").y).toBe(0);
    }
  });

  it("centers alignSelf children within the parent content extent", async () => {
    let term = await createTerm({ width: 12, height: 6 });

    let ttb = term.render([
      ttbRoot(12, 3),
      open("child", {
        layout: { width: fixed(2), height: fixed(1), alignSelf: "center" },
      }),
      close(),
      close(),
    ]);
    expect(bounds(ttb, "child").x).toBe(5);

    let ltr = term.render([
      ltrRoot(3, 6),
      open("child", {
        layout: { width: fixed(1), height: fixed(2), alignSelf: "center" },
      }),
      close(),
      close(),
    ]);
    expect(bounds(ltr, "child").y).toBe(2);
  });

  it("omitted alignSelf and auto follow parent cross-axis alignment", async () => {
    let withoutAuto = await createTerm({ width: 12, height: 2 });
    let withAuto = await createTerm({ width: 12, height: 2 });

    let omittedOps = [
      ttbRoot(12, 2, { alignX: "right" as const }),
      open("child", { layout: { width: fit(), height: fixed(1) } }),
      text("B"),
      close(),
      close(),
    ];
    let autoOps = [
      ttbRoot(12, 2, { alignX: "right" as const }),
      open("child", {
        layout: { width: fit(), height: fixed(1), alignSelf: "auto" },
      }),
      text("B"),
      close(),
      close(),
    ];

    let omitted = withoutAuto.render(omittedOps, { mode: "line" });
    let auto = withAuto.render(autoOps, { mode: "line" });

    expect(bounds(omitted, "child")).toEqual(bounds(auto, "child"));
    expect(bounds(auto, "child").x).toBe(11);
    expect(decode(auto.output)).toBe(decode(omitted.output));
  });

  it("stretches auto-like cross sizes for stretch and normal alignSelf", async () => {
    let term = await createTerm({ width: 12, height: 4 });
    let result = term.render([
      ttbRoot(12, 4),
      open("omitted", { layout: { height: fixed(1), alignSelf: "stretch" } }),
      text("O"),
      close(),
      open("fit", {
        layout: { width: fit(), height: fixed(1), alignSelf: "stretch" },
      }),
      text("F"),
      close(),
      open("normal", {
        layout: { width: fit(), height: fixed(1), alignSelf: "normal" },
      }),
      text("N"),
      close(),
      close(),
    ]);

    expect(bounds(result, "omitted").width).toBe(12);
    expect(bounds(result, "fit").width).toBe(12);
    expect(bounds(result, "normal").width).toBe(12);
  });

  it("preserves definite cross sizes under stretch alignSelf", async () => {
    let term = await createTerm({ width: 12, height: 3 });
    let result = term.render([
      ttbRoot(12, 3, { alignX: "right" as const }),
      open("fixed", {
        layout: { width: fixed(4), height: fixed(1), alignSelf: "stretch" },
      }),
      text("F"),
      close(),
      open("percent", {
        layout: { width: percent(0.5), height: fixed(1), alignSelf: "stretch" },
      }),
      text("P"),
      close(),
      close(),
    ]);

    expect(bounds(result, "fixed")).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 1,
    });
    expect(bounds(result, "percent")).toEqual({
      x: 0,
      y: 1,
      width: 6,
      height: 1,
    });
  });

  it("uses parent padding as the cross-axis content extent", async () => {
    let term = await createTerm({ width: 12, height: 6 });

    let alignStretch = term.render([
      ttbRoot(12, 3, { padding: { left: 1, right: 1 } }),
      open("child", { layout: { height: fixed(1), alignSelf: "stretch" } }),
      text("S"),
      close(),
      close(),
    ]);
    expect(bounds(alignStretch, "child")).toEqual({
      x: 1,
      y: 0,
      width: 10,
      height: 1,
    });

    let stretchWidth = term.render([
      ttbRoot(12, 3, { padding: { left: 1, right: 1 } }),
      open("child", { layout: { width: stretch(), height: fixed(1) } }),
      text("S"),
      close(),
      close(),
    ]);
    expect(bounds(stretchWidth, "child")).toEqual({
      x: 1,
      y: 0,
      width: 10,
      height: 1,
    });

    let stretchHeight = term.render([
      ltrRoot(3, 6, { padding: { top: 1, bottom: 1 } }),
      open("child", { layout: { width: fixed(1), height: stretch() } }),
      text("S"),
      close(),
      close(),
    ]);
    expect(bounds(stretchHeight, "child")).toEqual({
      x: 0,
      y: 1,
      width: 1,
      height: 4,
    });
  });

  it("preserves descendant alignment and main-axis grow sizing", async () => {
    let term = await createTerm({ width: 12, height: 4 });
    let descendant = term.render([
      ttbRoot(12, 4),
      open("outer", {
        layout: {
          width: fixed(4),
          height: fixed(2),
          direction: "ttb",
          alignX: "left",
          alignSelf: "flex-end",
        },
      }),
      open("inner", { layout: { width: fit(), height: fixed(1) } }),
      text("I"),
      close(),
      close(),
      close(),
    ]);

    expect(bounds(descendant, "outer")).toEqual({
      x: 8,
      y: 0,
      width: 4,
      height: 2,
    });
    expect(bounds(descendant, "inner")).toEqual({
      x: 8,
      y: 0,
      width: 1,
      height: 1,
    });

    let growMain = term.render([
      ttbRoot(12, 4),
      open("a", { layout: { width: fit(), height: fixed(1) } }),
      text("A"),
      close(),
      open("b", {
        layout: { width: fit(), height: grow(), alignSelf: "flex-end" },
      }),
      text("B"),
      close(),
      close(),
    ]);

    expect(bounds(growMain, "b")).toEqual({ x: 11, y: 1, width: 1, height: 3 });
  });

  it("treats root and floating alignSelf as no-ops", async () => {
    let rootA = await createTerm({ width: 12, height: 3 });
    let rootB = await createTerm({ width: 12, height: 3 });

    let withoutRootAlign = [
      open("root", { layout: { width: fixed(2), height: fixed(1) } }),
      text("R"),
      close(),
    ];
    let withRootAlign = [
      open("root", {
        layout: { width: fixed(2), height: fixed(1), alignSelf: "flex-end" },
      }),
      text("R"),
      close(),
    ];

    let noAlign = rootA.render(withoutRootAlign, { mode: "line" });
    let align = rootB.render(withRootAlign, { mode: "line" });
    expect(bounds(align, "root")).toEqual(bounds(noAlign, "root"));
    expect(decode(align.output)).toBe(decode(noAlign.output));

    let floatA = await createTerm({ width: 12, height: 6 });
    let floatB = await createTerm({ width: 12, height: 6 });
    let floating = (alignSelf = false): Op[] => [
      ttbRoot(12, 6),
      open("float", {
        layout: {
          width: fixed(2),
          height: fixed(1),
          ...(alignSelf ? { alignSelf: "flex-end" as const } : {}),
        },
        floating: { x: 2, y: 1, attachTo: "root" },
      }),
      text("F"),
      close(),
      close(),
    ];

    let floatingNoAlign = floatA.render(floating(false), { mode: "line" });
    let floatingAlign = floatB.render(floating(true), { mode: "line" });
    expect(bounds(floatingAlign, "float")).toEqual(
      bounds(floatingNoAlign, "float"),
    );
    expect(decode(floatingAlign.output)).toBe(decode(floatingNoAlign.output));
    expect(validate(floating(true))).toBe(true);
  });

  it("keeps configured main-axis gaps and child order", async () => {
    let term = await createTerm({ width: 12, height: 6 });
    let ttb = term.render([
      ttbRoot(12, 6, { gap: 1 }),
      open("a", { layout: { width: fit(), height: fixed(1) } }),
      text("A"),
      close(),
      open("b", {
        layout: { width: fit(), height: fixed(1), alignSelf: "flex-end" },
      }),
      text("B"),
      close(),
      open("c", { layout: { width: fit(), height: fixed(1) } }),
      text("C"),
      close(),
      close(),
    ]);

    expect(bounds(ttb, "a").y).toBe(0);
    expect(bounds(ttb, "b").y).toBe(2);
    expect(bounds(ttb, "c").y).toBe(4);
    expect(bounds(ttb, "b").x).toBe(11);

    let ltr = term.render([
      ltrRoot(6, 3, { gap: 1 }),
      open("a", { layout: { width: fixed(1), height: fit() } }),
      text("A"),
      close(),
      open("b", {
        layout: { width: fixed(1), height: fit(), alignSelf: "flex-end" },
      }),
      text("B"),
      close(),
      open("c", { layout: { width: fixed(1), height: fit() } }),
      text("C"),
      close(),
      close(),
    ]);

    expect(bounds(ltr, "a").x).toBe(0);
    expect(bounds(ltr, "b").x).toBe(2);
    expect(bounds(ltr, "c").x).toBe(4);
    expect(bounds(ltr, "b").y).toBe(2);
  });

  it("renders direct ops and snapshots equivalently for stretch and alignSelf", async () => {
    let stretchOps = [
      ttbRoot(12, 3),
      open("child", { layout: { width: stretch(), height: fixed(1) } }),
      text("S"),
      close(),
      close(),
    ];

    let directStretch = await createTerm({ width: 12, height: 3 });
    let snapStretch = await createTerm({ width: 12, height: 3 });
    expect(
      decode(
        snapStretch.render([snapshot(stretchOps)], { mode: "line" }).output,
      ),
    )
      .toBe(decode(directStretch.render(stretchOps, { mode: "line" }).output));

    let child = [
      open("child", {
        layout: { width: fit(), height: fixed(1), alignSelf: "flex-end" },
      }),
      text("B"),
      close(),
    ];
    let wrap = (content: Op[]) => [ttbRoot(12, 3), ...content, close()];

    let directAlign = await createTerm({ width: 12, height: 3 });
    let snapAlign = await createTerm({ width: 12, height: 3 });
    let direct = directAlign.render(wrap(child), { mode: "line" });
    let snapped = snapAlign.render(wrap([snapshot(child)]), { mode: "line" });

    expect(bounds(snapped, "child")).toEqual(bounds(direct, "child"));
    expect(bounds(snapped, "child").x).toBe(11);
    expect(decode(snapped.output)).toBe(decode(direct.output));
  });

  it("does not expose synthetic wrapper ids through pointer events", async () => {
    let term = await createTerm({ width: 12, height: 4 });
    let result = term.render([
      ttbRoot(12, 4),
      open("b", {
        layout: { width: fit(), height: fixed(1), alignSelf: "flex-end" },
      }),
      text("B"),
      close(),
      close(),
    ], { pointer: { x: 11, y: 0, down: false } });

    let allowed = new Set(["Clay__RootContainer", "root", "b"]);
    for (let event of result.events) {
      expect(allowed.has(event.id)).toBe(true);
    }
    expect(result.events).toContainEqual({ type: "pointerenter", id: "b" });
  });

  it("does not emit terminal state management sequences for new layouts", async () => {
    let term = await createTerm({ width: 12, height: 3 });
    let result = term.render([
      ttbRoot(12, 3),
      open("b", {
        layout: { width: stretch(), height: fixed(1), alignSelf: "center" },
      }),
      text("B"),
      close(),
      close(),
    ]);

    let output = decode(result.output);
    expect(output).not.toContain("?1049");
    expect(output).not.toContain("?25");
    expect(output).not.toContain("?1000");
    expect(output).not.toContain("?1002");
    expect(output).not.toContain("?1003");
    expect(output).not.toContain("?1006");
  });
});
