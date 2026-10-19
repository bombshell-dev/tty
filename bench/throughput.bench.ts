import { Bench } from "tinybench";
import { sync, withCodSpeed } from "./fixtures/utils.ts";
import { createInput } from "../input.ts";

function str(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = parts.reduce((n, p) => n + p.length, 0);
  let out = new Uint8Array(len);
  let off = 0;
  for (let p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

let unit = concat([
  str("the quick brown fox "),
  new Uint8Array([0x1b, 0x5b, 0x41]), // ArrowUp
  str("\x1b[<0;40;12M"), // SGR mouse press
  new Uint8Array([0xe4, 0xb8, 0xad]), // 中
  str("\x1b[97;3u"), // Kitty a+Alt
  new Uint8Array([0xf0, 0x9f, 0x8e, 0x89]), // 🎉
]);
let corpus = concat(new Array(1000).fill(unit));

let READ = 64;

let input = await createInput({ escLatency: 25 });

let bench = withCodSpeed(new Bench({ name: "throughput" }));

bench.add(
  "input throughput (mixed corpus, chunked read loop)",
  sync(() => {
    let dispatched = 0;
    for (let off = 0; off < corpus.length; off += READ) {
      let { events } = input.scan(corpus.subarray(off, off + READ));
      dispatched += events.length;
    }
    if (dispatched === 0) throw new Error("expected events");
  }),
);

await bench.run();
console.table(bench.table());
