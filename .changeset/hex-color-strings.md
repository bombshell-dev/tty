---
"@bomb.sh/tty": minor
---

Directive color fields accept CSS-style hex color strings. `open({ bg })`,
`border.color`/`border.bg` and per-side `color`/`bg`, and
`text({ color, bg })` take `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`
(case-insensitive, `#` required) in addition to packed ARGB numbers from
`rgba()`. Strings expand to the packed value at the transfer-encoding
boundary, so the wire format, snapshots, and the renderer are unchanged.
Invalid hex is a compile-time type error on literals, rejected by
`validate()`, and throws a `TypeError` from the packer before any bytes are
produced.
