import { createTerm } from "../../../term.ts";
import { close, grow, open, text } from "../../../ops.ts";

let term = await createTerm({ width: 80, height: 24 });
term.render([
  open("root", { layout: { width: grow(), height: grow(), direction: "ttb" } }),
  text("Hello, World!"),
  close(),
]);
