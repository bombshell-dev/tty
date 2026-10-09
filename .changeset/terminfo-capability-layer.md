---
'@bomb.sh/tty': minor
---

Adds `detectTerminal()`, `TerminalInfo`, `Capabilities`, `DetectOptions`, `KeyTable`, and `MAX_TERMINFO_ENTRY` to the public API, and a `terminfo` option to `createTerm`.

`detectTerminal()` reads the compiled terminfo entry for the current terminal (from the ncurses search path, or from bytes passed as `entry`), applies environment evidence (`COLORTERM`), and resolves a frozen `TerminalInfo` carrying static `capabilities`, a `probe` query batch to write to stdout, and opaque `keys` for the input parser.

Pass the returned `TerminalInfo` as `terminfo` to `createTerm` and `createInput`. `term.capabilities` exposes the renderer's current capability snapshot, seeded from `terminfo.capabilities` (or the 256-color baseline when omitted).

Changes `term.update()` to accept an array of `InputEvent` values instead of `{ events }` or `{ width, height }`. Resizes are now `ResizeEvent`s tagged `type: "resize"`; capability events from `scan()` are folded into `term.capabilities`; all other input events are no-ops, so the full `events` array from `scan()` can be passed straight through. `update()` now returns a `Uint8Array` of bytes to write immediately (empty when there are none).

#### Migration

```diff
-term.update({ events });
+const out = term.update(events);
+if (out.length) process.stdout.write(out);
```

```diff
-term.update({ width, height });
+term.update([{ type: "resize", width, height }]);
```

To opt in to terminfo-based capability detection:

```diff
+const terminfo = await detectTerminal({ env: process.env });
 const term = await createTerm({ width, height, terminfo });
 const input = await createInput({ terminfo });
+process.stdout.write(terminfo.probe);
```
