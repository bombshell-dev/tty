---
"@bomb.sh/tty": patch
---

Retain rendered text and element IDs in frame-owned storage so metadata lookups
cannot overwrite them. Preserve emitted cursor state across frame reuse and
resizing, and keep wide-character diff markers valid between renders.
