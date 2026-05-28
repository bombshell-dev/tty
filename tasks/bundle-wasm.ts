import { encodeBase64 } from "@std/encoding/base64";

const [input, output] = Deno.args;
if (!input || !output) {
  console.error("Usage: bundle-wasm.ts <input.wasm> <output.ts>");
  Deno.exit(1);
}

const wasm = await Deno.readFile(input);
const base64 = encodeBase64(wasm);

const source = `const bin = atob("${base64}");
const bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
export const compiled = await WebAssembly.compile(bytes);
`;

await Deno.writeTextFile(output, source);
console.log(`wrote ${output} (${wasm.length} bytes encoded)`);
