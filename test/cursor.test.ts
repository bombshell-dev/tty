import { beforeEach, describe, expect, it } from "./suite.ts";
import { createTerm, type Term } from "../term.ts";
import { close, fixed, grow, open, text } from "../ops.ts";

const decoder = new TextDecoder();

function shown(bytes: Uint8Array | undefined): string | undefined {
  return bytes === undefined ? undefined : decoder.decode(bytes);
}

const SET = (shape: string) => `\x1b]22;${shape}\x1b\\`;

// ┌─root (40x10, ltr)──────────────────┐
// │┌─btn (20x10)──┐┌─field (20x10)───┐│
// ││ cursor:pointer ││ cursor:text     ││
// │└───────────────┘└────────────────┘│
// └───────────────────────────────────┘
function layout() {
  return [
    open("root", {
      layout: { width: grow(), height: grow(), direction: "ltr" },
    }),
    open("btn", {
      layout: { width: fixed(20), height: fixed(10) },
      cursor: "pointer",
    }),
    text("B"),
    close(),
    open("field", {
      layout: { width: fixed(20), height: fixed(10) },
      cursor: "text",
    }),
    text("F"),
    close(),
    close(),
  ];
}

describe("pointer shape tracking", () => {
  let term: Term;

  beforeEach(async () => {
    term = await createTerm({ width: 40, height: 10 });
  });

  it("emits no cursor field when trackCursor is not enabled", () => {
    let result = term.render(layout(), {
      pointer: { x: 5, y: 5, down: false },
    });
    expect(result.cursor).toBeUndefined();
  });

  it("sets the shape when the pointer enters a declaring element", () => {
    let result = term.render(layout(), {
      pointer: { x: 5, y: 5, down: false },
      trackCursor: true,
    });
    expect(shown(result.cursor)).toBe(SET("pointer"));
  });

  it("emits nothing on a subsequent frame over the same element", () => {
    term.render(layout(), {
      pointer: { x: 5, y: 5, down: false },
      trackCursor: true,
    });
    let result = term.render(layout(), {
      pointer: { x: 6, y: 5, down: false },
      trackCursor: true,
    });
    expect(result.cursor).toBeUndefined();
  });

  it("sets the new shape when moving between elements of different shapes", () => {
    term.render(layout(), {
      pointer: { x: 5, y: 5, down: false },
      trackCursor: true,
    });
    let result = term.render(layout(), {
      pointer: { x: 25, y: 5, down: false },
      trackCursor: true,
    });
    expect(shown(result.cursor)).toBe(SET("text"));
  });

  it("restores default when the pointer leaves all declaring elements", () => {
    term.render(layout(), {
      pointer: { x: 5, y: 5, down: false },
      trackCursor: true,
    });
    let result = term.render(layout(), {
      pointer: { x: 100, y: 100, down: false },
      trackCursor: true,
    });
    expect(shown(result.cursor)).toBe(SET("default"));
  });

  it("restores default when the pointer is removed entirely", () => {
    term.render(layout(), {
      pointer: { x: 5, y: 5, down: false },
      trackCursor: true,
    });
    let result = term.render(layout(), { trackCursor: true });
    expect(shown(result.cursor)).toBe(SET("default"));
  });

  it("uses the topmost (innermost) declaring element's shape", () => {
    // root declares "default"; the inner box declares "pointer".
    let nested = () => [
      open("root", {
        layout: { width: grow(), height: grow() },
        cursor: "default",
      }),
      open("inner", {
        layout: { width: fixed(10), height: fixed(5) },
        cursor: "pointer",
      }),
      text("x"),
      close(),
      close(),
    ];
    let result = term.render(nested(), {
      pointer: { x: 2, y: 2, down: false },
      trackCursor: true,
    });
    expect(shown(result.cursor)).toBe(SET("pointer"));
  });

  it("emits nothing when the hovered element declares no shape", () => {
    let plain = () => [
      open("root", { layout: { width: grow(), height: grow() } }),
      text("x"),
      close(),
    ];
    let result = term.render(plain(), {
      pointer: { x: 2, y: 2, down: false },
      trackCursor: true,
    });
    expect(result.cursor).toBeUndefined();
  });
});
