import { describe, expect, it } from "./suite.ts";
import { close, open, pack, rgba, snapshot, text } from "../ops.ts";

describe("pack", () => {
  it("throws a descriptive RangeError when text exceeds the transfer buffer", () => {
    let memory = new ArrayBuffer(64);
    let error: unknown;

    try {
      pack(
        [
          open("root"),
          text("x".repeat(128)),
          close(),
        ],
        memory,
        0,
        memory.byteLength,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toMatch(
      /transfer buffer|capacity|packing/,
    );
    expect((error as Error).message).toContain("text content");
    expect((error as Error).message).not.toBe("offset is out of bounds");
    expect((error as Error).message).toMatch(
      /smaller visible slice|reduce frame content/,
    );
  });

  it("throws a descriptive RangeError when an element id exceeds the transfer buffer", () => {
    let memory = new ArrayBuffer(16);
    let error: unknown;

    try {
      pack([open("x".repeat(64)), close()], memory, 0, memory.byteLength);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toMatch(
      /transfer buffer|capacity|packing/,
    );
    expect((error as Error).message).toContain("element id");
    expect((error as Error).message).not.toBe("offset is out of bounds");
  });

  it("sizes snapshots with floating elements", () => {
    expect(() =>
      snapshot([
        open("float", {
          floating: {
            x: 1,
            y: 2,
            expand: { width: 3, height: 4 },
            attachTo: "root",
            attachPoints: {
              element: "center-center",
              parent: "center-center",
            },
            pointerCaptureMode: "passthrough",
            clipTo: "attached-parent",
            zIndex: -1,
          },
        }),
        close(),
      ])
    ).not.toThrow();
  });
});

describe("hex colors", () => {
  it("packs hex strings to bytes identical to their rgba() equivalents", () => {
    let hex = new ArrayBuffer(256);
    let n = pack(
      [text("Hi", { color: "#ff8800aa", bg: "#f80" })],
      hex,
      0,
    );
    let num = new ArrayBuffer(256);
    let m = pack(
      [text("Hi", { color: rgba(255, 136, 0, 170), bg: rgba(255, 136, 0) })],
      num,
      0,
    );

    expect(n).toBe(m);
    expect(new Uint8Array(hex, 0, n * 4)).toEqual(
      new Uint8Array(num, 0, m * 4),
    );
  });

  it("packs open bg and border colors bit-identically to rgba()", () => {
    let hex = new ArrayBuffer(256);
    let n = pack(
      [
        open("x", {
          bg: "#ff8800aa",
          border: {
            color: "#f80",
            bg: "#00ff00",
            top: { width: 1, color: "#ff0000", bg: "#0000ff" },
            right: 1,
          },
        }),
        close(),
      ],
      hex,
      0,
    );
    let num = new ArrayBuffer(256);
    let m = pack(
      [
        open("x", {
          bg: rgba(255, 136, 0, 170),
          border: {
            color: rgba(255, 136, 0),
            bg: rgba(0, 255, 0),
            top: { width: 1, color: rgba(255, 0, 0), bg: rgba(0, 0, 255) },
            right: 1,
          },
        }),
        close(),
      ],
      num,
      0,
    );

    expect(n).toBe(m);
    expect(new Uint8Array(hex, 0, n * 4)).toEqual(
      new Uint8Array(num, 0, m * 4),
    );
  });

  it("throws a TypeError on an invalid hex string", () => {
    let memory = new ArrayBuffer(256);
    let error: unknown;
    try {
      pack([text("Hi", { bg: "#ggg" as string })], memory, 0);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain("#ggg");
  });
});

describe("CSS color strings", () => {
  function packed(color: string | number): Uint8Array {
    let memory = new ArrayBuffer(256);
    let n = pack([text("Hi", { color })], memory, 0);
    return new Uint8Array(memory, 0, n * 4);
  }

  it("packs each CSS Color 4 form identically to its rgba() equivalent", () => {
    let cases: [string, number][] = [
      ["rgb(255 136 0)", rgba(255, 136, 0)],
      ["rgb(255 136 0 / 50%)", rgba(255, 136, 0, 128)],
      ["rgba(255, 136, 0, 0.5)", rgba(255, 136, 0, 128)],
      ["rgb(100% 0% 0%)", rgba(255, 0, 0)],
      ["hsl(120 100% 50%)", rgba(0, 255, 0)],
      ["hsla(240, 100%, 50%, 0.25)", rgba(0, 0, 255, 64)],
      ["hsl(0.5turn 100% 50%)", rgba(0, 255, 255)],
      ["hwb(0 0% 0%)", rgba(255, 0, 0)],
      ["lab(100 0 0)", rgba(255, 255, 255)],
      ["lch(0 0 0)", rgba(0, 0, 0)],
      ["oklab(1 0 0)", rgba(255, 255, 255)],
      ["oklch(0 0 none)", rgba(0, 0, 0)],
      ["rebeccapurple", rgba(102, 51, 153)],
      ["RebeccaPurple", rgba(102, 51, 153)],
      ["RGB(255 136 0)", rgba(255, 136, 0)],
      ["transparent", rgba(0, 0, 0, 0)],
    ];
    for (let [color, value] of cases) {
      expect([color, packed(color)]).toEqual([color, packed(value)]);
    }
  });

  it("clamps channels and alpha to the packable range", () => {
    expect(packed("rgb(300 -20 0 / 2)")).toEqual(packed(rgba(255, 0, 0)));
  });

  it("clips out-of-gamut colors per channel", () => {
    expect(packed("oklch(0.6 0.4 30)")).toEqual(packed(rgba(255, 0, 0)));
  });

  it("throws a TypeError on unsupported and reserved forms", () => {
    for (
      let color of [
        "color(srgb 1 0 0)",
        "color-mix(in srgb, red, blue)",
        "rgb(from red r g b)",
        "device-cmyk(0 0 0 1)",
        "currentcolor",
        " red",
        "red ",
        "rgb(1 2)",
        "notacolor",
      ]
    ) {
      let error: unknown;
      try {
        packed(color);
      } catch (caught) {
        error = caught;
      }
      expect([color, error instanceof TypeError]).toEqual([color, true]);
      expect((error as Error).message).toContain(color);
    }
  });
});

describe("system colors", () => {
  function packed(ops: Parameters<typeof pack>[0]): Uint8Array {
    let memory = new ArrayBuffer(512);
    let n = pack(ops, memory, 0);
    return new Uint8Array(memory, 0, n * 4);
  }

  let box = (bg: string | number) => [open("box", { bg }), close()];
  let border = (color: string | number, bg?: string | number) => [
    open("box", { border: { color, bg, top: 1 } }),
    close(),
  ];

  it("packs keywords case-insensitively and aliases identically", () => {
    expect(packed([text("Hi", { color: "linktext", bg: "MARK" })])).toEqual(
      packed([text("Hi", { color: "LinkText", bg: "Mark" })]),
    );
    expect(packed(box("Highlight"))).toEqual(packed(box("SelectedItem")));
    expect(packed(border("GrayText"))).toEqual(packed(border("ButtonBorder")));
  });

  it("packs a default keyword in a text fg like an omitted color", () => {
    for (let color of ["Canvas", "CanvasText", "Field"]) {
      expect([color, packed([text("Hi", { color })])]).toEqual([
        color,
        packed([text("Hi")]),
      ]);
    }
  });

  it("packs a default keyword in a bg differently from an omitted bg", () => {
    expect(packed([text("Hi", { bg: "Canvas" })])).not.toEqual(
      packed([text("Hi")]),
    );
    expect(packed(border("red", "CanvasText"))).not.toEqual(
      packed(border("red")),
    );
  });

  it("never collides with an sRGB color", () => {
    expect(packed([text("Hi", { color: "LinkText" })])).not.toEqual(
      packed([text("Hi", { color: rgba(0, 1, 4) })]),
    );
    expect(packed(box("Canvas"))).not.toEqual(packed(box(rgba(0, 0, 0, 128))));
    expect(packed(box("LinkText"))).not.toEqual(
      packed(box(rgba(0, 1, 4, 128))),
    );
    expect(packed(border("LinkText", "Mark"))).not.toEqual(
      packed(border(rgba(0, 1, 4), rgba(0, 1, 3))),
    );
  });

  it("snapshots system colors like the directives they came from", () => {
    let ops = [open("box", { bg: "Mark" }), text("Hi", { color: "Mark" })];
    expect((snapshot(ops) as { data: Uint8Array }).data).toEqual(packed(ops));
  });
});

describe("cross-field default keywords with a theme", () => {
  function packed(
    ops: Parameters<typeof pack>[0],
    theme?: Parameters<typeof pack>[4],
  ): Uint8Array {
    let memory = new ArrayBuffer(512);
    let n = pack(ops, memory, 0, memory.byteLength, theme);
    return new Uint8Array(memory, 0, n * 4);
  }

  let theme = {
    foreground: { r: 10, g: 20, b: 30 },
    background: { r: 200, g: 210, b: 220 },
  };

  it("packs a fg-default keyword in a bg field as the probed foreground", () => {
    expect(packed([text("Hi", { bg: "CanvasText" })], theme)).toEqual(
      packed([text("Hi", { bg: rgba(10, 20, 30) })]),
    );
    expect(packed([open("box", { bg: "ButtonText" }), close()], theme))
      .toEqual(
        packed([open("box", { bg: rgba(10, 20, 30) }), close()]),
      );
  });

  it("packs a bg-default keyword in a fg field as the probed background", () => {
    expect(packed([text("Hi", { color: "Canvas" })], theme)).toEqual(
      packed([text("Hi", { color: rgba(200, 210, 220) })]),
    );
    expect(
      packed(
        [open("box", { border: { color: "Field", top: 1 } }), close()],
        theme,
      ),
    ).toEqual(
      packed([
        open("box", { border: { color: rgba(200, 210, 220), top: 1 } }),
        close(),
      ]),
    );
  });

  it("falls back to the field's own default without a theme", () => {
    expect(packed([text("Hi", { bg: "CanvasText" })])).toEqual(
      packed([text("Hi", { bg: "Canvas" })]),
    );
    expect(packed([text("Hi", { color: "Canvas" })])).toEqual(
      packed([text("Hi", { color: "CanvasText" })]),
    );
  });

  it("falls back to the field's own default when the theme omits that color", () => {
    expect(packed([text("Hi", { bg: "CanvasText" })], {})).toEqual(
      packed([text("Hi", { bg: "Canvas" })]),
    );
  });
});
