import { beforeEach, describe, expect, it } from "./suite.ts";
import { createTerm, type Term } from "../term.ts";
import { close, grow, open, text } from "../ops.ts";
import { assert, validate, validated } from "../validate.ts";
import { print } from "./print.ts";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const trim = (value: string) =>
  value.split("\n").map((line) => line.trimEnd()).join("\n");

describe("validate", () => {
  it("accepts valid ops", () => {
    expect(validate([
      open("root", { layout: { width: grow(), height: grow() } }),
      text("hello"),
      close(),
    ])).toBe(true);
  });

  it("accepts empty array", () => {
    expect(validate([])).toBe(true);
  });

  it("accepts balanced nested elements and siblings", () => {
    let ops = [
      open("root"),
      open("first"),
      text("one"),
      close(),
      open("second"),
      open("child"),
      text("two"),
      close(),
      close(),
      close(),
      open("peer"),
      close(),
    ];
    expect(validate(ops)).toBe(true);
    expect(() => assert(ops)).not.toThrow();
  });

  it("rejects missing closes, surplus closes, and a close before its open", () => {
    for (
      let ops of [
        [open("root"), text("missing close")],
        [open("root"), close(), close()],
        [close(), open("root")],
      ]
    ) {
      expect(validate(ops)).toBe(false);
      expect(() => assert(ops)).toThrow(TypeError);
    }
  });

  it("accepts transition ops", () => {
    expect(validate([
      open("x", {
        transition: {
          duration: 0.2,
          easing: "easeOut",
          properties: ["x", "bg"],
          interactive: true,
        },
      }),
      close(),
    ])).toBe(true);
  });

  it("accepts a pointer shape", () => {
    expect(validate([open("x", { cursor: "pointer" }), close()])).toBe(
      true,
    );
  });

  it("rejects a pointer shape outside the vocabulary", () => {
    expect(validate([
      // deno-lint-ignore no-explicit-any
      open("x", { cursor: "hand" as any }),
      close(),
    ])).toBe(false);
  });

  it("rejects ops with wrong directive", () => {
    expect(validate([{ directive: 0xff }])).toBe(false);
  });

  it("rejects open element missing id", () => {
    expect(validate([{ directive: 0x02 }])).toBe(false);
  });

  it("rejects text missing content", () => {
    expect(validate([{ directive: 0x03 }])).toBe(false);
  });

  it("rejects invalid transition properties", () => {
    expect(validate([
      open("x", {
        // deno-lint-ignore no-explicit-any
        transition: { duration: 0.2, properties: ["opacity" as any] },
      }),
      close(),
    ])).toBe(false);
  });

  it("rejects negative transition duration", () => {
    expect(validate([
      open("x", { transition: { duration: -1, properties: ["x"] } }),
      close(),
    ])).toBe(false);
  });

  it("rejects non-array", () => {
    expect(validate("garbage")).toBe(false);
  });

  it("rejects null", () => {
    expect(validate(null)).toBe(false);
  });

  it("assert throws TypeError on bad input", () => {
    expect(() => assert([{ directive: 0x02 }])).toThrow(TypeError);
  });

  it("rejects padding > 255 (u8 overflow)", () => {
    expect(validate([
      open("x", { layout: { padding: { left: 300 } } }),
      close(),
    ])).toBe(false);
  });

  it("rejects fractional padding", () => {
    expect(validate([
      open("x", { layout: { padding: { left: 1.5 } } }),
      close(),
    ])).toBe(false);
  });

  it("rejects fontSize > 255", () => {
    expect(validate([text("hi", { fontSize: 256 })])).toBe(false);
  });

  it("rejects gap > 65535 (u16 overflow)", () => {
    expect(validate([
      open("x", { layout: { gap: 70000 } }),
      close(),
    ])).toBe(false);
  });

  it("rejects negative border width", () => {
    expect(validate([
      open("x", { border: { color: 0xFF0000, left: -1 } }),
      close(),
    ])).toBe(false);
  });

  it("rejects fractional color", () => {
    expect(validate([text("hi", { color: 1.5 })])).toBe(false);
  });

  it("rejects fractional border background color", () => {
    expect(validate([
      open("x", { border: { color: 0xFF0000, bg: 1.5, left: 1 } }),
      close(),
    ])).toBe(false);
  });

  it("accepts structured floating attach points", () => {
    expect(validate([
      open("x", {
        floating: {
          attachPoints: { element: "center-center", parent: "center-center" },
        },
      }),
      close(),
    ])).toBe(true);
  });

  it("accepts floating expand and clipping fields", () => {
    expect(validate([
      open("x", {
        floating: {
          expand: { width: 2, height: 3 },
          pointerCaptureMode: "passthrough",
          clipTo: "attached-parent",
          zIndex: 1024,
        },
      }),
      close(),
    ])).toBe(true);
  });

  it("accepts signed floating z-index values", () => {
    expect(validate([
      open("x", { floating: { zIndex: -1 } }),
      close(),
    ])).toBe(true);
    expect(validate([
      open("x", { floating: { zIndex: 32767 } }),
      close(),
    ])).toBe(true);
  });

  it("rejects floating z-index values outside signed 16-bit range", () => {
    expect(validate([
      open("x", { floating: { zIndex: -32769 } }),
      close(),
    ])).toBe(false);
    expect(validate([
      open("x", { floating: { zIndex: 32768 } }),
      close(),
    ])).toBe(false);
  });

  it("accepts structured border side objects", () => {
    expect(validate([
      open("x", {
        border: {
          color: 0xFF0000,
          top: { width: 1 },
          right: { width: 1, color: 0x00FF00 },
          bottom: { width: 1, bg: 0x0000FF },
          left: { width: 1, color: 0x00FF00, bg: 0x0000FF },
        },
      }),
      close(),
    ])).toBe(true);
  });

  it("rejects structured border side missing width", () => {
    expect(validate([
      { directive: 0x02, id: "x", border: { color: 0xFF0000, top: {} } },
      close(),
    ])).toBe(false);
    expect(validate([
      {
        directive: 0x02,
        id: "x",
        border: { color: 0xFF0000, top: { color: 0x00FF00 } },
      },
      close(),
    ])).toBe(false);
  });

  it("rejects invalid structured border side widths", () => {
    for (let width of [-1, 1.5, 256]) {
      expect(validate([
        open("x", { border: { color: 0xFF0000, top: { width } } }),
        close(),
      ])).toBe(false);
      expect(validate([
        open("x", { border: { color: 0xFF0000, left: { width } } }),
        close(),
      ])).toBe(false);
    }
  });

  it("rejects invalid structured border side colors", () => {
    for (let color of [1.5, 0x1FFFFFFFF, -0x80000001]) {
      expect(validate([
        open("x", { border: { color: 0xFF0000, top: { width: 1, color } } }),
        close(),
      ])).toBe(false);
    }
  });

  it("rejects invalid structured border side backgrounds", () => {
    for (let bg of [1.5, 0x1FFFFFFFF, -0x80000001]) {
      expect(validate([
        open("x", { border: { color: 0xFF0000, top: { width: 1, bg } } }),
        close(),
      ])).toBe(false);
    }
  });

  it("still rejects invalid scalar border side widths", () => {
    for (let width of [-1, 1.5, 256]) {
      expect(validate([
        open("x", { border: { color: 0xFF0000, top: width } }),
        close(),
      ])).toBe(false);
      expect(validate([
        open("x", { border: { color: 0xFF0000, left: width } }),
        close(),
      ])).toBe(false);
    }
  });

  it("rejects a border without shared color even with side colors", () => {
    expect(validate([
      {
        directive: 0x02,
        id: "x",
        border: { top: { width: 1, color: 0xFF0000 } },
      },
      close(),
    ])).toBe(false);
  });
});

describe("validated", () => {
  let term: Term;

  beforeEach(async () => {
    term = validated(await createTerm({ width: 40, height: 10 }));
  });

  it("renders valid ops normally", () => {
    let out = print(
      decode(
        term.render([
          open("root", {
            layout: { width: grow(), height: grow(), direction: "ttb" },
          }),
          text("Hello, World!"),
          close(),
        ]).output,
      ),
      40,
      10,
    );
    expect(out).toContain("Hello, World!");
  });

  it("accepts replay and its object spread from each completed render", () => {
    let result = term.render([open("root"), text("hello"), close()]);
    for (let i = 0; i < 4; i++) {
      let replay = { ...result.info.get("root")!.replay };
      expect(validate([replay])).toBe(true);
      result = term.render([replay], { mode: "line" });
      expect(print(decode(result.output), 40, 10).trim()).toBe("hello");
      expect(result.errors).toEqual([]);
    }
  });

  it("preserves a saved replay and output after rejecting unbalanced wrappers", async () => {
    let checked = validated(await createTerm({ width: 8, height: 2 }));
    let previous = checked.render([open("item"), text("saved"), close()]);
    let output = decode(previous.output);
    expect(trim(print(output, 8, 2))).toEqual("saved\n");
    let item = previous.info.get("item")!;
    for (
      let ops of [
        [open("unfinished"), item.replay],
        [item.replay, close()],
        [close(), item.replay, open("unfinished")],
      ]
    ) {
      expect(() => checked.render(ops)).toThrow(TypeError);
      expect(decode(previous.output)).toEqual(output);
      expect(previous.info.get("item")?.bounds).toEqual(item.bounds);
    }

    let next = checked.render([
      open("wrapper", {
        layout: { width: grow(), height: grow(), padding: { left: 2, top: 1 } },
      }),
      item.replay,
      close(),
    ]);
    expect(trim(print(output + decode(next.output), 8, 2))).toEqual(
      "\n  saved",
    );
    expect(next.info.get("item")?.bounds).toEqual({
      x: 2,
      y: 1,
      width: 5,
      height: 1,
    });
    expect(next.errors).toEqual([]);
  });

  it("rejects stale replay even when the new frame uses the same element range", () => {
    let first = term.render([open("root"), text("one"), close()]);
    let replay = first.info.get("root")!.replay;
    let second = term.render([open("root"), text("two"), close()]);
    expect(first.info.get("root")).toBeUndefined();
    expect(() => term.render([replay])).toThrow(/latest completed render/);
    let result = term.render([second.info.get("root")!.replay], {
      mode: "line",
    });
    expect(print(decode(result.output), 40, 10).trim()).toBe("two");
  });

  it("detects expiry through another reference to the same Term", async () => {
    let raw = await createTerm({ width: 8, height: 1 });
    let checked = validated(raw);
    let first = checked.render([open("root"), text("one"), close()]);
    let replay = first.info.get("root")!.replay;
    raw.render([open("root"), text("two"), close()]);
    expect(() => checked.render([replay])).toThrow(/latest completed render/);
    expect(first.info.get("root")).toBeUndefined();
  });

  it("preserves replay validation when wrappers are nested", () => {
    let checked = validated(term);
    let first = checked.render([open("root"), text("hello"), close()]);
    let replay = first.info.get("root")!.replay;
    let next = checked.render([replay], { mode: "line" });
    expect(print(decode(next.output), 40, 10).trim()).toBe("hello");
    expect(() => checked.render([replay])).toThrow(/latest completed render/);
  });

  it("expires frozen metadata and a saved lookup without mutating either", async () => {
    let raw = await createTerm({ width: 8, height: 1 });
    let first = raw.render([open("root"), text("one"), close()]);
    let lookup = first.info.get;
    Object.freeze(first.info);
    let replay = lookup("root")!.replay;
    let next = raw.render([replay]);
    expect(next.info.get("root")).toBeDefined();
    expect(first.info.get("root")).toBeUndefined();
    expect(lookup("root")).toBeUndefined();
  });

  it("expires replay after an empty render without a metadata lookup", () => {
    let first = term.render([open("root"), close()]);
    let replay = first.info.get("root")!.replay;
    term.render([]);
    expect(() => term.render([replay])).toThrow(/latest completed render/);
  });

  it("expires replay when a completed render reports layout errors", () => {
    let first = term.render([open("root"), close()]);
    let replay = first.info.get("root")!.replay;
    let result = term.render([open("dup"), close(), open("dup"), close()]);
    expect(result.errors.some((error) => error.type === "DUPLICATE_ID")).toBe(
      true,
    );
    expect(() => term.render([replay])).toThrow(/latest completed render/);
  });

  it("preserves replay through resize, capability updates, and rejected renders", () => {
    let first = term.render([open("root"), text("hello"), close()]);
    let replay = first.info.get("root")!.replay;
    term.update([
      { type: "resize", width: 8, height: 1 },
      { type: "capability", key: "sync-output", value: true },
    ]);

    // A valid replay tag with a malformed range reaches native validation.
    expect(() =>
      Reflect.apply(term.render, term, [[{ ...replay, offset: 0xFFFFFFFC }]])
    ).toThrow(RangeError);
    expect(() => term.render([text("x".repeat(3 * 1024 * 1024))]))
      .toThrow(RangeError);

    let result = term.render([replay], { mode: "line" });
    expect(print(decode(result.output), 8, 1).trim()).toBe("hello");
    expect(result.errors).toEqual([]);
  });

  it("does not accept an untagged replay before the first render", () => {
    expect(() => term.render([{ directive: 0x05, offset: 0, length: 20 }]))
      .toThrow(/latest completed render/);
  });

  it("throws on invalid ops", () => {
    // Call through Reflect so the runtime guard sees deliberately invalid input
    // without weakening the TypeScript surface.
    expect(() => Reflect.apply(term.render, term, [[{ directive: 0xff }]]))
      .toThrow(TypeError);
  });

  it("renders valid structured border sides normally", () => {
    let out = decode(
      term.render([
        open("box", {
          layout: { width: grow(), height: grow() },
          border: {
            color: 0xFFFFFF,
            top: { width: 1, color: 0xFF0000 },
            right: 1,
            bottom: { width: 1, bg: 0x0000FF },
            left: { width: 1 },
          },
        }),
        close(),
      ]).output,
    );
    expect(out).toContain("┌");
  });

  it("throws on a structured border side missing width", () => {
    let invalid = [
      { directive: 0x02, id: "x", border: { color: 0xFF0000, top: {} } },
      close(),
    ];
    expect(() => Reflect.apply(term.render, term, [invalid])).toThrow(
      TypeError,
    );
  });

  it("throws on an invalid structured border side color", () => {
    expect(() =>
      term.render([
        open("x", {
          border: { color: 0xFF0000, top: { width: 1, color: 1.5 } },
        }),
        close(),
      ])
    ).toThrow(TypeError);
  });
});
