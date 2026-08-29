# @bomb.sh/tty

## 0.8.0

### Minor Changes

- [#27](https://github.com/bombshell-dev/tty/pull/27) Thanks [@cowboyd](https://github.com/cowboyd)! - Add frame-to-frame transitions. Visual properties now interpolate between renders, covering the subset of animations Clay supports today without upstream changes.

- [#96](https://github.com/bombshell-dev/tty/pull/96) Thanks [@rauhryan](https://github.com/rauhryan)! - Add per-side border support, so each edge of an element can be styled independently. Element memory is now allocated from the maximum element wire size.

### Patch Changes

- [#85](https://github.com/bombshell-dev/tty/pull/85) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Fix nested clipping. Clip regions are now tracked on a stack so a nested clip restores its parent's rect instead of disabling clipping entirely.

- [#100](https://github.com/bombshell-dev/tty/pull/100) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump pinned GitHub Actions in the `github-actions` group.

## 0.7.0

### Minor Changes

- [#99](https://github.com/bombshell-dev/tty/pull/99) Thanks [@cowboyd](https://github.com/cowboyd)! - Rename the published package to `@bomb.sh/tty`. The internal `clayterm.wasm` binary name is unchanged.

- [#93](https://github.com/bombshell-dev/tty/pull/93) Thanks [@rauhryan](https://github.com/rauhryan)! - Add glyph-cell text backgrounds. A per-glyph background color is packed into the wire format and applied when rendering text.

- [#94](https://github.com/bombshell-dev/tty/pull/94) Thanks [@rauhryan](https://github.com/rauhryan)! - Add border-cell backgrounds, so border cells can carry their own background color.

- [#29](https://github.com/bombshell-dev/tty/pull/29) Thanks [@rauhryan](https://github.com/rauhryan)! - Expand floating parameters on `open()` to cover more Clay options: `expand`, `attachPoints`, `pointerCaptureMode`, `clipTo`, and `zIndex`, using string-literal enums.

- [#42](https://github.com/bombshell-dev/tty/pull/42) Thanks [@dreyfus92](https://github.com/dreyfus92)! - Use string literals for alignment properties instead of numeric magic values.

- [#17](https://github.com/bombshell-dev/tty/pull/17) Thanks [@cowboyd](https://github.com/cowboyd)! - Add `snapshot()` to pre-pack a directive subtree into its binary transfer encoding, so unchanged subtrees are not re-encoded every frame.

- [#22](https://github.com/bombshell-dev/tty/pull/22) Thanks [@cowboyd](https://github.com/cowboyd)! - Add `RenderResult.info.get(id)` for lazy, computed element bounding-box lookup, backed by a new WASM `get_element_bounds()`.

- [#23](https://github.com/bombshell-dev/tty/pull/23) Thanks [@cowboyd](https://github.com/cowboyd)! - Surface Clay layout errors per render as `errors: ClayError[]` on `RenderResult`, captured per-instance rather than through globals.

- [#14](https://github.com/bombshell-dev/tty/pull/14) Thanks [@cowboyd](https://github.com/cowboyd)! - Decouple alternate-buffer switching from clearing. `alternateBuffer()` accepts `{ clear }`; `clear: false` uses xterm mode 47 to preserve alt-buffer contents.

- [#35](https://github.com/bombshell-dev/tty/pull/35) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Cut npm install size ~63% (723 kB → 268 kB) through tuned clang build flags, dead-code elimination, and dropping source maps and `src/` from the package. Minimum Node is now v22.

- [#50](https://github.com/bombshell-dev/tty/pull/50) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Encode the bundled WASM with brotli-11 + Z85 instead of base64, cutting install size a further ~57% (270 kB → ~115 kB) via an inline Z85 decoder.

### Patch Changes

- [#20](https://github.com/bombshell-dev/tty/pull/20) Thanks [@cowboyd](https://github.com/cowboyd)! - **Breaking:** rename the numeric `Op` discriminant to `directive` and `open()`'s `name` argument to `id`. Element IDs are hashed with a constant seed, so ensuring uniqueness is now the caller's responsibility.

- [#33](https://github.com/bombshell-dev/tty/pull/33) Thanks [@rauhryan](https://github.com/rauhryan)! - Improve packed-string overflow errors. Oversized text and element-id payloads now throw a descriptive `RangeError` instead of corrupting the buffer.

- [#87](https://github.com/bombshell-dev/tty/pull/87) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Leave the terminal default foreground for uncolored text. Uncolored glyphs now skip the foreground SGR instead of emitting concrete white, fixing appearance on light-background terminals.

- [#5](https://github.com/bombshell-dev/tty/pull/5) Thanks [@taras](https://github.com/taras)! - Add the current-state specification documenting the rendering contract, frame-snapshot model, invariants, and public API.

- [#28](https://github.com/bombshell-dev/tty/pull/28) Thanks [@rauhryan](https://github.com/rauhryan)! - Add a maintainer build guide (`BUILD.md`) covering submodules, toolchain, rebuild triggers, and troubleshooting.

- [#24](https://github.com/bombshell-dev/tty/pull/24) Thanks [@cowboyd](https://github.com/cowboyd)! - Add the MIT `LICENSE` file to match the declared license.

- [#43](https://github.com/bombshell-dev/tty/pull/43), [#52](https://github.com/bombshell-dev/tty/pull/52), [#56](https://github.com/bombshell-dev/tty/pull/56), [#91](https://github.com/bombshell-dev/tty/pull/91) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Add a benchmark suite (ops, render, input, and startup timing) gated on CodSpeed WallTime macro benchmarks.

- [#59](https://github.com/bombshell-dev/tty/pull/59) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Add a size-report CI check that diffs unpacked npm size against the merge base and comments on the PR.

- [#46](https://github.com/bombshell-dev/tty/pull/46), [#48](https://github.com/bombshell-dev/tty/pull/48) Thanks [@jbolda](https://github.com/jbolda)! - Reorganize examples into an `examples/` folder and rewrite them with `node:` APIs so they run under both Deno and Node.

- [#36](https://github.com/bombshell-dev/tty/pull/36) Thanks [@jbolda](https://github.com/jbolda)! - Run the test suite across an OS matrix in CI.

- [#57](https://github.com/bombshell-dev/tty/pull/57) Thanks [@43081j](https://github.com/43081j)! - Pin and update GitHub Actions and enable Dependabot.

- [#38](https://github.com/bombshell-dev/tty/pull/38), [#39](https://github.com/bombshell-dev/tty/pull/39), [#40](https://github.com/bombshell-dev/tty/pull/40), [#41](https://github.com/bombshell-dev/tty/pull/41), [#55](https://github.com/bombshell-dev/tty/pull/55) Thanks [@ghostdevv](https://github.com/ghostdevv)! - Harden and update the CI workflows following the repository transfer.

## 0.6.0

### Minor Changes

- [#4](https://github.com/bombshell-dev/tty/pull/4) Thanks [@cowboyd](https://github.com/cowboyd)! - Add a line rendering mode (`render(ops, { mode: "line" })`) for newline-separated, pipe-friendly output. The `row` option becomes a 1-based render-time option matching DSR/CPR.

- [#9](https://github.com/bombshell-dev/tty/pull/9) Thanks [@cowboyd](https://github.com/cowboyd)! - Inline the WASM binary into the generated TypeScript module. This drops the `node:fs/promises` read and `--allow-read`, so the module imports from non-`file://` URLs.

- Add a `termcodes` module and make `CursorEvent` values 1-based to match the terminal's native DSR/CPR format.

### Patch Changes

- [#7](https://github.com/bombshell-dev/tty/pull/7) Thanks [@cowboyd](https://github.com/cowboyd)! - Accept signed int32 colors in the validator, so full-alpha `rgba()` colors (which serialize to a negative int32) no longer fail validation.

- Allow cell fill across different initialization types.

## 0.5.0

### Minor Changes

- Parse DSR cursor-position reports and rename the row-offset render option to `top`.

## 0.4.0

### Minor Changes

- Add a `top` (row offset) option to `createTerm()` for region-mode rendering.

- Add composable terminal settings that automatically revert when disposed.

## 0.3.0

### Minor Changes

- Add pointer events and interactive hover to the Clay render pipeline, including the ability to capture mouse events.

- Add progressive Kitty keyboard protocol support, with `"0"` to reset all progressive enhancements and numpad Enter/Add handling.

## 0.2.0

### Minor Changes

- Add a Kitty keyboard protocol (CSI u) input parser.

## 0.1.3

### Patch Changes

- Preserve the parent background when a text background is set to default.

## 0.1.2

### Patch Changes

- Fix WASM memory allocation and add an ops-buffer overflow check.

## 0.1.1

### Patch Changes

- Export the `input` module from `mod.ts`.

## 0.1.0

### Minor Changes

- Add a terminal input parser.

- Add ops validation backed by TypeBox schemas.

## 0.0.2

### Patch Changes

- Load the WASM file with `node:fs/promises`.

## 0.0.1

### Patch Changes

- Fix JSR publish by using token auth for scope authorization.

## 0.0.0

### Initial Release

- Initial release of the terminal rendering backend for Clay, compiled to WebAssembly. `render()` returns a `Uint8Array` of terminal output, with CI/CD workflows and npm/JSR build tasks in place. Thanks [@cowboyd](https://github.com/cowboyd)!
