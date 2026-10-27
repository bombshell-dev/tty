---
"@bomb.sh/tty": patch
---

Fixes stale element bounds in `@bomb.sh/tty`: `result.info.get(id)` returns
`undefined` for elements absent from the latest render.

Fixes the caret cursor remaining visible after a resize when the next render in
the default mode omits the caret.
