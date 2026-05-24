import { Bench } from "tinybench";
import { withCodSpeed } from "@codspeed/tinybench-plugin";
import { close, fixed, grow, open, pack, rgba, text } from "../ops.ts";
import type { Op } from "../ops.ts";

function makeBuf(size: number): ArrayBuffer {
  return new ArrayBuffer(size);
}

let simpleOps: Op[] = [
  open("root", {
    layout: { width: grow(), height: grow(), direction: "ttb" },
  }),
  text("Hello, World!"),
  close(),
];

let complexOps: Op[] = [
  open("root", {
    layout: { width: grow(), height: grow(), direction: "ttb" },
  }),
  open("header", {
    layout: {
      width: grow(),
      height: fixed(3),
      padding: { left: 1, right: 1 },
      direction: "ltr",
    },
    bg: rgba(30, 30, 40),
    border: {
      color: rgba(100, 100, 120),
      bottom: 1,
    },
  }),
  text("Title", { color: rgba(255, 255, 255), fontSize: 1 }),
  close(),
  open("body", {
    layout: {
      width: grow(),
      height: grow(),
      direction: "ltr",
      gap: 1,
    },
  }),
  open("sidebar", {
    layout: {
      width: fixed(20),
      height: grow(),
      direction: "ttb",
      padding: { left: 1, right: 1, top: 1 },
    },
    bg: rgba(25, 25, 35),
    border: {
      color: rgba(60, 60, 80),
      right: 1,
    },
  }),
  text("Menu Item 1"),
  text("Menu Item 2"),
  text("Menu Item 3"),
  close(),
  open("main", {
    layout: {
      width: grow(),
      height: grow(),
      direction: "ttb",
      padding: { left: 2, top: 1 },
    },
  }),
  text("Main content area with longer text to exercise the encoder"),
  close(),
  close(),
  open("footer", {
    layout: {
      width: grow(),
      height: fixed(1),
      padding: { left: 1 },
      direction: "ltr",
    },
    bg: rgba(30, 30, 40),
  }),
  text("Status: OK"),
  close(),
  close(),
];

let listOps: Op[] = [
  open("root", {
    layout: { width: grow(), height: grow(), direction: "ttb" },
  }),
  ...Array.from({ length: 50 }, (_, i) => [
    open(`item-${i}`, {
      layout: {
        width: grow(),
        height: fixed(1),
        padding: { left: 2 },
        direction: "ltr",
      },
      bg: i % 2 === 0 ? rgba(30, 30, 40) : rgba(35, 35, 45),
    }),
    text(`List item ${i}: some description text`),
    close(),
  ]).flat(),
  close(),
];

let bench = withCodSpeed(new Bench());

bench
  .add("simple tree (root + text)", () => {
    let buf = makeBuf(4096);
    pack(simpleOps, buf, 0);
  })
  .add("complex layout (header + sidebar + main + footer)", () => {
    let buf = makeBuf(8192);
    pack(complexOps, buf, 0);
  })
  .add("large list (50 items)", () => {
    let buf = makeBuf(32768);
    pack(listOps, buf, 0);
  });

await bench.run();
console.table(bench.table());
