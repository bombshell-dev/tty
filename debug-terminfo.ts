// debug-terminfo.ts — pinpoint where the terminfo capability chain breaks.
// Run directly in the terminal you are testing, from the repo root:
//
//   deno run -A debug-terminfo.ts
//   node debug-terminfo.ts
//
// Walks the full chain and reports which link fails: environment identity,
// detection (static Capabilities), the probe round-trip with a per-query
// ✓/✗ breakdown, the parser's CapabilityEvents, and the term's merged
// RuntimeCapabilities. The pointer shape section at the end exercises the
// one capability render() consumes today; if no OSC 22 reply arrives, a
// set-only check flashes the hand cursor so query-less terminals (ghostty)
// can be told apart from terminals without OSC 22 at all.
import { Buffer } from "node:buffer";
import process from "node:process";
import {
  type CapabilityEvent,
  close,
  createInput,
  createTerm,
  detectTerminal,
  open,
  text,
} from "./mod.ts";

const decode = new TextDecoder();
const esc = (b: Uint8Array) => JSON.stringify(decode.decode(b)).slice(1, -1);
const json = (v: unknown) => JSON.stringify(v);

console.log("── environment");
console.log("  TERM:", process.env.TERM ?? "(unset)");
console.log(
  "  TERM_PROGRAM:",
  process.env.TERM_PROGRAM ?? "(unset)",
  process.env.TERM_PROGRAM_VERSION ?? "",
);
console.log("  COLORTERM:", process.env.COLORTERM ?? "(unset)");
if (process.env.TMUX) {
  console.log("  ⚠ running inside tmux — queries may not pass through");
}

const info = await detectTerminal();
console.log("── detection");
console.log("  probe bytes:", info.probe.length);
console.log("  static capabilities:", json(info.capabilities));

if (!process.stdin.isTTY) {
  console.log("  ✗ stdin is not a TTY; run this directly in your terminal");
  process.exit(1);
}

console.log("── probing (2s window, raw mode on; type nothing)…");
if (typeof process.stdin.setRawMode === "function") {
  process.stdin.setRawMode(true);
}
process.stdout.write(info.probe);

const chunks: Buffer[] = [];
const onData = (chunk: Buffer) => chunks.push(chunk);
process.stdin.on("data", onData);
await new Promise((r) => setTimeout(r, 2000));
process.stdin.removeListener("data", onData);

const reply = Buffer.concat(chunks);
console.log("── raw reply");
console.log("  bytes:", reply.length);
console.log(
  "  escaped:",
  reply.length ? esc(reply) : "(nothing — the terminal answered nothing)",
);

console.log("── which queries were answered");
const replyText = decode.decode(reply);
const markers: [string, string][] = [
  ["foreground (OSC 10)", "\x1b]10;"],
  ["background (OSC 11)", "\x1b]11;"],
  ["cursor color (OSC 12)", "\x1b]12;"],
  ["colors (OSC 21)", "\x1b]21;"],
  ["POINTER SHAPE (OSC 22)", "\x1b]22;"],
  ["XTGETTCAP (DCS)", "\x1bP"],
  ["sync output (DECRPM 2026)", "?2026"],
  ["kitty keyboard (?u)", "?u"],
  ["kitty graphics (APC)", "\x1b_G"],
];
for (const [name, marker] of markers) {
  console.log(`  ${replyText.includes(marker) ? "✓" : "✗"} ${name}`);
}

// The query tells us about reply support, not set support. Ghostty sets
// shapes since 1.0 but never answers the query, so give the terminal a
// chance to show what it can do: set the hand for 1.5s, then restore.
if (!replyText.includes("\x1b]22;")) {
  console.log("── set-only check (watch your cursor)");
  process.stdout.write("\x1b]22;pointer\x1b\\");
  await new Promise((r) => setTimeout(r, 1500));
  process.stdout.write("\x1b]22;default\x1b\\");
  console.log(
    "  the cursor should have flashed to a hand just now. If it did," +
      " this terminal can SET shapes but never answers the query" +
      " (ghostty behaves exactly like this) — detectTerminal()'s" +
      " known-support table should already cover it. If it did not" +
      " change, OSC 22 is not supported at all.",
  );
}

if (typeof process.stdin.setRawMode === "function") {
  process.stdin.setRawMode(false);
}

console.log("── parser");
const input = await createInput({ terminfo: info });
let events = input.scan(new Uint8Array(reply)).events;
events = [...events, ...input.scan(new Uint8Array(0)).events];
const caps = events.filter((e): e is CapabilityEvent =>
  e.type === "capability"
);
if (caps.length === 0) {
  console.log("  (no capability events parsed)");
}
for (const c of caps) {
  console.log(`  capability: ${c.key} = ${json(c.value)}`);
}

console.log("── term (merged view)");
const term = await createTerm({ width: 40, height: 6, terminfo: info });
term.update(caps);
console.log("  merged capabilities:", json(term.capabilities));
const staticCaps = info.capabilities as unknown as Record<string, unknown>;
const mergedCaps = term.capabilities as unknown as Record<string, unknown>;
const raised = Object.keys(mergedCaps).filter((k) =>
  json(mergedCaps[k]) !== json(staticCaps[k])
);
console.log(
  "  raised by the probe:",
  raised.length > 0 ? raised.join(", ") : "(nothing — probe added no evidence)",
);

// Pointer shape is the one capability render() consumes today, so it doubles
// as the end-to-end emission check.
console.log("── pointer shape (renderer-spec §7.9)");
const result = term.render(
  [open("box", { pointerShape: "pointer" }), text("hover"), close()],
  { pointer: { x: 2, y: 2, down: false } },
);
const emitted = decode
  .decode(result.output)
  .includes("\x1b]22;pointer\x1b\\");
console.log("  OSC 22 in render output:", emitted);

console.log("── verdict");
if (emitted) {
  console.log(
    "  ✓ render emits OSC 22" +
      (info.capabilities.pointerShape && !replyText.includes("\x1b]22;")
        ? " — statically granted by the known-support table (no query reply," +
          " which is expected for set-only terminals like ghostty)"
        : " — the probe confirmed support and the parser folded it in") +
      ". If the demos still show nothing, hover a key/button — and note the" +
      " shape only changes while the pointer is over an element that" +
      " declares one.",
  );
} else if (!replyText.includes("\x1b]22;")) {
  console.log(
    info.capabilities.pointerShape
      ? "  ✗ no OSC 22 reply and no emission despite a static grant — please" +
        " report this with the escaped reply above."
      : "  ✗ your terminal did not answer the OSC 22 query and it is not on" +
        " the known-support table. If the set-only check above moved your" +
        " cursor, it can set shapes but we cannot detect it — run the demos" +
        " with TTY_POINTER_SHAPES=1 (or nominate the terminal for the" +
        " table). If the cursor never changed, OSC 22 is not supported at" +
        " all (iTerm2, Terminal.app, VS Code, tmux without passthrough).",
  );
} else if (caps.length === 0) {
  console.log(
    "  ✗ the terminal replied but the parser produced no capability events." +
      " Please report this with the escaped reply above.",
  );
} else {
  console.log(
    "  ✗ capability recognized but render did not emit OSC 22. Please report" +
      " this with the escaped reply above.",
  );
}
process.exit(0);
