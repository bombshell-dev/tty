import { Bench } from "tinybench";
import { sync, withCodSpeed } from "./fixtures/utils.ts";
import { createTerm } from "../term.ts";
import { dashboardOps, uiOps } from "./fixtures/render-scenes.ts";

let term = await createTerm({ width: 80, height: 24 });

let bench = withCodSpeed(new Bench({ name: "render" }));

bench
  .add(
    "render mixed frames",
    sync(() => {
      for (let i = 0; i < 250; i++) {
        term.render(i % 2 === 0 ? dashboardOps : uiOps);
      }
    }),
  )
  .add(
    "render steady diff",
    sync(() => {
      for (let i = 0; i < 250; i++) {
        term.render(dashboardOps);
      }
    }),
  );

await bench.run();
console.table(bench.table());
