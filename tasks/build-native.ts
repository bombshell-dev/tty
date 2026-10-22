import { dirname, resolve } from "node:path";
import { nativeFilename } from "../native-platform.ts";

// Keep upstream Clay's context routing and callback slots isolated per worker.
// Overflow sentinels are private to each worker too. Term state itself stays
// on its arena; every native call selects its context.
let clay = await Deno.readTextFile("build/clay/clay.h");
for (
  let declaration of [
    "Clay_Context *Clay__currentContext;",
    "int32_t Clay__defaultMaxElementCount = 8192;",
    "int32_t Clay__defaultMaxMeasureTextWordCacheCount = 16384;",
    "Clay_Dimensions (*Clay__MeasureText)",
    "Clay_Vector2 (*Clay__QueryScrollOffset)",
    "typeName typeName##_DEFAULT = CLAY__DEFAULT_STRUCT;",
    "Clay__Warning CLAY__WARNING_DEFAULT = CLAY__DEFAULT_STRUCT;",
  ]
) {
  if (!clay.includes(declaration)) {
    throw new Error(`Clay declaration changed: ${declaration}`);
  }
  clay = clay.replace(declaration, `_Thread_local ${declaration}`);
}
await Deno.mkdir("build/native-clay", { recursive: true });
await Deno.writeTextFile("build/native-clay/clay.h", clay);

let node = new Deno.Command("node", {
  args: [
    "-p",
    `JSON.stringify({execPath:process.execPath,platform:process.platform,arch:process.arch,libc:process.platform==='linux'?(process.report.getReport().header.glibcVersionRuntime?'glibc':'musl'):undefined})`,
  ],
  stdout: "piped",
});
let result = await node.output();
if (!result.success) throw new Error("Node.js is required to build the addon");
let target = JSON.parse(new TextDecoder().decode(result.stdout));
let execPath: string = target.execPath;
let filename = nativeFilename(target);
let include = Deno.env.get("NODE_INCLUDE_DIR") ??
  resolve(dirname(execPath), "../include/node");
if (!await Deno.stat(`${include}/node_api.h`).catch(() => undefined)) {
  throw new Error(
    "Node headers missing; set NODE_INCLUDE_DIR to their directory",
  );
}
await Deno.mkdir("native", { recursive: true });
let args = [
  "-std=c11",
  "-O2",
  "-fPIC",
  "-fvisibility=hidden",
  "-shared",
  "-DCLAY_IMPLEMENTATION",
  "-DCLAY_DEBUG_MODE_ENABLED=0",
  "-DNAPI_VERSION=8",
  `-I${include}`,
  "-Ibuild/native-clay",
  "-Isrc",
  "-I.",
  "src/node.c",
  "-o",
  `native/${filename}`,
];
if (Deno.build.os === "darwin") args.push("-undefined", "dynamic_lookup");
else if (Deno.build.os === "linux") args.push("-lm");
else throw new Error("The local native build supports macOS and Linux");
let compiler = Deno.env.get("CC") ?? "clang";
let build = await new Deno.Command(compiler, {
  args,
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!build.success) Deno.exit(build.code);
let version = await new Deno.Command(compiler, {
  args: ["--version"],
  stdout: "piped",
}).output();
await Deno.writeTextFile(
  "build/native-build.json",
  JSON.stringify(
    {
      compiler: new TextDecoder().decode(version.stdout).split("\n")[0],
      flags: args,
      target,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Built native/${filename}`);
