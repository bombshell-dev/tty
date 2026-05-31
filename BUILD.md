# Building clayterm from source

This guide is for maintainers and builders working on clayterm itself.

It covers:

- cloning the repo correctly,
- initializing the `clay` git submodule,
- installing the toolchain needed to compile the C sources to WebAssembly,
- building the local development artifacts, and
- verifying that the repo is ready for development.

It does **not** cover npm/JSR packaging or publishing.

## What the local build produces

The local source build is driven by `make`.

It generates:

- `clayterm.wasm` — the compiled WebAssembly module built from the C sources
- `wasm.ts` — a generated TypeScript file derived from `clayterm.wasm`

`wasm.ts` is generated output, not hand-maintained source.

## Clone the repo with submodules

The build depends on the `clay` git submodule.

Preferred fresh clone:

```sh
git clone --recurse-submodules https://github.com/bombshell-dev/clayterm.git
cd clayterm
```

If you already cloned without submodules:

```sh
git submodule update --init --recursive
```

Quick check:

```sh
git submodule status --recursive
```

You should also see a populated `clay/` directory. If `clay/` is missing or
empty, fix the submodule state before building.

## Required tools

You need:

- `git`
- `make`
- `clang` with wasm32-capable support
- `deno`

Equivalent packages are fine if your package manager uses different names.

## Install the toolchain

### macOS

Install Apple's command line tools first. They provide the base developer tools,
including `git` and `make`.

```sh
xcode-select --install
```

Then install LLVM and Deno with Homebrew:

```sh
brew install llvm deno
```

Use Homebrew LLVM before Apple's system `clang` when building clayterm:

```sh
echo 'export PATH="$(brew --prefix llvm)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

If you do not already have `git` available after installing the command line
tools, install it with Homebrew:

```sh
brew install git
```

### Debian / Ubuntu

Install the build toolchain and Git:

```sh
sudo apt-get update
sudo apt-get install -y build-essential clang lld git curl
```

Install Deno with the official installer:

```sh
curl -fsSL https://deno.land/install.sh | sh
```

Add Deno to your shell path:

```sh
echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Fedora / RHEL

Install the build toolchain and Git:

```sh
sudo dnf install -y clang lld make git curl
```

Install Deno with the official installer:

```sh
curl -fsSL https://deno.land/install.sh | sh
```

Add Deno to your shell path:

```sh
echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Windows

The recommended Windows build-host path is **WSL2 with Ubuntu**.

From an elevated PowerShell prompt:

```powershell
wsl --install -d Ubuntu
```

Then open the Ubuntu environment and follow the **Debian / Ubuntu** instructions
above.

The build host runs inside WSL2, but the resulting WebAssembly artifacts are
intended to run on **native Windows** at runtime.

## Verify the toolchain

Before building, confirm the required tools are available:

```sh
git --version
make --version
clang --version
deno --version
```

For a quick wasm-target smoke test, make sure `clang` can compile for `wasm32`:

```sh
clang --target=wasm32 -c -x c /dev/null -o /tmp/clayterm-wasm-test.o
rm -f /tmp/clayterm-wasm-test.o
```

On macOS, if `which clang` still points to `/usr/bin/clang` and the wasm test
fails, make sure the Homebrew LLVM `bin/` directory is at the front of your
`PATH`.

## Build from source

Run the local source build from the repository root:

```sh
make
```

This should produce:

- `clayterm.wasm`
- `wasm.ts`

For a clean rebuild:

```sh
make clean && make
```

## When to rebuild

Re-run `make` when:

- you change files under `src/`
- you update the `clay` submodule
- `clayterm.wasm` or `wasm.ts` is missing
- generated outputs look stale after switching branches or pulling changes

When in doubt, use a clean rebuild:

```sh
make clean && make
```

## Verify the build

After `make` succeeds, run the test suite:

```sh
deno task test
```

Before opening a PR, it is also a good idea to run the same checks CI runs:

```sh
deno task fmt:check
deno lint
```

## Troubleshooting

### `clay/` is missing or empty

Symptoms may include build failures such as:

- `fatal error: '../clay/clay.h' file not found`

Recovery:

```sh
git submodule update --init --recursive
```

Then verify the submodule state and rebuild:

```sh
git submodule status --recursive
make clean && make
```

### `clang` cannot target `wasm32`

Symptoms may include:

- target-related `clang` errors mentioning `wasm32`
- linker failures while producing `clayterm.wasm`

Recovery:

- make sure you are using an LLVM/Clang build with wasm support
- on macOS, prefer the Homebrew `llvm` toolchain over `/usr/bin/clang`
- on Linux/WSL2, make sure both `clang` and `lld` are installed
- rerun the wasm smoke test:

```sh
clang --target=wasm32 -c -x c /dev/null -o /tmp/clayterm-wasm-test.o
rm -f /tmp/clayterm-wasm-test.o
```

If the smoke test fails, fix the toolchain first and only then rerun `make`.

### Generated artifacts are missing or stale

Symptoms may include:

- `clayterm.wasm` is missing
- `wasm.ts` is missing
- you changed `src/` or updated `clay/`, but the generated outputs do not match

Recovery:

```sh
make clean && make
```

Then verify the repo is in a good state:

```sh
deno task test
```

## Scope note

This document is intentionally limited to local source builds for development.

Out of scope:

- `deno task build:npm`
- `deno task build:jsr`
- `npm publish`
- `deno publish`
- release tagging and package publishing workflows
