---
---

Adds `CapabilityEvent` to `InputEvent` and a `detection` option to `InputOptions`.

`scan()` now parses terminal probe responses — OSC 10/11/12 theme colors, OSC 21 kitty color protocol, OSC 22 pointer shape, XTGETTCAP (`DCS`), kitty graphics (`APC`), kitty keyboard (`CSI ?…u`), synchronized output (`DECRPM`), and DA1 — and surfaces them as typed `CapabilityEvent` objects with keys `foreground-color`, `background-color`, `cursor-color`, `colordepth`, `sync-output`, `kitty-keyboard`, `kitty-graphics`, and `pointer-shape`.

The `terminfo` option on `InputOptions` is replaced by `detection` (a `Detection` returned by `detectTerminal()`). Passing a `Detection` seeds the key-sequence trie from `detection.keys` and uses `detection.capabilities.colors` to resolve colordepth denial events to the correct tier (`"16"` vs `"256"`).

#### Migration

```diff
- import { createInput } from "@bombshell/input";
+ import { createInput } from "@bombshell/input";
+ import { detectTerminal } from "@bombshell/input/terminfo";

- const input = await createInput({ terminfo: myTerminfoBinary });
+ const detection = await detectTerminal({ env: process.env });
+ const input = await createInput({ detection });
```

If you passed `terminfo` only for key-sequence accuracy and do not need capability events, omit `detection` entirely — the parser falls back to xterm defaults as before.