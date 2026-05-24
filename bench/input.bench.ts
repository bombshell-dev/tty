import { beforeAll, bench, describe } from "vitest";
import { createInput, type Input } from "../input.ts";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function str(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("input parsing", () => {
  let input: Input;

  beforeAll(async () => {
    input = await createInput({ escLatency: 25 });
  });

  bench("printable ASCII (single char)", () => {
    input.scan(bytes(0x61));
  });

  bench("printable ASCII (short string)", () => {
    input.scan(str("hello world"));
  });

  bench("arrow key (CSI sequence)", () => {
    input.scan(bytes(0x1b, 0x5b, 0x41));
  });

  bench("modifier combo (Ctrl+Shift+Arrow)", () => {
    input.scan(bytes(0x1b, 0x5b, 0x31, 0x3b, 0x38, 0x41));
  });

  bench("SGR mouse press", () => {
    input.scan(str("\x1b[<0;35;12M"));
  });

  bench("multi-event burst (arrows + text)", () => {
    input.scan(
      bytes(0x1b, 0x5b, 0x41, 0x1b, 0x5b, 0x42, 0x68, 0x69),
    );
  });

  bench("UTF-8 3-byte character", () => {
    input.scan(bytes(0xe4, 0xb8, 0xad));
  });

  bench("UTF-8 4-byte emoji", () => {
    input.scan(bytes(0xf0, 0x9f, 0x8e, 0x89));
  });

  bench("Kitty protocol (CSI u with modifiers)", () => {
    input.scan(str("\x1b[97;3u"));
  });

  let longBurst = new Uint8Array(200);
  for (let i = 0; i < 200; i++) {
    longBurst[i] = 0x61 + (i % 26);
  }

  bench("long input burst (200 bytes)", () => {
    input.scan(longBurst);
  });
});
