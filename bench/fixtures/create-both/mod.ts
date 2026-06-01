import { createTerm } from "../../../term.ts";
import { createInput } from "../../../input.ts";

await Promise.all([
  createTerm({ width: 80, height: 24 }),
  createInput(),
]);
