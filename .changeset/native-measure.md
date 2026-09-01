---
'@bomb.sh/tty': patch
---

Improves text measurement performance by keeping Clay's measure callback inside the wasm module, removing a wasm→JS→wasm round-trip on every uncached measurement and shrinking the module ~5%
