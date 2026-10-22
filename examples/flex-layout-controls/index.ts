/**
 * Flex layout controls demo — showcases `layout.alignSelf` and `stretch()`.
 *
 * The colored rows make per-child cross-axis alignment visible:
 *   - `alignSelf` overrides parent alignment for one child at a time.
 *   - `stretch()` explicitly fills the parent's cross-axis content extent.
 *   - `normal` / `stretch` align-self values stretch auto-like cross sizes.
 *   - definite cross sizes remain definite under stretch alignment.
 */

import { Buffer } from "node:buffer";
import process from "node:process";
import {
  close,
  createTerm,
  CSI,
  fit,
  fixed,
  grow,
  type Op,
  open,
  percent,
  rgba,
  stretch,
  text,
} from "../../mod.ts";
import { validated } from "../../validate.ts";

const write = (b: Uint8Array) => process.stdout.write(Buffer.from(b));

const FG = rgba(238, 238, 232);
const MUTED = rgba(150, 155, 165);
const TITLE = rgba(255, 220, 140);
const BG = rgba(18, 20, 28);
const CARD = rgba(30, 34, 48);
const BORDER = rgba(90, 96, 130);
const BLUE = rgba(52, 102, 166);
const GREEN = rgba(48, 126, 84);
const PURPLE = rgba(111, 76, 160);
const ORANGE = rgba(168, 104, 48);
const RED = rgba(150, 68, 70);
const TEAL = rgba(50, 128, 132);

let { columns } = terminalSize();
let width = Math.max(72, Math.min(columns, 96));
let height = 42;
let term = validated(await createTerm({ width, height }));
let result = term.render(render(width, height), { mode: "line" });

write(result.output);
write(CSI("0m"));
write(new TextEncoder().encode("\n"));

function render(width: number, height: number): Op[] {
  let ops: Op[] = [
    open("root", {
      layout: {
        width: fixed(width),
        height: fixed(height),
        direction: "ttb",
        padding: { left: 1, right: 1, top: 1 },
        gap: 1,
      },
      bg: BG,
    }),
  ];

  ops.push(
    open("title", { layout: { width: grow(), height: fixed(1) } }),
    text("Clayterm flex layout controls", { color: TITLE }),
    text("  alignSelf + stretch()", { color: MUTED }),
    close(),
  );

  alignSelfCard(ops);
  stretchCard(ops);
  rulesCard(ops);

  ops.push(
    open("footer", { layout: { width: grow(), height: fixed(1) } }),
    text("Tip: colored backgrounds show each element's actual bounds.", {
      color: MUTED,
    }),
    close(),
    close(),
  );

  return ops;
}

function alignSelfCard(ops: Op[]) {
  ops.push(
    open("align-self-card", {
      layout: {
        width: grow(),
        height: fixed(19),
        direction: "ttb",
        padding: { left: 2, right: 2, top: 1, bottom: 1 },
        gap: 1,
        alignX: "right",
      },
      bg: CARD,
      border: { color: BORDER, left: 1, right: 1, top: 1, bottom: 1 },
    }),
  );

  badge(ops, "align-title", "Parent alignX is right; each row opts in/out", {
    alignSelf: "start",
    color: TITLE,
  });
  badge(ops, "align-auto", 'auto: follows parent alignX="right"', {
    alignSelf: "auto",
    bg: BLUE,
  });
  badge(ops, "align-start", "start: cross-start (left)", {
    alignSelf: "start",
    bg: GREEN,
  });
  badge(ops, "align-flex-start", "flex-start: same as start", {
    alignSelf: "flex-start",
    bg: GREEN,
  });
  badge(ops, "align-center", "center: centered per child", {
    alignSelf: "center",
    bg: PURPLE,
  });
  badge(ops, "align-end", "end: cross-end (right)", {
    alignSelf: "end",
    bg: ORANGE,
  });
  badge(ops, "align-flex-end", "flex-end: same as end", {
    alignSelf: "flex-end",
    bg: ORANGE,
  });
  badge(ops, "align-stretch", "stretch: auto-like width fills content box", {
    alignSelf: "stretch",
    bg: TEAL,
  });
  badge(ops, "align-normal", "normal: stretches auto-like cross size too", {
    alignSelf: "normal",
    bg: TEAL,
  });

  ops.push(close());
}

function stretchCard(ops: Op[]) {
  ops.push(
    open("stretch-card", {
      layout: {
        width: grow(),
        height: fixed(8),
        direction: "ttb",
        padding: { left: 2, right: 2, top: 1 },
      },
      bg: CARD,
      border: { color: BORDER, left: 1, right: 1, top: 1, bottom: 1 },
    }),
  );

  badge(ops, "stretch-title", "stretch() helper", {
    alignSelf: "start",
    color: TITLE,
  });

  ops.push(
    open("width-stretch", {
      layout: { width: stretch(), height: fixed(1) },
      bg: GREEN,
    }),
    text("width: stretch() in a top-to-bottom parent fills horizontally", {
      color: FG,
    }),
    close(),
  );

  ops.push(
    open("height-demo-row", {
      layout: { width: grow(), height: fixed(4), direction: "ltr", gap: 2 },
    }),
    open("height-stretch", {
      layout: {
        width: fixed(24),
        height: stretch(),
        direction: "ttb",
        padding: { left: 1, top: 1 },
      },
      bg: BLUE,
      border: { color: BORDER, left: 1, right: 1, top: 1, bottom: 1 },
    }),
    text("height: stretch()", { color: FG }),
    close(),
    open("height-note", {
      layout: { width: grow(), height: fixed(4), direction: "ttb" },
    }),
    text("In a left-to-right parent, the cross axis is vertical.", {
      color: FG,
    }),
    text("Use grow() for main-axis free-space distribution.", {
      color: MUTED,
    }),
    close(),
    close(),
  );

  ops.push(close());
}

function rulesCard(ops: Op[]) {
  ops.push(
    open("rules-card", {
      layout: {
        width: grow(),
        height: fixed(7),
        direction: "ttb",
        padding: { left: 2, right: 2, top: 1 },
        alignX: "right",
      },
      bg: CARD,
      border: { color: BORDER, left: 1, right: 1, top: 1, bottom: 1 },
    }),
  );

  badge(ops, "rules-title", "Stretch alignment rules", {
    alignSelf: "start",
    color: TITLE,
  });
  badge(ops, "rules-auto", "auto still follows parent right alignment", {
    alignSelf: "auto",
    bg: BLUE,
  });
  badge(ops, "rules-normal", "normal + omitted width fills the content box", {
    alignSelf: "normal",
    bg: TEAL,
  });
  badge(ops, "rules-fixed", "fixed(28) + stretch stays fixed at start", {
    alignSelf: "stretch",
    width: fixed(28),
    bg: RED,
  });
  badge(ops, "rules-percent", "percent(50%) + stretch stays definite", {
    alignSelf: "stretch",
    width: percent(0.5),
    bg: ORANGE,
  });

  ops.push(close());
}

function badge(
  ops: Op[],
  id: string,
  label: string,
  options: {
    alignSelf?:
      | "auto"
      | "normal"
      | "stretch"
      | "center"
      | "start"
      | "end"
      | "flex-start"
      | "flex-end";
    width?: ReturnType<typeof fit>;
    bg?: number;
    color?: number;
  } = {},
) {
  ops.push(
    open(id, {
      layout: {
        width: options.width ?? fit(),
        height: fixed(1),
        alignSelf: options.alignSelf,
      },
      bg: options.bg,
    }),
    text(` ${label} `, { color: options.color ?? FG }),
    close(),
  );
}

function terminalSize(): { columns: number; rows: number } {
  return process.stdout.isTTY
    ? {
      columns: process.stdout.columns ?? 96,
      rows: process.stdout.rows ?? 42,
    }
    : { columns: 96, rows: 42 };
}
