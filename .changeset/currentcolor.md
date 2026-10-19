---
"@bomb.sh/tty": minor
---

`open()` accepts a `color` field: the element's own foreground color, inherited
by every descendant that doesn't set its own. `currentcolor` is now a valid
color string everywhere, including `color` itself, where it means "inherit"
(the same as omitting the field). Used in any other color field —
`open({ bg })`, `text({ bg })`, `border.color`, `border.bg`, or a structured
border side's `color`/`bg` — it resolves to the directive's own resolved
color (its explicit `color`, or the color it inherits), then follows the same
field resolution as any other color, so it probes the terminal theme and
transitions normally when that resolved color is an sRGB value. `border.color`
is now optional and defaults to `currentcolor`, matching CSS; a border with no
`color` set anywhere picks up the element's own foreground, same as before
this feature existed.
