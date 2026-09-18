---
'@bomb.sh/tty': minor
---

Adds `detectTerminal`, `Capabilities`, `Detection`, `CapabilityEvent`, and `KeyTable` to the public API.

`detectTerminal()` reads a compiled terminfo binary (from disk or injected bytes), applies environment evidence (`COLORTERM`), and returns a frozen `Detection` carrying static `Capabilities`, a `probe` query batch to write to stdout, and opaque `keys` bytes for the input parser.

Pass `detection` to `createInput` to seed its escape-sequence trie with terminal-specific `key_*` sequences. Pass capability events from `scan()` to `term.update()` to keep the renderer's runtime capability snapshot current.

`scan()` now recognizes probe responses — OSC 10/11/12/21/22, XTGETTCAP, DECRPM mode 2026, kitty keyboard, kitty graphics APC, and the DA1 fence — and surfaces them as `CapabilityEvent` values interleaved with key and mouse events. Route these to `term.update()`, which returns a `Uint8Array` of bytes to write immediately (empty when no output is needed).

`InputOptions.terminfo` is replaced by `InputOptions.detection`. Both parsers remain usable without a `Detection`; the 256-color baseline and xterm default key sequences apply when it is omitted.

#### Migration

```diff
-const input = await createInput({ terminfo: await Deno.readFile(terminfoPath) });
+const detection = await detectTerminal({ env: process.env });
+const input = await createInput({ detection });
+process.stdout.write(detection.probe);
```

```diff
-term.update({ events: resizeEvents });
+for (const event of input.scan(bytes).events) {
+  if (event.type === "resize" || event.type === "capability") {
+    const out = term.update(event);
+    if (out.length) process.stdout.write(out);
+  }
+}
```