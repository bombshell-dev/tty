---
"@bomb.sh/tty": patch
---

Fixes pointer events and pointer shape on a cell where two elements meet. The pointer at that cell is now over only the element that draws it, so clicking a row in a list no longer also clicks the row above it.
