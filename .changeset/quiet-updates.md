---
"@bomb.sh/tty": minor
---

Make `term.update()` return `void`. Call `term.render()` to reflect dimension and
capability changes on screen; multiple updates contribute to the next render.
Disabling pointer shape support preserves the last emitted shape without emitting
a reset. To reset the pointer, render without a pointer while support is enabled.
