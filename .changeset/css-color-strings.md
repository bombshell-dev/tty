---
"@bomb.sh/tty": minor
---

Directive color fields accept CSS color strings. `open({ bg })`,
`border.color`/`border.bg` and per-side `color`/`bg`, and
`text({ color, bg })` take hex (`#f80`, `#ff8800aa`), named colors
(`rebeccapurple`, `transparent`), and `rgb()`, `hsl()`, `hwb()`, `lab()`,
`lch()`, `oklab()`, and `oklch()` in addition to packed ARGB numbers from
`rgba()`. Strings resolve to sRGB at the transfer-encoding boundary, so the
wire format, snapshots, and the renderer are unchanged; out-of-gamut colors
clip per channel. Invalid hex, unknown names, and unsupported functions are
compile-time type errors on literals, are rejected by `validate()`, and throw
a `TypeError` from the packer before any bytes are produced.
