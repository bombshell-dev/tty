# @bomb.sh/tty

## 0.9.0

### Minor Changes

- [#116](https://github.com/bombshell-dev/tty/pull/116) [`31fc1ae`](https://github.com/bombshell-dev/tty/commit/31fc1aeface2fb9bd986f7afbcfd66b8ff063a56) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Changes `border` sides to reserve layout space instead of drawing as an overlay. Each border width is now added to the padding on its side, so content and children are laid out inside the border rather than collapsing behind the border glyphs.
  
  This is a breaking change for callers who compensated for the old behavior by setting `layout.padding` equal to the border width — that padding is now additive and double-counts. Remove the workaround:
  
  ```diff
    {
      border: { color, left: 1, right: 1, top: 1, bottom: 1 },
  -   layout: { padding: { left: 1, right: 1, top: 1, bottom: 1 } },
    }
  ```
  
  A `border` of 1 with no padding now reserves one cell per bordered side; `border` of 1 plus `padding` of 1 reserves two, measured inward from the border edge.

- [#113](https://github.com/bombshell-dev/tty/pull/113) [`6efecfb`](https://github.com/bombshell-dev/tty/commit/6efecfb699e717ab24fd5ffb4736042612cd3e75) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Adds a new `term.update()` method to resize the terminal without reinitializing the WebAssembly module.
  
  If you previously ran `createTerm({ width, height })` on resize events, you should replace that with an explicit `term.update({ width, height })` call.

- [#103](https://github.com/bombshell-dev/tty/pull/103) [`b9c10b3`](https://github.com/bombshell-dev/tty/commit/b9c10b3863593bd3efdd89fd4160b0d6bd2e7e39) Thanks [@cowboyd](https://github.com/cowboyd)! - Adds a `caret` property to text elements that positions the terminal's hardware cursor at a code-point offset within the text, resolved through wrapping and wide-character widths. The cursor shows only while a caret is declared; an offset at or past the content length places it one cell past the last character, giving text inputs a real, movable cursor.

### Patch Changes

- [#89](https://github.com/bombshell-dev/tty/pull/89) [`2ebc906`](https://github.com/bombshell-dev/tty/commit/2ebc906f5f05b07efa07aed1967b11e0338b29ea) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Shrinks the bundled WASM ~35% (156 kB → 101 kB raw) by compiling out Clay's unused debug-inspector UI.

- [#120](https://github.com/bombshell-dev/tty/pull/120) [`b371922`](https://github.com/bombshell-dev/tty/commit/b371922d5b872eaa945aa66ecc0c50289d61580e) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Scales the renderer's memory arena to the terminal grid instead of a fixed default, cutting the reservation for an 80×24 grid ~51% (4.85 MB → 2.39 MB) with no change to render performance.

- [#49](https://github.com/bombshell-dev/tty/pull/49) [`d4bc79b`](https://github.com/bombshell-dev/tty/commit/d4bc79b55e33e07d9c227626367404e11d4804f0) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Fixes width measurement for non-printable, control, and surrogate code points, which now measure as one `U+FFFD` cell to match what the renderer draws (width data regenerated against Unicode 17).

## 0.8.0

### Minor Changes

- [#27](https://github.com/bombshell-dev/tty/pull/27) Thanks [@cowboyd](https://github.com/cowboyd)! - Adds frame-to-frame transitions. Visual properties now interpolate between renders, covering the subset of animations Clay supports today.

- [#96](https://github.com/bombshell-dev/tty/pull/96) Thanks [@rauhryan](https://github.com/rauhryan)! - Adds per-side border support, so each edge of an element can be styled independently.

### Patch Changes

- [#85](https://github.com/bombshell-dev/tty/pull/85) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Fixes nested clipping so a nested clip restores its parent's region instead of disabling clipping entirely.

## 0.7.0

### Minor Changes

- [#99](https://github.com/bombshell-dev/tty/pull/99) Thanks [@cowboyd](https://github.com/cowboyd)! - Renames the published package to `@bomb.sh/tty`. The internal `clayterm.wasm` binary name is unchanged.

- [#93](https://github.com/bombshell-dev/tty/pull/93) Thanks [@rauhryan](https://github.com/rauhryan)! - Adds glyph-cell text backgrounds, so text can carry a per-glyph background color.

- [#94](https://github.com/bombshell-dev/tty/pull/94) Thanks [@rauhryan](https://github.com/rauhryan)! - Adds border-cell backgrounds, so border cells can carry their own background color.

- [#29](https://github.com/bombshell-dev/tty/pull/29) Thanks [@rauhryan](https://github.com/rauhryan)! - Expands the floating parameters on `open()` to cover more Clay options: `expand`, `attachPoints`, `pointerCaptureMode`, `clipTo`, and `zIndex`, exposed as string-literal enums.

- [#42](https://github.com/bombshell-dev/tty/pull/42) Thanks [@dreyfus92](https://github.com/dreyfus92)! - Switches alignment properties to string literals instead of numeric magic values.

- [#17](https://github.com/bombshell-dev/tty/pull/17) Thanks [@cowboyd](https://github.com/cowboyd)! - Adds `snapshot()` to pre-pack a directive subtree into its binary transfer encoding, so unchanged subtrees are not re-encoded every frame.

- [#22](https://github.com/bombshell-dev/tty/pull/22) Thanks [@cowboyd](https://github.com/cowboyd)! - Adds `RenderResult.info.get(id)` for lazy, computed element bounding-box lookup.

- [#23](https://github.com/bombshell-dev/tty/pull/23) Thanks [@cowboyd](https://github.com/cowboyd)! - Surfaces Clay layout errors per render as `errors: ClayError[]` on `RenderResult`.

- [#14](https://github.com/bombshell-dev/tty/pull/14) Thanks [@cowboyd](https://github.com/cowboyd)! - Decouples alternate-buffer switching from clearing. `alternateBuffer()` accepts `{ clear }`; `clear: false` uses xterm mode 47 to preserve alt-buffer contents.

- [#35](https://github.com/bombshell-dev/tty/pull/35) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Cuts npm install size ~63% (723 kB → 268 kB). Minimum Node is now v22.

- [#50](https://github.com/bombshell-dev/tty/pull/50) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Encodes the bundled WASM with brotli + Z85 instead of base64, cutting install size a further ~57% (270 kB → ~115 kB).

### Patch Changes

- [#20](https://github.com/bombshell-dev/tty/pull/20) Thanks [@cowboyd](https://github.com/cowboyd)! - **Breaking:** Renames the numeric `Op` discriminant to `directive` and `open()`'s `name` argument to `id`. Element IDs are hashed with a constant seed, so ensuring uniqueness is now the caller's responsibility.

- [#33](https://github.com/bombshell-dev/tty/pull/33) Thanks [@rauhryan](https://github.com/rauhryan)! - Improves packed-string overflow errors. Oversized text and element-id payloads now throw a descriptive `RangeError` instead of corrupting the buffer.

- [#87](https://github.com/bombshell-dev/tty/pull/87) Thanks [@natemoo-re](https://github.com/natemoo-re)! - Leaves the terminal default foreground for uncolored text, so uncolored glyphs no longer emit concrete white — fixing appearance on light-background terminals.

- [#24](https://github.com/bombshell-dev/tty/pull/24) Thanks [@cowboyd](https://github.com/cowboyd)! - Adds the MIT `LICENSE` file to match the declared license.

## 0.6.0

### Minor Changes

- [#4](https://github.com/bombshell-dev/tty/pull/4) Thanks [@cowboyd](https://github.com/cowboyd)! - Adds a line rendering mode (`render(ops, { mode: "line" })`) for newline-separated, pipe-friendly output. The `row` option becomes a 1-based render-time option matching DSR/CPR.

- [#9](https://github.com/bombshell-dev/tty/pull/9) Thanks [@cowboyd](https://github.com/cowboyd)! - Inlines the WASM binary into the generated TypeScript module. This drops the `node:fs/promises` read and `--allow-read`, so the module imports from non-`file://` URLs.

- Adds a `termcodes` module and makes `CursorEvent` values 1-based to match the terminal's native DSR/CPR format.

### Patch Changes

- [#7](https://github.com/bombshell-dev/tty/pull/7) Thanks [@cowboyd](https://github.com/cowboyd)! - Accepts signed int32 colors in the validator, so full-alpha `rgba()` colors (which serialize to a negative int32) no longer fail validation.

- Allows cell fill across different initialization types.

## 0.5.0

### Minor Changes

- Parses DSR cursor-position reports and renames the row-offset render option to `top`.

## 0.4.0

### Minor Changes

- Adds a `top` (row offset) option to `createTerm()` for region-mode rendering.

- Adds composable terminal settings that automatically revert when disposed.

## 0.3.0

### Minor Changes

- Adds pointer events and interactive hover to the Clay render pipeline, including the ability to capture mouse events.

- Adds progressive Kitty keyboard protocol support, with `"0"` to reset all progressive enhancements and numpad Enter/Add handling.

## 0.2.0

### Minor Changes

- Adds a Kitty keyboard protocol (CSI u) input parser.

## 0.1.3

### Patch Changes

- Preserves the parent background when a text background is set to default.

## 0.1.2

### Patch Changes

- Fixes WASM memory allocation and adds an ops-buffer overflow check.

## 0.1.1

### Patch Changes

- Exports the `input` module from `mod.ts`.

## 0.1.0

### Minor Changes

- Adds a terminal input parser.

- Adds ops validation backed by TypeBox schemas.

## 0.0.2

### Patch Changes

- Loads the WASM file with `node:fs/promises`.

## 0.0.1

### Patch Changes

- Fixes JSR publish by using token auth for scope authorization.

## 0.0.0

### Initial Release

- Initial release of the terminal rendering backend for Clay, compiled to WebAssembly. `render()` returns a `Uint8Array` of terminal output. Thanks [@cowboyd](https://github.com/cowboyd)!
