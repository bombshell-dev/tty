# Review patterns

Recurring maintainer review feedback, distilled from past PRs. Hard rules live
in `AGENTS.md`; these are the judgment calls. Check a change against this list
before opening a PR. PR numbers point at the original discussion.

## Specs

- Specify edge-case policy (timeouts, capacity exhaustion, overflow) before
  writing tests that prescribe an outcome (#85, #132).
- Use the spec's vocabulary: directives (`open`/`close`/`text`), not
  "descriptors" (#5).
- Don't externalize internal helpers into the spec just to unit-test them. A
  `Term` does no IO, so test through the public API (#130).
- Spec'd C functions state how errors are represented (#130). Reference links
  are complete URLs, not bare domains (#130).
- Facts that will never change belong in the normative section, not in
  implementation notes (#5).

## Native first

- Prefer encoding new declarations in the binary format and resolving them
  during rendering, as `text({ caret })` does, over re-scanning ops in
  TypeScript. A snapshot stays a snapshot (#137).
- Logic that any host language would need belongs in C, so non-JS frameworks get
  the same behavior (#116).
- Follow Clay's intended mechanisms. Don't build a parallel code path to an
  algorithm Clay already owns (e.g. text measurement) (#30). Link upstream Clay
  issues for local workarounds so they can be removed later (#85).

## API shape

- Collapse type variants: one event union, one array-taking signature, no
  overloads that only tests use (#133).
- Names carry constraints: `id` when it must be unique, not `name` (#5).
- Static facts are fixed at `createTerm()`; dynamic changes arrive as events via
  `term.update()`, which returns the bytes to write. Don't defer work to the
  next `render()` (#106).
- Front-load configuration at creation so each paint stays one
  `write(result.output)` (#101).

## C and WASM correctness

- Don't record side effects for operations that may no-op. `setcell()` returns
  early outside the clip rect (#114).
- When growing WASM memory, account for every region (parser state, transfer
  buffer, tables). Keep a comment describing the memory layout (#132).
- Check return values (e.g. `trie_add()` exhaustion) (#132).
- Preserve signals in public functions (`wcwidth()` returns `-1` for
  unprintable) (#49).
- Prefix C constants and put them in the header (`TERMINFO_*` in `terminfo.h`)
  unless they mirror an external name (#131).

## Tests

- One spec per test file; put tests in the matching file (e.g. color behavior in
  `test/color.test.ts`) (#93).
- Build input with named helpers (`arrowUp()`, `mousePress()`) instead of byte
  arrays annotated by comments (#91).
- Keep fixtures minimal; drop wrappers the assertion doesn't need (#87).
- Parsers need adversarial coverage: incomplete and invalid input, every
  byte-boundary split, conflicting replies in either order, capacity exhaustion,
  numeric overflow, and recovery of the following key (#132).

## Performance

- Split unambiguous wins from trade-offs into separate PRs. Size-vs-speed
  changes (`-Oz`, compression) need a benchmark showing the cost (#35, #50).
- Benchmark only APIs that matter: `createTerm()`, `render()`, `createInput()`.
  Startup belongs in a fresh process (#52).
- Distrust regressions in benches the diff can't reach; investigate noise before
  reacting (#56, #85, #102).

## Hygiene

- Run `deno task fmt` before opening a PR (#6, #28, #102).
- Add a changeset for user-facing changes (#114).
- Commits must be signed (#42). Follow the org PR template (#29).
- Don't add build workarounds (PATH hacks, shims) for local-only environment
  issues when CI builds clean (#6, #32).
- Examples: `main()` at the top, helpers below (#48). Annotate raw escape
  sequences (`// SGR reset`) (#48).
