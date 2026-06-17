import { Bench } from "tinybench";
import { spawnFixture, withCodSpeed } from "./fixtures/utils.ts";

let bench = withCodSpeed(new Bench({ name: "startup" }));

bench
  .add("createTerm", () => spawnFixture("create-term"))
  .add("createInput", () => spawnFixture("create-input"))
  .add("createTerm + createInput", () => spawnFixture("create-both"))
  .add("time to first render", () => spawnFixture("render-minimal"))
  .add("render + scan (both modules)", () => spawnFixture("render-and-input"));

await bench.run();
console.table(bench.table());
