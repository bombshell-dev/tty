import process from "node:process";

interface Target {
  platform: string;
  arch: string;
  libc?: "glibc" | "musl";
}

/** Internal artifact name, shared by the loader and local build task. */
export function nativeFilename(target?: Target): string {
  if (!target) {
    let libc: Target["libc"];
    if (process.platform === "linux") {
      let report = process.report.getReport() as {
        header: { glibcVersionRuntime?: string };
      };
      libc = report.header.glibcVersionRuntime ? "glibc" : "musl";
    }
    target = { platform: process.platform, arch: process.arch, libc };
  }
  let libc = target.libc ? `-${target.libc}` : "";
  return `tty-${target.platform}-${target.arch}${libc}.node`;
}
