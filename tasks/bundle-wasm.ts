import { brotliCompressSync, constants } from "node:zlib";

const Z85 =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";

function encodeZ85(data: Uint8Array): string {
  let padLen = (4 - (data.length % 4)) % 4;
  let src = data;
  if (padLen > 0) {
    src = new Uint8Array(data.length + padLen);
    src.set(data);
  }
  let out: string[] = [];
  for (let i = 0; i < src.length; i += 4) {
    let v = src[i] * 16777216 +
      src[i + 1] * 65536 +
      src[i + 2] * 256 +
      src[i + 3];
    out.push(
      Z85[Math.floor(v / 52200625)],
      Z85[Math.floor(v / 614125) % 85],
      Z85[Math.floor(v / 7225) % 85],
      Z85[Math.floor(v / 85) % 85],
      Z85[v % 85],
    );
  }
  return out.join("");
}

const [input, output] = Deno.args;
if (!input || !output) {
  console.error("Usage: bundle-wasm.ts <input.wasm> <output.ts>");
  Deno.exit(1);
}

const wasm = await Deno.readFile(input);

const compressed = new Uint8Array(
  brotliCompressSync(wasm, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: wasm.length,
      [constants.BROTLI_PARAM_LGWIN]: 24,
    },
  }),
);

const z85 = encodeZ85(compressed);

// args separated to keep deno fmt happy
const args = `${JSON.stringify(z85)}, ${compressed.byteLength}`;
const source = `import { decode } from "./wasm-decode.ts";
export const compiled = await decode(${args});
`;

await Deno.writeTextFile(output, source);
console.log(
  `wrote ${output} (${wasm.length} → ${compressed.byteLength} bytes compressed, ${z85.length} bytes z85, ${
    Math.round(z85.length / wasm.length * 100)
  }%)`,
);
