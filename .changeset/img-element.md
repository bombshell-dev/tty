---
"@bomb.sh/tty": minor
---

Adds the `img()` directive — declarative images rendered through a fidelity ladder: kitty graphics protocol pixels, shape-aware ASCII character art, or alt text, resolved from capability evidence (`RuntimeCapabilities.kittyGraphics`).

Surfaces are caller-owned decoded RGBA buffers managed by the Term:

```ts
term.setImage(1, { width: 128, height: 64, pixels: rgba8 });
term.removeImage(1); // returns deletion bytes to write now
term.render([img("cover", { image: 1, alt: "cover art" })]);
```

`createTerm` takes an `imagePoolBytes` option (default 4 MiB) sizing the fixed pixel pool. Transmission is lazy; re-transmission only on data change; steady-state renders are byte-silent. `update()` emits cleanup bytes immediately when a capability denial or resize kills live placements (TINV-5). Line mode caps the ladder at ascii. Errors surface as `IMAGE_NOT_FOUND`, `IMAGE_PLACEMENTS_EXCEEDED`, and `IMAGE_PLACEMENT_COLLISION`.
