---
"@bomb.sh/tty": minor
---

Color fields accept the CSS system color keywords (`Canvas`, `CanvasText`,
`LinkText`, `Highlight`, `GrayText`, `Mark`, `AccentColor`, ...),
case-insensitively. Instead of a fixed RGB value, each one renders with the
terminal's own theme: the default foreground or background, or an entry of the
ANSI 16-color palette (`LinkText` is blue, `GrayText` is bright black, and so
on), so output follows the user's light or dark terminal theme. The
default-color keywords mean the default of the attribute they set, so
`text({ bg: "Canvas" })` paints the terminal default background over any
enclosing element background, while an omitted `bg` still keeps it. Named in
the other field instead, a default keyword now paints the terminal's actual
default color once it's known: `text({ bg: "CanvasText" })` renders the
terminal's real default foreground color as an opaque truecolor background,
learned from the terminal's OSC 10/11 theme report, falling back to the
default background until that report arrives. Packed `rgba()` colors and
other color strings render exactly as before.
