import { build, emptyDir } from "dnt";

const outDir = "./build/npm";

await emptyDir(outDir);

const [version] = Deno.args;
if (!version) {
  throw new Error("a version argument is required to build the npm package");
}

await build({
  entryPoints: ["./mod.ts"],
  outDir,
  shims: {
    deno: false,
  },
  scriptModule: false,
  test: false,
  typeCheck: false,
  compilerOptions: {
    lib: ["ESNext"],
    target: "ES2022",
    sourceMap: false,
    declarationMap: false,
  },
  package: {
    name: "clayterm",
    version,
    description:
      "A terminal rendering backend for Clay, compiled to WebAssembly",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/thefrontside/clayterm.git",
    },
    bugs: {
      url: "https://github.com/thefrontside/clayterm/issues",
    },
    engines: {
      node: ">= 22",
    },
    sideEffects: false,
    files: ["esm"],
  },
});

await Deno.copyFile("README.md", `${outDir}/README.md`);
