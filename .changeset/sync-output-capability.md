---
"@bomb.sh/tty": minor
---

Adds synchronized output (DEC mode 2026) driven by the `sync-output` capability.

When `RuntimeCapabilities.syncOutput` is true, every full-screen render is wrapped in Begin/End Synchronized Update (`CSI ? 2026 h` / `CSI ? 2026 l`) so the terminal presents the frame as one atomic repaint without tearing. There is no new API: the capability is raised only on positive evidence, resolved from three channels — a DECRPM 2026 probe reply (`CSI ? 2026 $ p`), an XTGETTCAP `Sync` reply (the terminal's own terminfo-declared synchronization sequence, value discarded in favor of the 2026 form), and detection-time seeding from the `Sync` extended capability in the parsed terminfo entry or the `TMUX` environment variable (tmux consumes mode 2026 from inner applications). Probe replies outrank detection-time evidence in both directions, so a DECRPM 0 or 4 reply turns the capability off even when detection seeded it. Frames render unwrapped when the capability is false or unknown. Zero-diff frames emit nothing whether or not wrapping is active, and line mode is never wrapped.
