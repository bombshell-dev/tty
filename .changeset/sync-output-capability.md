---
"@bomb.sh/tty": minor
---

Adds synchronized output (DEC mode 2026) driven by the `sync-output` capability.

When `RuntimeCapabilities.syncOutput` is true, every full-screen render is wrapped in Begin/End Synchronized Update (`CSI ? 2026 h` / `CSI ? 2026 l`) so the terminal presents the frame as one atomic repaint without tearing. There is no new API: the capability stays false until a DECRPM 2026 probe reply reports support (`detectTerminal()` probes `CSI ? 2026 $ p`, replies surface through `input.scan()` and fold in via `term.update()`), and frames render unwrapped when it is false or unknown. Zero-diff frames emit nothing whether or not wrapping is active, and line mode is never wrapped.
