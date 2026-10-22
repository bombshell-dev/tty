/** Compare identical public-API workloads in isolated Node.js processes.
 * Build with `make && make native`, then `node bench/native.bench.ts`.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { dashboardOps, uiOps } from "./fixtures/render-scenes.ts";
import { nativeFilename } from "../native-platform.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const self = fileURLToPath(import.meta.url);
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function worker(directory: string, startup?: string) {
  let start = performance.now();
  let { createTerm, createInput } = await import(
    pathToFileURL(`${directory}/mod.ts`).href
  );
  if (startup) {
    if (startup === "createInput") await createInput();
    else {
      let term = await createTerm({ width: 80, height: 24 });
      if (startup === "firstRender") term.render(uiOps);
    }
    console.log(JSON.stringify({ ms: performance.now() - start }));
    return;
  }
  let term = await createTerm({ width: 80, height: 24 });
  let input = await createInput({ escLatency: 25 });
  let unit = new TextEncoder().encode(
    "the quick brown fox \x1b[A\x1b[<0;40;12M中\x1b[97;3u🎉",
  );
  let corpus = new Uint8Array(unit.length * 1000);
  for (let off = 0; off < corpus.length; off += unit.length) {
    corpus.set(unit, off);
  }
  let checksum = 0;
  let workloads: Record<string, { run: () => void; operations: number }> = {
    mixedRender: {
      run() {
        for (let i = 0; i < 250; i++) {
          checksum +=
            term.render(i % 2 === 0 ? dashboardOps : uiOps).output.length;
        }
      },
      operations: 250,
    },
    steadyDiff: {
      run() {
        for (let i = 0; i < 250; i++) {
          checksum += term.render(dashboardOps).output.length;
        }
      },
      operations: 250,
    },
    inputCorpus: {
      run() {
        let dispatched = 0;
        for (let off = 0; off < corpus.length; off += 64) {
          dispatched +=
            input.scan(corpus.subarray(off, off + 64)).events.length;
        }
        if (!dispatched) throw new Error("input workload produced no events");
        checksum += dispatched;
      },
      operations: 1,
    },
  };
  let results: Record<string, number> = {};
  for (let [name, { run, operations }] of Object.entries(workloads)) {
    let until = performance.now() + 300;
    while (performance.now() < until) run();
    let samples: number[] = [];
    for (let round = 0; round < 7; round++) {
      let start = performance.now();
      let count = 0;
      do {
        run();
        count++;
      } while (performance.now() - start < 150);
      samples.push((performance.now() - start) * 1000 / count / operations);
    }
    results[name] = median(samples);
  }
  console.log(
    JSON.stringify({ results, checksum, corpusBytes: corpus.length }),
  );
}

function child(directory: string, startup?: string) {
  let start = performance.now();
  let args = startup
    ? [
      fileURLToPath(new URL("./fixtures/backend-startup.ts", import.meta.url)),
      directory,
      startup,
    ]
    : [self, "--worker", directory];
  let result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    cwd: root,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `worker exited ${result.status}`);
  }
  return { ...JSON.parse(result.stdout), processMs: performance.now() - start };
}

async function main() {
  if (process.argv[2] === "--worker") {
    return await worker(process.argv[3], process.argv[4]);
  }
  let directories = Object.fromEntries(["wasm", "native"].map((backend) => {
    let directory = resolve(root, "build/backend-comparison", backend);
    mkdirSync(directory, { recursive: true });
    for (let name of readdirSync(root)) {
      if (name.endsWith(".ts")) {
        cpSync(resolve(root, name), `${directory}/${name}`);
      }
    }
    writeFileSync(`${directory}/package.json`, '{"type":"module"}\n');
    return [backend, directory];
  }));
  mkdirSync(`${directories.native}/native`, { recursive: true });
  cpSync(
    resolve(root, "native", nativeFilename()),
    `${directories.native}/native/${nativeFilename()}`,
  );
  let throughput: Record<string, Record<string, number>> = {
    wasm: {},
    native: {},
  };
  // Alternate process order to reduce temperature and scheduling bias.
  let runs: Record<string, Record<string, number>[]> = { wasm: [], native: [] };
  for (let round = 0; round < 3; round++) {
    for (let backend of round % 2 ? ["native", "wasm"] : ["wasm", "native"]) {
      let result = child(directories[backend]);
      runs[backend].push(result.results);
    }
  }
  for (let backend of ["wasm", "native"]) {
    for (let key of Object.keys(runs[backend][0])) {
      throughput[backend][key] = median(runs[backend].map((r) => r[key]));
    }
  }
  let startup: Record<
    string,
    Record<string, { moduleMs: number; processMs: number }>
  > = {};
  for (let name of ["createTerm", "createInput", "firstRender"]) {
    let samples: Record<string, { ms: number; processMs: number }[]> = {
      wasm: [],
      native: [],
    };
    for (let round = 0; round < 23; round++) {
      for (let backend of round % 2 ? ["native", "wasm"] : ["wasm", "native"]) {
        let result = child(directories[backend], name);
        if (round >= 3) samples[backend].push(result);
      }
    }
    startup[name] = Object.fromEntries(["wasm", "native"].map((b) => [b, {
      moduleMs: median(samples[b].map((r) => r.ms)),
      processMs: median(samples[b].map((r) => r.processMs)),
    }]));
  }
  let report = {
    date: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0].model,
    nativeBuild: JSON.parse(
      readFileSync(resolve(root, "build/native-build.json"), "utf8"),
    ),
    inputCorpusBytes: new TextEncoder().encode(
      "the quick brown fox \x1b[A\x1b[<0;40;12M中\x1b[97;3u🎉",
    ).length * 1000,
    throughputUs: throughput,
    startupMs: startup,
    runs,
    methodology:
      "O2 builds; identical API workloads; 3 alternating processes/backend; 300ms warmup and 7x150ms samples/workload/process; startup 20 fresh processes/backend after 3 warmups; medians; startup module time includes import",
  };
  let output = resolve(root, "build/native-benchmark.json");
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.table(
    Object.keys(throughput.wasm).map((name) => ({
      workload: name,
      "Wasm µs": throughput.wasm[name].toFixed(2),
      "Native µs": throughput.native[name].toFixed(2),
      "Wasm/native":
        (throughput.wasm[name] / throughput.native[name]).toFixed(2) + "×",
    })),
  );
  console.table(
    Object.entries(startup).map(([name, r]) => ({
      workload: name,
      "Wasm import+operation ms": r.wasm.moduleMs.toFixed(2),
      "Native import+operation ms": r.native.moduleMs.toFixed(2),
      "Wasm process ms": r.wasm.processMs.toFixed(2),
      "Native process ms": r.native.processMs.toFixed(2),
    })),
  );
  console.log(`Saved ${output}`);
}

await main();
