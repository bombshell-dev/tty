---
'@bomb.sh/tty': patch
---

Shrinks the bundled WebAssembly module by compiling out Clay's unused debug-inspector UI, which was never enabled at runtime. Raw wasm drops ~35% (155,877 → 101,208 bytes; ~29 KB brotli), reducing install and startup cost with no change to rendering behavior.
