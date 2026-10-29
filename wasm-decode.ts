import { brotliDecompressSync } from "node:zlib";

const Z85 =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";

const DECODE = new Uint8Array(128);
for (let i = 0; i < 85; i++) DECODE[Z85.charCodeAt(i)] = i;

// Division instead of >>> avoids 32-bit truncation on values near 0xFFFFFFFF.
function decodeZ85(s: string, n: number): Uint8Array {
  let bytes = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < s.length && o < n; i += 5) {
    let v = DECODE[s.charCodeAt(i)] * 52200625 +
      DECODE[s.charCodeAt(i + 1)] * 614125 +
      DECODE[s.charCodeAt(i + 2)] * 7225 +
      DECODE[s.charCodeAt(i + 3)] * 85 +
      DECODE[s.charCodeAt(i + 4)];
    if (o < n) bytes[o++] = Math.floor(v / 16777216);
    if (o < n) bytes[o++] = Math.floor(v / 65536) % 256;
    if (o < n) bytes[o++] = Math.floor(v / 256) % 256;
    if (o < n) bytes[o++] = v % 256;
  }
  return bytes;
}

/**
 * Decode an inlined WASM blob: z85 → brotli-decompress → compile.
 *
 * `byteLength` is the brotli-compressed length, used to size the z85
 * decode buffer before decompression restores the original module.
 */
export function decode(
  z85: string,
  byteLength: number,
): Promise<WebAssembly.Module> {
  let compressed = decodeZ85(z85, byteLength);
  return WebAssembly.compile(new Uint8Array(brotliDecompressSync(compressed)));
}
