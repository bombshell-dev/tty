// Load the package entry point, including dnt's runtime polyfills, before the
// Node test runner imports internal modules directly.
import "../mod.ts";
export { beforeEach, describe, it } from "node:test";
export { expect } from "@std/expect";
