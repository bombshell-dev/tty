---
"@bomb.sh/tty": minor
---

The renderer now composites color alpha per renderer-spec §7.9. Every color's alpha byte is meaningful: backgrounds replace at α=255 (the existing opaque behavior), leave cells untouched at α=0, and tint at 0<α<255 — a translucent element keeps the glyph beneath it and composites the glyph's foreground toward the background color. Glyph colors composite against the cell background after any background from the same directive has been applied, and border backgrounds apply before their foregrounds. Compositing happens on 24-bit RGB before color encoding, so composited results narrow with the terminal's color evidence (16/256/truecolor).

Terminal-default destinations resolve through a chain: the reported theme (`term.capabilities.theme`, from probe responses) > the new `createTerm({ defaultTheme })` > a black background and a white foreground. Cells left at a terminal default still emit no color SGR.

**Breaking:** a raw `0xRRGGBB` number as a color now has alpha 0 and is fully transparent — equivalent to omitting the color. Use `rgba()` (alpha defaults to 255) to build colors.

#### Migration

```diff
  import { createTerm } from "@bomb.sh/tty";
+ import { rgba } from "@bomb.sh/tty";

- open("veil", { bg: 0xff0000 });          // was opaque, now transparent
+ open("veil", { bg: rgba(255, 0, 0) });   // opaque
+ open("veil", { bg: rgba(255, 0, 0, 128) }); // translucent tint
```
