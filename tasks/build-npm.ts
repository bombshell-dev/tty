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
    target: "ES2020",
    sourceMap: true,
  },
  package: {
    name: "clayterm",
    version,
    description:
      "A terminal rendering backend for Clay, compiled to WebAssembly",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/bombshell-dev/clayterm.git",
    },
    bugs: {
      url: "https://github.com/bombshell-dev/clayterm/issues",
    },
    engines: {
      node: ">= 16",
    },
    sideEffects: false,
  },
});

await Deno.copyFile("README.md", `${outDir}/README.md`);
