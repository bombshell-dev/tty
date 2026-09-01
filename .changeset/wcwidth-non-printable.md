---
'@bomb.sh/tty': patch
---

Fixes width measurement for non-printable, control, and surrogate code points, which now measure as one `U+FFFD` cell to match what the renderer draws (width data regenerated against Unicode 17).
