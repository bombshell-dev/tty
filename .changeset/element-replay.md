---
"@bomb.sh/tty": minor
---

Adds `result.info.get(id).replay` to reuse an entire rendered element, including
its descendants, in the next `render()` call without rebuilding or repacking its
directives. Obtain a fresh replay from each completed render; `update()` and
rejected renders preserve existing replays.

Removes `snapshot()`. Use the rendered element's `replay` directive instead.
