import { encodeBase64 } from "@std/encoding/base64";

const wasm = await Deno.readFile("clayterm.wasm");

const cs = new CompressionStream("deflate-raw");
const compressed = await new Response(
  new Blob([wasm]).stream().pipeThrough(cs),
).arrayBuffer();

const base64 = encodeBase64(new Uint8Array(compressed));

const source = `const bin = atob("${base64}");
const compressed = Uint8Array.from(bin, c => c.charCodeAt(0));
const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
export const compiled = await WebAssembly.compile(await new Response(stream).arrayBuffer());
`;

await Deno.writeTextFile("wasm.ts", source);
console.log(
  `wrote wasm.ts (${wasm.length} → ${compressed.byteLength} bytes compressed, ${
    Math.round(compressed.byteLength / wasm.length * 100)
  }%)`,
);
