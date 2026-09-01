---
'@bomb.sh/tty': patch
---

Scales the renderer's memory arena to the terminal grid instead of a fixed default, cutting the reservation for an 80×24 grid ~51% (4.85 MB → 2.39 MB) with no change to render performance.
