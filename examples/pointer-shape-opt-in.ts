import process from "node:process";
import type { Term } from "../mod.ts";

/**
 * Assert OSC 22 pointer-shape support by hand.
 *
 * Some terminals (ghostty among them) can set pointer shapes but never answer
 * the OSC 22 support query, so capability detection cannot see them. Run the
 * demo with TTY_POINTER_SHAPES=1 to fold the equivalent CapabilityEvent into
 * the term — the same opt-in a host can make with
 * `term.update([{ type: "capability", key: "pointer-shape", value: true }])`.
 */
export function optInPointerShapes(term: Term): void {
  if (process.env.TTY_POINTER_SHAPES === "1") {
    term.update([{ type: "capability", key: "pointer-shape", value: true }]);
  }
}
