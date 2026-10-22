import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { nativeFilename } from "./native-platform.ts";
import type { BoundingBox } from "./term-native.ts";

interface Handle {
  buffer: ArrayBuffer;
  transfer: number;
  eventSize: number;
}

interface Addon {
  createTerm(w: number, h: number): Handle;
  createInput(latency: number, colors: number, keys: Uint8Array): Handle;
  resize(handle: Handle, w: number, h: number): void;
  reduce(
    handle: Handle,
    len: number,
    mode: number,
    row: number,
    dt: number,
    px: number,
    py: number,
    pointer: number,
  ): void;
  output(handle: Handle): number;
  length(handle: Handle): number;
  animating(handle: Handle): number;
  errorCount(handle: Handle): number;
  errorType(handle: Handle, i: number): number;
  errorMessage(handle: Handle, i: number): string;
  pointerIds(handle: Handle): string[];
  bounds(handle: Handle, id: string): BoundingBox | undefined;
  caps(handle: Handle, flags: number): number;
  scan(handle: Handle, len: number, now: number): number;
  count(handle: Handle): number;
  event(handle: Handle, i: number): number;
  delay(handle: Handle): number;
  terminfo(bytes: Uint8Array): [status: number, colors: number, flags: number];
}

let addon: Addon | null | undefined;

/** A missing platform build permits Wasm; a broken present build is an error. */
export function nodeAddon(): Addon | undefined {
  if (addon !== undefined) return addon ?? undefined;
  if (
    process.release.name !== "node" || process.versions.deno ||
    process.versions.bun
  ) {
    addon = null;
    return undefined;
  }
  let path = new URL(`./native/${nativeFilename()}`, import.meta.url);
  addon = existsSync(path)
    ? createRequire(import.meta.url)(fileURLToPath(path))
    : null;
  return addon ?? undefined;
}
