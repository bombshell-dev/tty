/**
 * Diff demo — renders a code-review style diff with inline text backgrounds.
 *
 * Shows how text-level `bg` can highlight only changed glyph cells without
 * filling the entire row or layout box.
 */

import { Buffer } from "node:buffer";
import process from "node:process";
import {
  close,
  createTerm,
  CSI,
  fixed,
  grow,
  type Op,
  open,
  rgba,
  text,
} from "../../mod.ts";
import { validated } from "../../validate.ts";

const encode = (s: string) => new TextEncoder().encode(s);
const write = (b: Uint8Array) => process.stdout.write(Buffer.from(b));

const BG = rgba(31, 45, 34);
const FG = rgba(220, 220, 210);
const MUTED = rgba(140, 145, 140);
const PATH = rgba(139, 210, 210);
const DELETE = rgba(255, 105, 105);
const DELETE_BG = rgba(184, 92, 85);
const ADD = rgba(190, 210, 100);
const ADD_BG = rgba(190, 210, 100);
const INLINE_FG = rgba(31, 45, 34);

const rows: Row[] = [
  {
    kind: "title",
    segments: [
      { value: "edit ", color: FG },
      { value: "examples/inline-regions/index.ts", color: PATH },
    ],
  },
  { kind: "blank" },
  code("    ", MUTED, [{ value: "...", color: MUTED }]),
  code("  35", MUTED, [
    {
      value:
        "const write = (b: Uint8Array) => process.stdout.write(Buffer.from(b));",
    },
  ]),
  code("  36", MUTED, [{ value: "" }]),
  code("  37", MUTED, [{ value: "const WHITE = rgba(255, 255, 255);" }]),
  code("  38", MUTED, [{ value: "const GREEN = rgba(80, 250, 123);" }]),
  code("- 39", DELETE, [
    { value: "const " },
    mark("AGREEN", DELETE_BG),
    { value: " = rgba(" },
    mark("80", DELETE_BG),
    { value: ", " },
    mark("250", DELETE_BG),
    { value: ", " },
    mark("123, 10", DELETE_BG),
    { value: ");" },
  ]),
  code("+ 39", ADD, [
    { value: "const " },
    mark("GREEN_BG", ADD_BG),
    { value: " = rgba(" },
    mark("20", ADD_BG),
    { value: ", " },
    mark("70", ADD_BG),
    { value: ", " },
    mark("38", ADD_BG),
    { value: ");" },
  ]),
  code("  40", MUTED, [{ value: "const GRAY = rgba(100, 100, 100);" }]),
  code("  41", MUTED, [{ value: "const CYAN = rgba(139, 233, 253);" }]),
  code("  42", MUTED, [{ value: "" }]),
  code("  43", MUTED, [{ value: "const RED = rgba(255, 0, 0);" }]),
  code("    ", MUTED, [{ value: "...", color: MUTED }]),
  code(" 136", MUTED, [{ value: "          height: fixed(1)," }]),
  code(" 137", MUTED, [{ value: '          direction: "ltr",' }]),
  code(" 138", MUTED, [{ value: "        }," }]),
  code(" 139", MUTED, [{ value: "      })," }]),
  code("-140", DELETE, [
    { value: '      text(" ✓ Frobnicated ", { color: WHITE, bg: ' },
    mark("AGREEN", DELETE_BG),
    { value: " })," },
  ]),
  code("+140", ADD, [
    { value: '      text(" ✓ Frobnicated ", { color: WHITE, bg: ' },
    mark("GREEN_BG", ADD_BG),
    { value: " })," },
  ]),
  code(" 141", MUTED, [{ value: "      close()," }]),
  code(" 142", MUTED, [{ value: "    ];" }]),
  code(" 143", MUTED, [{ value: "  }" }]),
  code(" 144", MUTED, [{ value: "  let progress = i / (barFrames - 1);" }]),
  code("    ", MUTED, [{ value: "...", color: MUTED }]),
];

let { columns } = terminalSize();
let height = rows.length + 2;
let term = validated(await createTerm({ width: columns, height }));
let result = term.render(renderDiff(columns, height), { mode: "line" });
write(new Uint8Array(result.output));
write(CSI("0m"));
write(encode("\n"));

interface Segment {
  value: string;
  color?: number;
  bg?: number;
}

interface Row {
  kind: "blank" | "code" | "title";
  gutter?: string;
  color?: number;
  segments?: Segment[];
}

function code(gutter: string, color: number, segments: Segment[]): Row {
  return { kind: "code", gutter, color, segments };
}

function mark(value: string, bg: number): Segment {
  return { value, color: INLINE_FG, bg };
}

function renderDiff(width: number, height: number): Op[] {
  let ops: Op[] = [
    open("root", {
      layout: {
        width: fixed(width),
        height: fixed(height),
        direction: "ttb",
        padding: { left: 1, top: 1 },
      },
      bg: BG,
    }),
  ];

  rows.forEach((row, index) => {
    ops.push(
      open(`row-${index}`, {
        layout: { width: grow(), height: fixed(1), direction: "ltr" },
      }),
    );

    if (row.kind === "blank") {
      ops.push(close());
      return;
    }

    if (row.kind === "title") {
      for (let segment of row.segments ?? []) {
        ops.push(text(segment.value, { color: segment.color }));
      }
      ops.push(close());
      return;
    }

    ops.push(text(`${row.gutter ?? ""} `, { color: row.color }));
    for (let segment of row.segments ?? []) {
      ops.push(
        text(segment.value, {
          color: segment.color ?? row.color,
          bg: segment.bg,
        }),
      );
    }
    ops.push(close());
  });

  ops.push(close());
  return ops;
}

function terminalSize(): { columns: number; rows: number } {
  return process.stdout.isTTY
    ? {
      columns: process.stdout.columns ?? 100,
      rows: process.stdout.rows ?? 24,
    }
    : { columns: 100, rows: 24 };
}
