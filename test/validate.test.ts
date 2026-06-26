import { beforeEach, describe, expect, it } from "./suite.ts";
import { createTerm, type Term } from "../term.ts";
import { close, grow, open, text } from "../ops.ts";
import { assert, validate, validated } from "../validate.ts";
import { print } from "./print.ts";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

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
