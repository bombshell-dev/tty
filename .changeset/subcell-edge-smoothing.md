---
"@bomb.sh/tty": minor
---

Renders fractional rect edges as eighth-block glyphs (▏▎▍▌▋▊▉ horizontally, ▁▂▃▄▅▆▇ vertically) instead of snapping to cell boundaries, so animated rectangles slide smoothly through the shallow ends of an ease curve. Edge glyphs composite over whatever they slide across and clear stale combining marks from the cells they repaint. Corner cells stay blank where a horizontal and vertical edge meet mid-cell; a single block glyph can't express an L-corner and finer mosaic glyphs aren't reliable across terminal fonts.

Also fixes position transitions not animating when an element moves between layout containers while keeping the same position relative to its new parent (e.g. a box swapped between two rows of a grid): such moves now slide instead of teleporting.
