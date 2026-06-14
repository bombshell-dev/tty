import { close, fixed, open, type OpenElement, rgba } from "../ops.ts";
import { createTerm } from "../term.ts";
import { describe, expect, it } from "./suite.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/* ── Deterministic test colors ────────────────────────────────────── */

const WHITE = rgba(255, 255, 255);
const RED = rgba(255, 0, 0);
const GREEN = rgba(0, 255, 0);
const BLUE = rgba(0, 0, 255);
const YELLOW = rgba(255, 255, 0);
const MAGENTA = rgba(255, 0, 255);
const CYAN = rgba(0, 255, 255);

const FG = {
  white: "\x1b[38;2;255;255;255",
  red: "\x1b[38;2;255;0;0",
  green: "\x1b[38;2;0;255;0",
  blue: "\x1b[38;2;0;0;255",
  yellow: "\x1b[38;2;255;255;0",
  magenta: "\x1b[38;2;255;0;255",
  cyan: "\x1b[38;2;0;255;255",
};

const BG = {
  white: "\x1b[48;2;255;255;255",
  red: "\x1b[48;2;255;0;0",
  green: "\x1b[48;2;0;255;0",
  blue: "\x1b[48;2;0;0;255",
  yellow: "\x1b[48;2;255;255;0",
  magenta: "\x1b[48;2;255;0;255",
  cyan: "\x1b[48;2;0;255;255",
};

/* ── ANSI cell parser ─────────────────────────────────────────────── */

type ParsedCell = {
  x: number;
  y: number;
  ch: string;
  fg?: string;
  bg?: string;
};

function cells(ansi: string): ParsedCell[] {
  let result: ParsedCell[] = [];
  let fg: string | undefined;
  let bg: string | undefined;
  let x = 0;
  let y = 0;

  for (let i = 0; i < ansi.length;) {
    if (ansi[i] === "\x1b" && ansi[i + 1] === "[") {
      let end = i + 2;
      while (end < ansi.length && !/[A-Za-z]/.test(ansi[end])) {
        end++;
      }

      let seq = ansi.slice(i, end + 1);
      if (seq === "\x1b[0m") {
        fg = undefined;
        bg = undefined;
      } else if (seq.startsWith("\x1b[38;2;") && seq.endsWith("m")) {
        fg = seq.slice(0, -1);
      } else if (seq.startsWith("\x1b[48;2;") && seq.endsWith("m")) {
        bg = seq.slice(0, -1);
      }

      i = end + 1;
      continue;
    }

    if (ansi[i] === "\n") {
      y++;
      x = 0;
      i++;
      continue;
    }

    result.push({ x, y, ch: ansi[i], fg, bg });
    x++;
    i++;
  }

  return result;
}

function at(parsed: ParsedCell[], x: number, y: number): ParsedCell {
  let cell = parsed.find((c) => c.x === x && c.y === y);
  expect(cell).toBeDefined();
  return cell!;
}

function glyphs(parsed: ParsedCell[], chars: string): ParsedCell[] {
  return parsed.filter((c) => chars.includes(c.ch));
}

const CORNERS = "┌┐└┘╭╮╰╯";

/* ── Render helper ────────────────────────────────────────────────── */

type OpenProps = Omit<OpenElement, "directive" | "id">;

/** Renders an 8x4 "box" element at the origin of a 12x5 term in line
 * mode and parses the full-frame output into cells. Box corners are at
 * (0,0), (7,0), (0,3), (7,3). */
async function renderBox(props: OpenProps): Promise<ParsedCell[]> {
  let term = await createTerm({ width: 12, height: 5 });
  let ansi = decode(
    term.render([
      open("box", {
        layout: { width: fixed(8), height: fixed(4) },
        ...props,
      }),
      close(),
    ], { mode: "line" }).output,
  );
  return cells(ansi);
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe("scalar sides", () => {
  it("renders a full box from scalar widths with the shared color", async () => {
    let parsed = await renderBox({
      border: { color: WHITE, top: 1, right: 1, bottom: 1, left: 1 },
    });

    expect(at(parsed, 0, 0).ch).toBe("┌");
    expect(at(parsed, 7, 0).ch).toBe("┐");
    expect(at(parsed, 0, 3).ch).toBe("└");
    expect(at(parsed, 7, 3).ch).toBe("┘");
    expect(at(parsed, 3, 0).ch).toBe("─");
    expect(at(parsed, 3, 3).ch).toBe("─");
    expect(at(parsed, 0, 1).ch).toBe("│");
    expect(at(parsed, 7, 1).ch).toBe("│");

    for (let cell of glyphs(parsed, "┌┐└┘─│")) {
      expect(cell.fg).toBe(FG.white);
    }
  });

  it("applies shared bg to scalar sides", async () => {
    let parsed = await renderBox({
      border: { color: WHITE, bg: BLUE, top: 1, right: 1, bottom: 1, left: 1 },
    });

    for (let cell of glyphs(parsed, "┌┐└┘─│")) {
      expect(cell.bg).toBe(BG.blue);
    }
  });
});

describe("structured sides", () => {
  it("accepts every structured side form and resolves fallbacks", async () => {
    let parsed = await renderBox({
      border: {
        color: WHITE,
        bg: MAGENTA,
        top: { width: 1 },
        right: { width: 1, color: RED },
        bottom: { width: 1, bg: BLUE },
        left: { width: 1, color: GREEN, bg: YELLOW },
      },
    });

    // top: shared color, shared bg
    expect(at(parsed, 3, 0).ch).toBe("─");
    expect(at(parsed, 3, 0).fg).toBe(FG.white);
    expect(at(parsed, 3, 0).bg).toBe(BG.magenta);

    // right: own color, shared bg
    expect(at(parsed, 7, 1).ch).toBe("│");
    expect(at(parsed, 7, 1).fg).toBe(FG.red);
    expect(at(parsed, 7, 1).bg).toBe(BG.magenta);

    // bottom: shared color, own bg
    expect(at(parsed, 3, 3).ch).toBe("─");
    expect(at(parsed, 3, 3).fg).toBe(FG.white);
    expect(at(parsed, 3, 3).bg).toBe(BG.blue);

    // left: own color, own bg
    expect(at(parsed, 0, 1).ch).toBe("│");
    expect(at(parsed, 0, 1).fg).toBe(FG.green);
    expect(at(parsed, 0, 1).bg).toBe(BG.yellow);
  });

  it("overrides shared color per side; omitted colors inherit it", async () => {
    let parsed = await renderBox({
      border: {
        color: WHITE,
        top: { width: 1, color: RED },
        bottom: { width: 1, color: GREEN },
        left: 1,
        right: { width: 1 },
      },
    });

    expect(at(parsed, 3, 0).fg).toBe(FG.red);
    expect(at(parsed, 3, 3).fg).toBe(FG.green);
    expect(at(parsed, 0, 1).fg).toBe(FG.white);
    expect(at(parsed, 7, 1).fg).toBe(FG.white);
  });

  it("overrides shared bg per side; omitted bgs inherit it", async () => {
    let parsed = await renderBox({
      border: {
        color: WHITE,
        bg: BLUE,
        top: 1,
        bottom: { width: 1 },
        left: { width: 1, bg: RED },
        right: 1,
      },
    });

    expect(at(parsed, 3, 0).bg).toBe(BG.blue); // scalar side, shared bg
    expect(at(parsed, 3, 3).bg).toBe(BG.blue); // structured side, shared bg
    expect(at(parsed, 0, 1).bg).toBe(BG.red); // structured side, own bg
    expect(at(parsed, 7, 1).bg).toBe(BG.blue); // scalar side, shared bg
  });

  it("preserves the element bg when no border bg is provided", async () => {
    let parsed = await renderBox({
      bg: CYAN,
      border: {
        color: WHITE,
        top: { width: 1, color: RED },
        right: { width: 1 },
        bottom: 1,
        left: 1,
      },
    });

    for (let cell of glyphs(parsed, "┌┐└┘─│")) {
      expect(cell.bg).toBe(BG.cyan);
    }
  });

  it("emits no border bg when neither side nor shared bg is set", async () => {
    let parsed = await renderBox({
      border: {
        color: WHITE,
        top: { width: 1, color: RED },
        right: 1,
        bottom: { width: 1 },
        left: 1,
      },
    });

    for (let cell of glyphs(parsed, "┌┐└┘─│")) {
      expect(cell.bg).toBeUndefined();
    }
  });

  it("does not retain a prior frame's side bg", async () => {
    let term = await createTerm({ width: 12, height: 5 });
    let frame = (bg?: number) => [
      open("box", {
        layout: { width: fixed(8), height: fixed(4) },
        border: {
          color: WHITE,
          top: bg === undefined ? { width: 1 } : { width: 1, bg },
          right: 1,
          bottom: 1,
          left: 1,
        },
      }),
      close(),
    ];

    term.render(frame(BLUE));
    let ansi = decode(term.render(frame()).output);

    expect(ansi).not.toContain(BG.blue);
    let top = cells(ansi).find((c) => c.ch === "─");
    expect(top).toBeDefined();
    expect(top!.bg).toBeUndefined();
  });
});

describe("independent sides", () => {
  it("draws only sides with resolved width > 0", async () => {
    let drawn = await renderBox({
      border: { color: WHITE, top: { width: 1 } },
    });
    expect(glyphs(drawn, "─").length).toBe(8);

    let zeroObject = await renderBox({
      border: { color: WHITE, top: { width: 0 }, left: 1 },
    });
    expect(glyphs(zeroObject, "─").length).toBe(0);

    let zeroScalar = await renderBox({
      border: { color: WHITE, top: 0, left: 1 },
    });
    expect(glyphs(zeroScalar, "─").length).toBe(0);
  });

  it("renders a left-only border as a straight vertical line", async () => {
    let parsed = await renderBox({ border: { color: WHITE, left: 1 } });
    expect(glyphs(parsed, "│").length).toBe(4);
    expect(glyphs(parsed, "│").every((c) => c.x === 0)).toBe(true);
    expect(glyphs(parsed, CORNERS).length).toBe(0);
  });

  it("renders a right-only border as a straight vertical line", async () => {
    let parsed = await renderBox({ border: { color: WHITE, right: 1 } });
    expect(glyphs(parsed, "│").length).toBe(4);
    expect(glyphs(parsed, "│").every((c) => c.x === 7)).toBe(true);
    expect(glyphs(parsed, CORNERS).length).toBe(0);
  });

  it("renders a top-only border as a straight horizontal line", async () => {
    let parsed = await renderBox({ border: { color: WHITE, top: 1 } });
    expect(glyphs(parsed, "─").length).toBe(8);
    expect(glyphs(parsed, "─").every((c) => c.y === 0)).toBe(true);
    expect(glyphs(parsed, CORNERS).length).toBe(0);
  });

  it("renders a bottom-only border as a straight horizontal line", async () => {
    let parsed = await renderBox({ border: { color: WHITE, bottom: 1 } });
    expect(glyphs(parsed, "─").length).toBe(8);
    expect(glyphs(parsed, "─").every((c) => c.y === 3)).toBe(true);
    expect(glyphs(parsed, CORNERS).length).toBe(0);
  });

  it("renders top + bottom as two straight lines without corners", async () => {
    let parsed = await renderBox({
      border: { color: WHITE, top: 1, bottom: 1 },
    });
    expect(glyphs(parsed, "─").length).toBe(16);
    expect(glyphs(parsed, "│").length).toBe(0);
    expect(glyphs(parsed, CORNERS).length).toBe(0);
  });
});

describe("corners", () => {
  it("creates a corner only where both adjacent sides are enabled", async () => {
    let tl = await renderBox({ border: { color: WHITE, top: 1, left: 1 } });
    expect(at(tl, 0, 0).ch).toBe("┌");
    expect(glyphs(tl, CORNERS).length).toBe(1);

    let tr = await renderBox({ border: { color: WHITE, top: 1, right: 1 } });
    expect(at(tr, 7, 0).ch).toBe("┐");
    expect(glyphs(tr, CORNERS).length).toBe(1);

    let bl = await renderBox({ border: { color: WHITE, bottom: 1, left: 1 } });
    expect(at(bl, 0, 3).ch).toBe("└");
    expect(glyphs(bl, CORNERS).length).toBe(1);

    let br = await renderBox({ border: { color: WHITE, bottom: 1, right: 1 } });
    expect(at(br, 7, 3).ch).toBe("┘");
    expect(glyphs(br, CORNERS).length).toBe(1);
  });

  it("draws no corner when an adjacent side has zero width", async () => {
    let scalarZero = await renderBox({
      border: { color: WHITE, top: 1, left: 0 },
    });
    expect(glyphs(scalarZero, CORNERS).length).toBe(0);

    let objectZero = await renderBox({
      border: { color: WHITE, bottom: 1, right: { width: 0 } },
    });
    expect(glyphs(objectZero, CORNERS).length).toBe(0);
  });

  it("styles top corners from top and bottom corners from bottom", async () => {
    let parsed = await renderBox({
      border: {
        color: WHITE,
        top: { width: 1, color: RED, bg: MAGENTA },
        right: { width: 1, color: YELLOW },
        bottom: { width: 1, color: GREEN, bg: CYAN },
        left: { width: 1, color: BLUE },
      },
    });

    // top corners take top attributes
    expect(at(parsed, 0, 0).ch).toBe("┌");
    expect(at(parsed, 0, 0).fg).toBe(FG.red);
    expect(at(parsed, 0, 0).bg).toBe(BG.magenta);
    expect(at(parsed, 7, 0).ch).toBe("┐");
    expect(at(parsed, 7, 0).fg).toBe(FG.red);
    expect(at(parsed, 7, 0).bg).toBe(BG.magenta);

    // bottom corners take bottom attributes
    expect(at(parsed, 0, 3).ch).toBe("└");
    expect(at(parsed, 0, 3).fg).toBe(FG.green);
    expect(at(parsed, 0, 3).bg).toBe(BG.cyan);
    expect(at(parsed, 7, 3).ch).toBe("┘");
    expect(at(parsed, 7, 3).fg).toBe(FG.green);
    expect(at(parsed, 7, 3).bg).toBe(BG.cyan);

    // horizontal edges remain continuous with their corners
    expect(at(parsed, 3, 0).fg).toBe(FG.red);
    expect(at(parsed, 3, 3).fg).toBe(FG.green);

    // non-corner vertical edge cells take left/right attributes
    expect(at(parsed, 0, 1).fg).toBe(FG.blue);
    expect(at(parsed, 0, 2).fg).toBe(FG.blue);
    expect(at(parsed, 7, 1).fg).toBe(FG.yellow);
    expect(at(parsed, 7, 2).fg).toBe(FG.yellow);
  });

  it("keeps rounded corner glyphs; side attrs only restyle them", async () => {
    let parsed = await renderBox({
      cornerRadius: { tl: 1, tr: 1, bl: 1, br: 1 },
      border: {
        color: WHITE,
        top: { width: 1, color: RED },
        right: 1,
        bottom: { width: 1, color: GREEN },
        left: 1,
      },
    });

    expect(at(parsed, 0, 0).ch).toBe("╭");
    expect(at(parsed, 7, 0).ch).toBe("╮");
    expect(at(parsed, 0, 3).ch).toBe("╰");
    expect(at(parsed, 7, 3).ch).toBe("╯");
    expect(at(parsed, 0, 0).fg).toBe(FG.red);
    expect(at(parsed, 7, 0).fg).toBe(FG.red);
    expect(at(parsed, 0, 3).fg).toBe(FG.green);
    expect(at(parsed, 7, 3).fg).toBe(FG.green);
  });
});

describe("directive model", () => {
  it("keeps structured side declarations as plain data", () => {
    let directive = open("box", {
      border: { color: WHITE, top: { width: 1, color: RED } },
    });

    expect(Object.getPrototypeOf(directive)).toBe(Object.prototype);
    expect(directive.border?.top).toEqual({ width: 1, color: RED });
  });
});

describe("instances", () => {
  it("does not share side attributes between Term instances", async () => {
    let a = await createTerm({ width: 12, height: 5 });
    let b = await createTerm({ width: 12, height: 5 });

    let frame = (top: number, bottom: number) => [
      open("box", {
        layout: { width: fixed(8), height: fixed(4) },
        border: {
          color: WHITE,
          top: { width: 1, color: top },
          bottom: { width: 1, color: bottom },
        },
      }),
      close(),
    ];

    let ansiA = decode(a.render(frame(RED, GREEN), { mode: "line" }).output);
    let ansiB = decode(b.render(frame(BLUE, YELLOW), { mode: "line" }).output);

    expect(ansiA).toContain(FG.red);
    expect(ansiA).toContain(FG.green);
    expect(ansiA).not.toContain(FG.blue);
    expect(ansiA).not.toContain(FG.yellow);

    expect(ansiB).toContain(FG.blue);
    expect(ansiB).toContain(FG.yellow);
    expect(ansiB).not.toContain(FG.red);
    expect(ansiB).not.toContain(FG.green);

    // re-rendering A must not affect B's next frame
    a.render(frame(MAGENTA, CYAN), { mode: "line" });
    let again = decode(b.render(frame(BLUE, YELLOW), { mode: "line" }).output);
    expect(again).not.toContain(FG.magenta);
    expect(again).not.toContain(FG.cyan);
  });
});
