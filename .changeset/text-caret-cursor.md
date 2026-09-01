---
'@bomb.sh/tty': minor
---

Adds a `caret` property to text elements that positions the terminal's hardware cursor at a code-point offset within the text, resolved through wrapping and wide-character widths. The cursor shows only while a caret is declared; an offset at or past the content length places it one cell past the last character, giving text inputs a real, movable cursor.
