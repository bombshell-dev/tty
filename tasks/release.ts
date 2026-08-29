import pkg from "../package.json" with { type: "json" };

const version = pkg.version;
if (!version) throw new Error("package.json is missing a version");

async function run(cmd: string, args: string[], cwd?: string) {
  let { code } = await new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }).output();
  if (code !== 0) {
    throw new Error(`\`${cmd} ${args.join(" ")}\` exited with code ${code}`);
  }
}

const view = await new Deno.Command("npm", {
  args: ["view", `${pkg.name}@${version}`, "version"],
  stdout: "piped",
  stderr: "null",
}).output();
if (view.code === 0 && new TextDecoder().decode(view.stdout).trim()) {
  console.log(`${pkg.name}@${version} is already published — nothing to do`);
  Deno.exit(0);
}

await run("deno", ["task", "build:npm", version]);
await run("npm", ["publish", "--access", "public"], "build/npm");
await run("git", ["tag", `v${version}`]);
await run("git", ["push", "origin", `v${version}`]);

console.log(`Published @bomb.sh/tty@${version}`);
