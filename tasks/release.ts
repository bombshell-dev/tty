import pkg from "../package.json" with { type: "json" };

const version = pkg.version;
if (!version) throw new Error("package.json is missing a version");
const tag = `v${version}`;

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

async function remoteTagExists(ref: string): Promise<boolean> {
  let { code, stdout } = await new Deno.Command("git", {
    args: ["ls-remote", "--tags", "origin", ref],
    stdout: "piped",
    stderr: "null",
  }).output();
  return code === 0 && new TextDecoder().decode(stdout).trim() !== "";
}

const view = await new Deno.Command("npm", {
  args: ["view", `${pkg.name}@${version}`, "version"],
  stdout: "piped",
  stderr: "null",
}).output();
if (view.code === 0 && new TextDecoder().decode(view.stdout).trim()) {
  if (!(await remoteTagExists(tag))) {
    await run("git", ["tag", tag]);
    await run("git", ["push", "origin", tag]);
  }
  console.log(`${pkg.name}@${version} is already published — nothing to do`);
  Deno.exit(0);
}

await run("deno", ["task", "build:npm", version]);
await run("git", ["tag", tag]);
await run("npm", ["publish", "--access", "public"], "build/npm");
await run("git", ["push", "origin", tag]);

console.log(`Published ${pkg.name}@${version}`);
