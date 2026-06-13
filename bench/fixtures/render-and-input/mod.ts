import { createTerm } from "../../../term.ts";
import { close, grow, open, text } from "../../../ops.ts";
import { createInput } from "../../../input.ts";

let [term, input] = await Promise.all([
  createTerm({ width: 80, height: 24 }),
  createInput(),
]);

term.render([
  open("root", { layout: { width: grow(), height: grow(), direction: "ttb" } }),
  text("Hello, World!"),
  close(),
]);

// Up arrow (CSI A) — exercises the input parser path.
input.scan(new Uint8Array([0x1b, 0x5b, 0x41]));
