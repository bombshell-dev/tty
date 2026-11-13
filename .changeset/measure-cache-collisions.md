---
"@bomb.sh/tty": patch
---

Fixes text that could be measured and drawn as a different string. Two texts whose measurement-cache hashes collide now each keep their own width and wrapping, within one frame and across renders.
