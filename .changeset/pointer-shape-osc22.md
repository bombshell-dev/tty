---
"@bomb.sh/tty": minor
---

Adds a `pointerShape` property to `open()`, so the mouse pointer changes shape (OSC 22) as it moves over elements

When the terminal confirms support through the probe (`term.capabilities.pointerShape`), `render()` appends the shape change to `output`, so writing `output` keeps the pointer in sync. The shape resets to `default` when the pointer leaves, when a frame renders without `pointer`, or when `update()` withdraws the capability. For a terminal that sets shapes but never answers the query, assert support with `term.update([{ type: "capability", key: "pointer-shape", value: true }])`.

```ts
term.render([open("link", { pointerShape: "pointer" }), text("Docs"), close()], { pointer });
```
