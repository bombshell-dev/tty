# AGENTS.md

## Spec-driven development

- Specs in `specs/` are the source of truth. Code conforms to specs, not the
  other way around.

- Never add, remove, or change a public API in code without first updating the
  relevant spec and getting explicit approval from the user. This includes
  changes to `Term`, `createTerm`, `render()`, directive constructors (`open`,
  `close`, `text`), sizing helpers (`grow`, `fixed`, `fit`), and any future
  spec'd interfaces.

- The workflow is: propose the spec change, wait for approval, then implement.
  Do not combine spec changes with implementation in a single step.

- During implementation, the spec is the sole authority. Do not add APIs,
  exports, parameters, or architectural elements that are not described in the
  spec — even if an implementation plan or subagent recommends them. If the spec
  is insufficient, update the spec first.

- If an implementation requires changing any API boundary — public TS exports,
  WASM exports, function signatures, the command protocol, or any interface that
  crosses a module boundary — stop and consult the user before proceeding. Do
  not rationalize changes as "internal." If it has a signature, it's an API.

- The renderer and input parser are specified separately (`renderer-spec.md` and
  `input-spec.md`). They are architecturally independent. Do not introduce
  dependencies between them.

- Each test file tests exactly one spec. Do not put tests for one spec into
  another spec's test file.

## Commit and PR conventions

Do not include any agent marketing material (e.g. "Generated with...",
"Co-Authored-By: \<agent>") in commits, pull requests, issues, or comments.

Before every commit, run `deno fmt` and `deno lint` and fix any issues. For C
files, also run `clang-format -i src/*.c src/*.h`. Do not commit unformatted
code.

## Rendering invariants

- The renderer MUST NOT perform IO. It produces bytes; the caller writes them.

- The renderer MUST NOT manage terminal state (alternate buffer, cursor
  visibility, mouse reporting, keyboard protocol modes).

- Each frame is a complete snapshot. The renderer carries no UI tree state
  between frames — only cell buffers for diffing.

- Directives are plain objects. No classes, no methods, no prototype chains. The
  flat array pattern is normative.

## C code conventions

- No global mutable state. All state belongs on a struct instance (e.g.
  `Clayterm`). Use Clay's `userData` pointer or similar mechanisms to route
  callbacks back to the owning instance.
