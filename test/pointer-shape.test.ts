import { beforeEach, describe, expect, it } from "./suite.ts";
import { createTerm, type Term } from "../term.ts";
import {
  close,
  fixed,
  grow,
  type Op,
  open,
  type PointerShape,
  snapshot,
  text,
} from "../ops.ts";
import type { CapabilityEvent } from "../input.ts";
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
function layout(link: { pointerShape?: PointerShape } = {}): Op[] {
  return [
    open("root", {
      layout: { width: grow(), height: grow(), direction: "ltr" },
    }),
    open("link", {
      layout: { width: fixed(20), height: fixed(6), direction: "ttb" },
      pointerShape: "pointer",
      ...link,
    }),
    open("field", {
      layout: { width: fixed(10), height: fixed(2) },
      pointerShape: "text",
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

    it("does not read pointerShape without the capability", async () => {
      let unsupported = await createTerm({ width: 40, height: 6 });
      let reads = 0;
      let ops = layout().map((op) =>
        "pointerShape" in op
          ? Object.defineProperty({ ...op }, "pointerShape", {
            get: () => (reads++, "pointer"),
          })
          : op
      );
      unsupported.render(ops, LINK);
      expect(reads).toBe(0);
    });

    it("emits once the capability arrives", async () => {
      let late = await createTerm({ width: 40, height: 6 });
      expect(sequences(late.render(layout(), LINK).output)).toEqual([]);
      expect(late.update([SUPPORTED])).toEqual(new Uint8Array(0));
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
      expect(sequences(term.render(layout(), LINK).output)).toEqual([
        osc22("pointer"),
      ]);
      expect(sequences(term.render(layout(), LINK).output)).toEqual([]);
      expect(sequences(term.render(layout(), over(3, 5)).output)).toEqual([]);
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
          term.render(layout({ pointerShape: "progress" }), LINK)
            .output,
        ),
      ).toEqual([osc22("progress")]);
    });

    it("ignores values outside the PointerShape vocabulary", () => {
      let bogus = "x\x1b]0;pwned\x07" as PointerShape;
      let output = term.render(layout({ pointerShape: bogus }), LINK).output;
      expect(decode(output)).not.toContain("pwned");
      expect(sequences(output)).toEqual([]);
    });

    it("sees elements inside a snapshot", () => {
      let ops = layout();
      let frozen = snapshot(ops.slice(1, -1));
      let result = term.render([ops[0], frozen, ops[ops.length - 1]], FIELD);
      expect(sequences(result.output)).toEqual([osc22("text")]);
    });

    it("lets a capture-mode floating overlay win over what is beneath", () => {
      let ops = layout();
      ops.splice(
        ops.length - 1,
        0,
        open("menu", {
          layout: { width: fixed(6), height: fixed(3) },
          floating: { x: 1, y: 3, attachTo: "root" },
          pointerShape: "grab",
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
          pointerShape: "help",
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

    it("returns the reset from update() when the capability is withdrawn", () => {
      term.render(layout(), LINK);
      expect(decode(term.update([WITHDRAWN]))).toBe(osc22("default"));
      expect(sequences(term.render(layout(), LINK).output)).toEqual([]);
    });

    it("returns nothing from update() when withdrawn at default", () => {
      term.render(layout(), PLAIN);
      expect(term.update([WITHDRAWN])).toEqual(new Uint8Array(0));
    });

    it("returns the reset once from a batch that withdraws twice", () => {
      term.render(layout(), LINK);
      expect(decode(term.update([WITHDRAWN, SUPPORTED, WITHDRAWN]))).toBe(
        osc22("default"),
      );
    });

    it("keeps the emitted shape across a resize", () => {
      term.render(layout(), LINK);
      expect(term.update([{ type: "resize", width: 50, height: 8 }])).toEqual(
        new Uint8Array(0),
      );
      expect(sequences(term.render(layout(), LINK).output)).toEqual([]);
      expect(sequences(term.render(layout(), PLAIN).output)).toEqual([
        osc22("default"),
      ]);
    });
  });
});
