---
'@bomb.sh/tty': patch
---

Fixes character-width measurement to match what the renderer draws. Control characters, noncharacters, and other non-printable code points now measure as a single cell (drawn as `U+FFFD`) instead of being skipped, so fit-sized boxes around such text no longer come out too narrow. Lone surrogates are treated as non-printable and sanitized to `U+FFFD` rather than emitted as invalid UTF-8. Width data is also regenerated against Unicode 17.
