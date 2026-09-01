---
'@bomb.sh/tty': minor
---

Adds a `caret` property to text elements that positions the terminal's hardware cursor at a code-point offset within the text. When a caret is declared the renderer emits the cursor at the resolved cell and shows it; when no text carries a caret the cursor stays hidden.

The offset is resolved through wrapping and wide-character widths, so the cursor lands on the correct cell across wrapped lines. An offset equal to the content length places the cursor one cell past the last character, and a caret on empty content places it at the text element's origin — giving text inputs a real, movable cursor.
