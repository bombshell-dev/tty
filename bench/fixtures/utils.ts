import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const fixture = (name: string) => {
    return new URL(`./${name}/mod.ts`, import.meta.url);
}

export const spawnFixture = (name: string) =>
  spawnSync(process.execPath, [...process.execArgv, fileURLToPath(fixture(name))], { stdio: "ignore" });
