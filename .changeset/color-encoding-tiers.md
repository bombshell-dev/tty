---
"@bomb.sh/tty": minor
---

The renderer now derives its SGR color encoding from the terminal's capability evidence instead of always emitting 24-bit truecolor. Truecolor evidence (`RGB`/`Tc` terminfo extension, `COLORTERM`, direct-color entries with `max_colors ≥ 2²⁴`, or a `colordepth` probe response folded through `term.update()`) keeps the historical byte-identical truecolor output. Without truecolor evidence, cells emit 256-color SGR (`\x1b[38;5;Nm`) when the resolved palette exceeds 16 colors, or 4-bit SGR (`\x1b[31m`) at or below 16.

Colors are downmapped deterministically: standard palette colors keep their classic indices (`rgba(255,0,0)` → `\x1b[31m` / `\x1b[38;5;1m`), grays use the 240-step grayscale ramp, and everything else rounds to the 6×6×6 cube. A tier change between frames forces a complete redraw so no stale encoding survives on screen.

**Breaking:** rendering without color evidence now produces 256-color bytes where it previously produced truecolor. Run `detectTerminal()` and pass its `TerminalInfo` to `createTerm` (or fold probe responses with `term.update()`) to keep truecolor output — terminals that support truecolor report it.

#### Migration

```diff
  import { createTerm } from "@bomb.sh/tty";
+ import { detectTerminal } from "@bomb.sh/tty";

- const term = await createTerm({ width, height });
+ const terminfo = await detectTerminal();
+ const term = await createTerm({ width, height, terminfo });
```
