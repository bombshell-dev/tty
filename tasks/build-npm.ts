import { build, emptyDir } from "dnt";

const outDir = "./build/npm";

await emptyDir(outDir);

const [version, ...flags] = Deno.args;
const test = flags.includes("--test");
if (!version) {
  throw new Error("a version argument is required to build the npm package");
}

await build({
  entryPoints: ["./mod.ts"],
  outDir,
  shims: {
    deno: test ? "dev" : false,
  },
  scriptModule: false,
  test,
  rootTestDir: "./test",
  mappings: test ? { "./test/suite.ts": "./test/suite-node.ts" } : {},
  async postBuild() {
    if (
      await Deno.stat("native").catch((error) => {
        if (error instanceof Deno.errors.NotFound) return undefined;
        throw error;
      })
    ) {
      let directory = Deno.readDir("native");
      await Deno.mkdir(`${outDir}/esm/native`, { recursive: true });
      for await (let entry of directory) {
        if (entry.isFile && entry.name.endsWith(".node")) {
          await Deno.copyFile(
            `native/${entry.name}`,
            `${outDir}/esm/native/${entry.name}`,
          );
        }
      }
    }
  },
  typeCheck: false,
  compilerOptions: {
    lib: ["ESNext"],
  },
  skipSourceOutput: true,
  package: {
    name: "@bomb.sh/tty",
    version,
    description:
      "A terminal rendering backend for Clay with native Node.js and WebAssembly backends",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/bombshell-dev/tty.git",
    },
    bugs: {
      url: "https://github.com/bombshell-dev/tty/issues",
    },
    engines: {
      node: ">= 22",
    },
    sideEffects: false,
    type: test ? "commonjs" : "module",
  },
});

await Deno.copyFile("README.md", `${outDir}/README.md`);
