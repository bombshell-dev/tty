---
"@bomb.sh/tty": minor
---

Adds `CapabilityEvent` to `InputEvent` and changes `InputOptions.terminfo` to accept a `Detection`.

`scan()` now parses terminal probe responses — OSC 10/11/12 theme colors, OSC 21 kitty color protocol, OSC 22 pointer shape, XTGETTCAP (`DCS`), kitty graphics (`APC`), kitty keyboard (`CSI ?…u`), synchronized output (`DECRPM`), and DA1 — and surfaces them as typed `CapabilityEvent` objects with keys `foreground-color`, `background-color`, `cursor-color`, `colordepth`, `sync-output`, `kitty-keyboard`, `kitty-graphics`, and `pointer-shape`.

**Breaking:** `InputOptions.terminfo` now takes the `Detection` returned by `detectTerminal()` instead of raw compiled terminfo bytes. It seeds the key-sequence trie from `terminfo.keys` and uses `terminfo.capabilities.colors` to resolve colordepth denial events to the correct tier (`"16"` vs `"256"`). Raw bytes now go to `detectTerminal({ terminfo })`.

#### Migration

```diff
- import { createInput } from "@bomb.sh/tty";
+ import { createInput, detectTerminal } from "@bomb.sh/tty";

- const input = await createInput({ terminfo: myTerminfoBinary });
+ const terminfo = await detectTerminal({ env: process.env, terminfo: myTerminfoBinary });
+ const input = await createInput({ terminfo });
```

Omit `terminfo` entirely to keep the xterm default key sequences.
