---
"@bomb.sh/tty": patch
---

Fixes combining marks (accents, ZWJ, variation selectors, kitty-graphics placeholder diacritics) being silently dropped from rendered output instead of attaching to their base character's cell. Cells that overflow the 8-mark-per-cell limit now also surface a `COMBINING_MARKS_EXCEEDED` render error instead of truncating silently.
