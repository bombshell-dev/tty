import { beforeEach, describe, expect, it } from "./suite.ts";
import { createTerm, type Term } from "../term.ts";
import {
  close,
  fixed,
  grow,
  type Op,
  open,
  type PointerShape,
  text,
} from "../ops.ts";
import type { CapabilityEvent } from "../input.ts";
import { POINTER_SHAPES } from "../pointer-shape.ts";
import { print } from "./print.ts";

const SUPPORTED: CapabilityEvent = {
  type: "capability",
  key: "pointer-shape",
  value: true,
};

const WITHDRAWN: CapabilityEvent = {
  type: "capability",
  key: "pointer-shape",
  value: false,
};

const osc22 = (shape: string) => `\x1b]22;${shape}\x1b\\`;

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const trim = (s: string) => s.split("\n").map((l) => l.trimEnd()).join("\n");

function sequences(bytes: Uint8Array): string[] {
  let [, ...rest] = decode(bytes).split("\x1b]22;");
  return rest.map((tail) => osc22(tail.slice(0, tail.indexOf("\x1b\\"))));
}

function over(x: number, y: number) {
  return { pointer: { x, y, down: false } };
}

// ┌─root (40x6, ltr)───────────────────────┐
// │┌─link (20x6) pointer─┐┌─plain (20x6)──┐│
// ││┌─field (10x2) text┐ ││P              ││
// │││F                 │ ││               ││
// ││└──────────────────┘ ││               ││
// ││L                    ││               ││
// │└─────────────────────┘└───────────────┘│
// └────────────────────────────────────────┘
function layout(link: { cursor?: PointerShape } = {}): Op[] {
  return [
    open("root", {
      layout: { width: grow(), height: grow(), direction: "ltr" },
    }),
    open("link", {
      layout: { width: fixed(20), height: fixed(6), direction: "ttb" },
      cursor: "pointer",
      ...link,
    }),
    open("field", {
      layout: { width: fixed(10), height: fixed(2) },
      cursor: "text",
    }),
    text("F"),
    close(),
    text("L"),
    close(),
    open("plain", {
      layout: { width: fixed(20), height: fixed(6) },
    }),
    text("P"),
    close(),
    close(),
  ];
}

const FIELD = over(2, 0);
const LINK = over(2, 4);
const PLAIN = over(25, 2);

describe("pointer shape", () => {
  let term: Term;

  beforeEach(async () => {
    term = await createTerm({ width: 40, height: 6 });
    term.update([SUPPORTED]);
  });

  describe("capability gate", () => {
    it("never emits OSC 22 without the pointer-shape capability", async () => {
      let unsupported = await createTerm({ width: 40, height: 6 });
      expect(sequences(unsupported.render(layout(), LINK).output)).toEqual([]);
      expect(sequences(unsupported.render(layout(), PLAIN).output)).toEqual(
        [],
      );
    });

    it("emits once the capability arrives", async () => {
      let late = await createTerm({ width: 40, height: 6 });
      expect(sequences(late.render(layout(), LINK).output)).toEqual([]);
      expect(late.update([SUPPORTED])).toBeUndefined();
      expect(sequences(late.render(layout(), LINK).output)).toEqual([
        osc22("pointer"),
      ]);
    });
  });

  describe("output", () => {
    it("appends the set sequence after the unchanged frame bytes", async () => {
      let plain = await createTerm({ width: 40, height: 6 });
      let frame = decode(plain.render(layout(), LINK).output);
      let output = decode(term.render(layout(), LINK).output);

      expect(output).toBe(frame + osc22("pointer"));
      expect(trim(print(frame, 40, 6))).toBe(trim(
        [
          "F                   P",
          "",
          "L",
          "",
          "",
          "",
        ].join("\n"),
      ));
    });

    it("emits only when the resolved shape changes", () => {
      for (let i = 0; i < 3; i++) {
        expect(sequences(term.render(layout(), LINK).output)).toEqual([
          osc22("pointer"),
        ]);
        expect(sequences(term.render(layout(), LINK).output)).toEqual([]);
        expect(sequences(term.render(layout(), over(3, 5)).output)).toEqual([]);
        expect(sequences(term.render(layout(), FIELD).output)).toEqual([
          osc22("text"),
        ]);
        expect(sequences(term.render(layout(), FIELD).output)).toEqual([]);
        expect(sequences(term.render(layout(), PLAIN).output)).toEqual([
          osc22("default"),
        ]);
        expect(sequences(term.render(layout(), PLAIN).output)).toEqual([]);
      }
    });

    it("emits in line mode", () => {
      let result = term.render(layout(), { mode: "line", ...LINK });
      expect(sequences(result.output)).toEqual([osc22("pointer")]);
    });

    it("emits nothing while the pointer only crosses undeclared elements", () => {
      expect(sequences(term.render(layout(), PLAIN).output)).toEqual([]);
      expect(sequences(term.render(layout()).output)).toEqual([]);
    });
  });

  describe("resolution", () => {
    it("lets the innermost declaring element win", () => {
      expect(sequences(term.render(layout(), FIELD).output)).toEqual([
        osc22("text"),
      ]);
      expect(sequences(term.render(layout(), LINK).output)).toEqual([
        osc22("pointer"),
      ]);
    });

    it("follows a declared shape that changes under a still pointer", () => {
      term.render(layout(), LINK);
      expect(
        sequences(
          term.render(layout({ cursor: "progress" }), LINK)
            .output,
        ),
      ).toEqual([osc22("progress")]);
    });

    it("emits every shape in the PointerShape vocabulary by name", () => {
      let emitted = POINTER_SHAPES.map((shape) => {
        let link = shape === "default" ? "pointer" : shape;
        return sequences(term.render(layout({ cursor: link }), LINK).output);
      });
      expect(emitted).toEqual(
        POINTER_SHAPES.map((shape, i) =>
          i === 0 ? [osc22("pointer")] : [osc22(shape)]
        ),
      );
    });

    it("applies to elements declared without an id", () => {
      let ops: Op[] = [
        open("root", { layout: { width: grow(), height: grow() } }),
        open("", {
          layout: { width: fixed(10), height: fixed(2) },
          cursor: "crosshair",
        }),
        close(),
        close(),
      ];
      expect(sequences(term.render(ops, over(1, 1)).output)).toEqual([
        osc22("crosshair"),
      ]);
    });

    it("ignores values outside the PointerShape vocabulary", () => {
      let bogus = "x\x1b]0;pwned\x07" as PointerShape;
      let output = term.render(layout({ cursor: bogus }), LINK).output;
      expect(decode(output)).not.toContain("pwned");
      expect(sequences(output)).toEqual([]);
    });

    it("resolves replayed descendants against each render's pointer", async () => {
      let direct = await createTerm({ width: 40, height: 6 });
      direct.update([SUPPORTED]);
      direct.render(layout());
      let previous = term.render(layout());
      let steps = [
        [LINK, [osc22("pointer")]],
        [FIELD, [osc22("text")]],
        [FIELD, []],
        [PLAIN, [osc22("default")]],
        [undefined, []],
        [FIELD, [osc22("text")]],
      ] as const;
      for (let [options, shapes] of steps) {
        let expected = direct.render(layout(), options);
        previous = term.render([previous.info.get("root")!.replay], options);
        expect(sequences(previous.output)).toEqual(shapes);
        expect(decode(previous.output)).toEqual(decode(expected.output));
        expect(previous.events).toEqual(expected.events);
      }
    });

    it("lets a capture-mode floating overlay win over what is beneath", () => {
      let ops = layout();
      ops.splice(
        ops.length - 1,
        0,
        open("menu", {
          layout: { width: fixed(6), height: fixed(3) },
          floating: { x: 1, y: 3, attachTo: "root" },
          cursor: "grab",
        }),
        close(),
      );
      expect(sequences(term.render(ops, LINK).output)).toEqual([
        osc22("grab"),
      ]);
    });

    it("lets a passthrough floating overlay defer to what is beneath", () => {
      let ops = layout();
      ops.splice(
        ops.length - 1,
        0,
        open("tooltip", {
          layout: { width: fixed(6), height: fixed(3) },
          floating: {
            x: 1,
            y: 3,
            attachTo: "root",
            pointerCaptureMode: "passthrough",
          },
          cursor: "help",
        }),
        close(),
      );
      expect(sequences(term.render(ops, LINK).output)).toEqual([
        osc22("pointer"),
      ]);
    });
  });

  describe("restore", () => {
    it("resets to default when the pointer moves off declaring elements", () => {
      term.render(layout(), LINK);
      expect(sequences(term.render(layout(), PLAIN).output)).toEqual([
        osc22("default"),
      ]);
    });

    it("resets to default on a render without pointer", () => {
      term.render(layout(), LINK);
      expect(sequences(term.render(layout()).output)).toEqual([
        osc22("default"),
      ]);
    });

    it("emits no shape changes or resets while the capability is withdrawn", () => {
      term.render(layout(), LINK);
      expect(term.update([WITHDRAWN])).toBeUndefined();
      expect(term.capabilities.pointerShape).toBe(false);
      expect(sequences(term.render(layout(), LINK).output)).toEqual([]);
      expect(sequences(term.render(layout(), FIELD).output)).toEqual([]);
      expect(sequences(term.render(layout()).output)).toEqual([]);
      expect(sequences(term.render(layout(), { mode: "line" }).output)).toEqual(
        [],
      );
    });

    it("compares with the last emitted shape after disabled renders", () => {
      term.render(layout(), LINK);
      term.update([WITHDRAWN]);
      term.render(layout(), FIELD);
      term.render(layout());
      term.update([SUPPORTED]);

      expect(sequences(term.render(layout(), LINK).output)).toEqual([]);
      expect(sequences(term.render(layout(), FIELD).output)).toEqual([
        osc22("text"),
      ]);
    });

    it("resets an emitted shape only when an enabled render resolves default", () => {
      term.render(layout(), LINK);
      term.update([WITHDRAWN]);
      expect(sequences(term.render(layout()).output)).toEqual([]);
      term.update([SUPPORTED]);

      expect(sequences(term.render(layout()).output)).toEqual([
        osc22("default"),
      ]);
      expect(sequences(term.render(layout()).output)).toEqual([]);
    });

    it("preserves the emitted shape across capability toggles before rendering", () => {
      term.render(layout(), LINK);
      expect(term.update([WITHDRAWN, SUPPORTED, WITHDRAWN])).toBeUndefined();
      expect(term.capabilities.pointerShape).toBe(false);
      expect(term.update([SUPPORTED])).toBeUndefined();
      expect(term.capabilities.pointerShape).toBe(true);
      expect(sequences(term.render(layout(), LINK).output)).toEqual([]);
    });

    it("keeps the emitted shape and capability through growth and shrink", () => {
      term.render(layout(), LINK);
      for (let [width, height] of [[120, 40], [40, 6]]) {
        expect(term.update([{ type: "resize", width, height }]))
          .toBeUndefined();
        expect(term.capabilities.pointerShape).toBe(true);
        expect(sequences(term.render(layout(), LINK).output)).toEqual([]);
        expect(sequences(term.render(layout(), FIELD).output)).toEqual([
          osc22("text"),
        ]);
        expect(sequences(term.render(layout(), LINK).output)).toEqual([
          osc22("pointer"),
        ]);
      }
      expect(sequences(term.render(layout(), PLAIN).output)).toEqual([
        osc22("default"),
      ]);
    });

    it("retains the emitted shape when capability changes are interleaved with resizes", () => {
      term.render(layout(), LINK);
      expect(term.update([
        { type: "resize", width: 120, height: 40 },
        WITHDRAWN,
        { type: "resize", width: 40, height: 6 },
        WITHDRAWN,
      ])).toBeUndefined();
      expect(term.capabilities.pointerShape).toBe(false);
      expect(sequences(term.render(layout(), FIELD).output)).toEqual([]);

      expect(term.update([
        { type: "resize", width: 120, height: 40 },
        SUPPORTED,
        { type: "resize", width: 40, height: 6 },
      ])).toBeUndefined();
      expect(term.capabilities.pointerShape).toBe(true);
      expect(sequences(term.render(layout(), LINK).output)).toEqual([]);
      expect(sequences(term.render(layout(), FIELD).output)).toEqual([
        osc22("text"),
      ]);
    });
  });
});
