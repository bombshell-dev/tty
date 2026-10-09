---
"@bomb.sh/tty": minor
---

Adds a `pointerShape` property to `open()`, so the mouse pointer changes shape (OSC 22) as it moves over elements

When the terminal confirms support through the probe (`term.capabilities.pointerShape`), `render()` appends the shape change to `output`, so writing `output` keeps the pointer in sync. The shape resets to `default` when the pointer leaves, when a frame renders without `pointer`, or when `update()` withdraws the capability. `detectTerminal()` also seeds the capability from a known-support table for terminals that set shapes without answering the query (ghostty, kitty, foot, xterm ≥ 367), so those work out of the box. For anything the table misses, assert support with `term.update([{ type: "capability", key: "pointer-shape", value: true }])`.

```ts
term.render([open("link", { pointerShape: "pointer" }), text("Docs"), close()], { pointer });
```
