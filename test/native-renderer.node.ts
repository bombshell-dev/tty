/** Node-only renderer invariants; run after `make native` with
 * `node --expose-gc --test test/native-renderer.node.ts`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { createTerm } from "../term.ts";
import { close, fixed, grow, open, text } from "../ops.ts";
import { print } from "./print.ts";
import { nodeAddon } from "../node-addon.ts";

assert.ok(nodeAddon(), "build the native addon before running native tests");
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const trim = (s: string) =>
  s.split("\n").map((line) => line.trimEnd()).join("\n");
const frame = (value: string) => [
  open("root", {
    layout: { width: grow(), height: grow(), direction: "ttb" as const },
  }),
  open("label", { layout: { width: fixed(8), height: fixed(1) } }),
  text(value),
  close(),
  close(),
];

async function exercise() {
  let a = await createTerm({ width: 12, height: 2 });
  let b = await createTerm({ width: 80, height: 24 });
  let width = 12;
  for (let i = 0; i < 100; i++) {
    let ansi = decode(a.render(frame("A中e\u0301"), { mode: "line" }).output);
    assert.equal(trim(print(ansi, width, 2)), "A中e\u0301\n");
    b.render(frame("other"), {
      deltaTime: 0.02,
      pointer: { x: 1, y: 0, down: false },
    });
    assert.equal(
      a.render(frame("A中e\u0301")).info.get("label")?.bounds.width,
      8,
    );
    width = 12 + (i % 2);
    a.update([{ type: "resize", width, height: 2 }]);
  }
}

if (!isMainThread) {
  await exercise();
  parentPort!.postMessage("ok");
} else {
  test("native Terms keep layout and buffers isolated", exercise);
  test("native Terms remain isolated across Node workers", async () => {
    await Promise.all(
      Array.from({ length: 4 }, () =>
        new Promise<void>((resolve, reject) => {
          let worker = new Worker(new URL(import.meta.url), { execArgv: [] });
          worker.once("error", reject);
          worker.once("exit", (code) =>
            code === 0
              ? resolve()
              : reject(new Error(`worker exited ${code}`)));
        })),
    );
  });
  test("native output retains its allocation after resize and Term collection", async () => {
    let retained: Uint8Array;
    let copy: Uint8Array;
    {
      let term = await createTerm({ width: 12, height: 2 });
      retained = term.render(frame("retained"), { mode: "line" }).output;
      copy = retained.slice();
      term.update([{ type: "resize", width: 160, height: 60 }]);
      term.render(frame("replacement"));
    }
    let gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
    assert.ok(gc, "run this test with --expose-gc");
    for (let i = 0; i < 5; i++) {
      gc();
      await new Promise((resolve) => setImmediate(resolve));
    }
    // The public validity window has ended; retaining a view must still be
    // memory-safe. An old allocation is not reused after a growing resize.
    assert.deepEqual(retained, copy);
  });
  test("detached native output cannot leave usable native pointers", async () => {
    let term = await createTerm({ width: 12, height: 2 });
    let result = term.render(frame("native"));
    let buffer = result.output.buffer;
    assert.ok(buffer instanceof ArrayBuffer);
    structuredClone(buffer, { transfer: [buffer] });
    assert.throws(() => result.info.get("label"), /detached/);
    assert.throws(
      () => term.update([{ type: "resize", width: 20, height: 3 }]),
      /detached/,
    );
  });
  test("native rendering does not prepare Wasm", async () => {
    let original = WebAssembly.compile;
    WebAssembly.compile = () => {
      throw new Error("unexpected Wasm compilation");
    };
    try {
      let term = await createTerm({ width: 12, height: 2 });
      let ansi = decode(term.render(frame("native"), { mode: "line" }).output);
      assert.equal(trim(print(ansi, 12, 2)), "native\n");
    } finally {
      WebAssembly.compile = original;
    }
  });
}
