---
"@bomb.sh/tty": minor
---

Adds a new `term.update()` method to resize the terminal without reinitializing the WebAssembly module.

If you previously ran `createTerm({ width, height })` on resize events, you should replace that with an explicit `term.update({ width, height })` call.
