import { Bench } from "tinybench";
import { withCodSpeed } from "@codspeed/tinybench-plugin";
import { createInput } from "../input.ts";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function str(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

let input = await createInput({ escLatency: 25 });

let longBurst = new Uint8Array(200);
for (let i = 0; i < 200; i++) {
  longBurst[i] = 0x61 + (i % 26);
}

let bench = withCodSpeed(new Bench());

bench
  .add("printable ASCII (single char)", () => {
    input.scan(bytes(0x61));
  })
  .add("printable ASCII (short string)", () => {
    input.scan(str("hello world"));
  })
  .add("arrow key (CSI sequence)", () => {
    input.scan(bytes(0x1b, 0x5b, 0x41));
  })
  .add("modifier combo (Ctrl+Shift+Arrow)", () => {
    input.scan(bytes(0x1b, 0x5b, 0x31, 0x3b, 0x38, 0x41));
  })
  .add("SGR mouse press", () => {
    input.scan(str("\x1b[<0;35;12M"));
  })
  .add("multi-event burst (arrows + text)", () => {
    input.scan(bytes(0x1b, 0x5b, 0x41, 0x1b, 0x5b, 0x42, 0x68, 0x69));
  })
  .add("UTF-8 3-byte character", () => {
    input.scan(bytes(0xe4, 0xb8, 0xad));
  })
  .add("UTF-8 4-byte emoji", () => {
    input.scan(bytes(0xf0, 0x9f, 0x8e, 0x89));
  })
  .add("Kitty protocol (CSI u with modifiers)", () => {
    input.scan(str("\x1b[97;3u"));
  })
  .add("long input burst (200 bytes)", () => {
    input.scan(longBurst);
  });

await bench.run();
console.table(bench.table());
