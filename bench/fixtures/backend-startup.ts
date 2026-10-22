import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

let [directory, operation] = process.argv.slice(2);
let start = performance.now();
let { createTerm, createInput, open, text, close } = await import(
  pathToFileURL(`${directory}/mod.ts`).href
);
if (operation === "createInput") {
  await createInput();
} else {
  let term = await createTerm({ width: 80, height: 24 });
  if (operation === "firstRender") {
    term.render([open("root"), text("hello"), close()]);
  }
}
console.log(JSON.stringify({ ms: performance.now() - start }));
