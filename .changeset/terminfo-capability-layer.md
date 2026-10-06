---
"@bomb.sh/tty": minor
---

Adds `detectTerminal()`, `TerminalInfo`, `Capabilities`, `DetectOptions`, `KeyTable`, and `MAX_TERMINFO_ENTRY` to the public API, and a `terminfo` option to `createTerm`.

`detectTerminal()` reads the compiled terminfo entry for the current terminal (from the ncurses search path, or from bytes passed as `entry`), applies environment evidence (`COLORTERM`), and resolves a frozen `TerminalInfo` carrying static `capabilities`, a `probe` query batch to write to stdout, and opaque `keys` for the input parser.

Pass the same `TerminalInfo` as `terminfo` to `createTerm` and `createInput`. `term.capabilities` exposes the renderer's current capability snapshot, seeded from `terminfo.capabilities` (or the 256-color baseline when omitted).

**Breaking:** `term.update()` now takes one change or an array of changes — a `{ width, height }` resize or any `InputEvent` — instead of `{ events }`. Capability events from `scan()` are folded into `term.capabilities`; other input events are ignored, so the whole `events` array can be passed through. `update()` returns a `Uint8Array` of bytes to write immediately (empty when there are none).

#### Migration

```diff
-term.update({ events });
+const out = term.update(events);
+if (out.length) process.stdout.write(out);
```

```diff
+const terminfo = await detectTerminal({ env: process.env });
+const term = await createTerm({ width, height, terminfo });
+const input = await createInput({ terminfo });
+process.stdout.write(terminfo.probe);
```
