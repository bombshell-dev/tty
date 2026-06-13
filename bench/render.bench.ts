import { Bench } from "tinybench";
import { withCodSpeed } from "@codspeed/tinybench-plugin";
import { createTerm } from "../term.ts";
import { close, fixed, grow, open, rgba, text } from "../ops.ts";
import type { Op } from "../ops.ts";

let term = await createTerm({ width: 80, height: 24 });
let termPtr = await createTerm({ width: 80, height: 24 });

let helloOps: Op[] = [
  open("root", {
    layout: { width: grow(), height: grow(), direction: "ttb" },
  }),
  text("Hello, World!"),
  close(),
];

let borderedOps: Op[] = [
  open("root", {
    layout: { width: grow(), height: grow(), direction: "ttb" },
  }),
  open("box", {
    layout: {
      width: grow(),
      height: grow(),
      padding: { left: 1, right: 1, top: 1, bottom: 1 },
      direction: "ttb",
    },
    border: {
      color: rgba(0, 255, 0),
      left: 1,
      right: 1,
      top: 1,
      bottom: 1,
    },
    cornerRadius: { tl: 1, tr: 1, bl: 1, br: 1 },
  }),
  text("Bordered content"),
  close(),
  close(),
];

let dashboardOps: Op[] = [
  open("root", {
    layout: { width: grow(), height: grow(), direction: "ttb" },
  }),
  open("header", {
    layout: {
      width: grow(),
      height: fixed(3),
      padding: { left: 1 },
      direction: "ltr",
    },
    bg: rgba(30, 30, 40),
    border: { color: rgba(80, 80, 100), bottom: 1 },
  }),
  text("Dashboard", { color: rgba(255, 255, 255) }),
  close(),
  open("body", {
    layout: { width: grow(), height: grow(), direction: "ltr" },
  }),
  open("sidebar", {
    layout: {
      width: fixed(20),
      height: grow(),
      direction: "ttb",
      padding: { left: 1, top: 1 },
    },
    bg: rgba(25, 25, 35),
    border: { color: rgba(60, 60, 80), right: 1 },
  }),
  text("Nav 1"),
  text("Nav 2"),
  text("Nav 3"),
  text("Nav 4"),
  close(),
  open("main", {
    layout: {
      width: grow(),
      height: grow(),
      direction: "ttb",
      padding: { left: 2, top: 1 },
    },
  }),
  ...Array.from({ length: 10 }, (_, i) => [
    open(`row-${i}`, {
      layout: {
        width: grow(),
        height: fixed(1),
        direction: "ltr",
      },
      bg: i % 2 === 0 ? rgba(35, 35, 45) : undefined,
    }),
    text(`Row ${i}: data value ${i * 42}`),
    close(),
  ]).flat(),
  close(),
  close(),
  open("footer", {
    layout: {
      width: grow(),
      height: fixed(1),
      padding: { left: 1 },
    },
    bg: rgba(30, 30, 40),
  }),
  text("Ready"),
  close(),
  close(),
];

let uiOps: Op[] = [
  open("root", {
    layout: { width: grow(), height: grow(), direction: "ttb" },
  }),
  open("button", {
    layout: {
      width: fixed(20),
      height: fixed(3),
      padding: { left: 1, right: 1 },
    },
    bg: rgba(50, 50, 200),
    border: {
      color: rgba(100, 100, 255),
      left: 1,
      right: 1,
      top: 1,
      bottom: 1,
    },
    cornerRadius: { tl: 1, tr: 1, bl: 1, br: 1 },
  }),
  text("Click me"),
  close(),
  close(),
];

let bench = withCodSpeed(new Bench());

bench
  .add("simple text", () => {
    term.render(helloOps);
  })
  .add("bordered box with corner radius", () => {
    term.render(borderedOps);
  })
  .add("dashboard layout", () => {
    term.render(dashboardOps);
  })
  .add("diff render (second frame)", () => {
    term.render(dashboardOps);
    term.render(dashboardOps);
  })
  .add("render with pointer hit testing", () => {
    termPtr.render(uiOps, { pointer: { x: 10, y: 1, down: false } });
  });

await bench.run();
console.table(bench.table());
