import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export { withCodSpeed } from "@codspeed/tinybench-plugin";

// CodSpeed walltime reads `task.result.latency` which
// tinybench only sets for async tasks
export function sync(fn: () => void): () => Promise<void> {
  return () => {
    fn();
    return Promise.resolve();
  };
}

export const fixture = (name: string) => {
  return new URL(`./${name}/mod.ts`, import.meta.url);
};

export const spawnFixture = (name: string): Promise<void> =>
  new Promise((resolve) => {
    spawn(process.execPath, [
      ...process.execArgv,
      fileURLToPath(fixture(name)),
    ], { stdio: "ignore" }).on("close", resolve);
  });
