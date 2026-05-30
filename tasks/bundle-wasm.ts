import { encodeBase64 } from "@std/encoding/base64";

const wasm = await Deno.readFile("clayterm.wasm");
const base64 = encodeBase64(wasm);

const source = `const bin = atob("${base64}");
const bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
export const compiled = await WebAssembly.compile(bytes);
`;

await Deno.writeTextFile("wasm.ts", source);
console.log(`wrote wasm.ts (${wasm.length} bytes encoded)`);
