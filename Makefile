CC = clang

CFLAGS_BASE = --target=wasm32 -nostdlib \
              -ffunction-sections -fdata-sections \
              -mbulk-memory \
              -Isrc -I.

INPUT_OPT  ?= -O2
LAYOUT_OPT ?= -O2

CLAY_PATCHES = $(sort $(wildcard patches/*.patch))

LAYOUT_CFLAGS = $(CFLAGS_BASE) $(LAYOUT_OPT) -DCLAY_IMPLEMENTATION -DCLAY_WASM \
                -DCLAY_DEBUG_MODE_ENABLED=0
INPUT_CFLAGS  = $(CFLAGS_BASE) $(INPUT_OPT)

LDFLAGS_COMMON = -Wl,--no-entry \
                 -Wl,--import-memory \
                 -Wl,--stack-first \
                 -Wl,--strip-all \
                 -Wl,--gc-sections

LAYOUT_EXPORTS = \
  -Wl,--export=__heap_base \
  -Wl,--export=clayterm_size \
  -Wl,--export=init \
  -Wl,--export=set_capabilities \
  -Wl,--export=pointer_shape \
  -Wl,--export=set_pointer_shape \
  -Wl,--export=pointer_shape \
  -Wl,--export=set_pointer_shape \
  -Wl,--export=reduce \
  -Wl,--export=output \
  -Wl,--export=length \
  -Wl,--export=measure \
  -Wl,--export=pointer_over_count \
  -Wl,--export=pointer_over_id_string_length \
  -Wl,--export=pointer_over_id_string_ptr \
  -Wl,--export=get_element_bounds \
  -Wl,--export=animating \
  -Wl,--export=error_count \
  -Wl,--export=error_type \
  -Wl,--export=error_message_length \
  -Wl,--export=error_message_ptr

INPUT_EXPORTS = \
  -Wl,--export=__heap_base \
  -Wl,--export=input_size \
  -Wl,--export=input_init \
  -Wl,--export=input_scan \
  -Wl,--export=input_count \
  -Wl,--export=input_event \
  -Wl,--export=input_delay \
  -Wl,--export=terminfo_size \
  -Wl,--export=terminfo_init \
  -Wl,--export=terminfo_parse \
  -Wl,--export=terminfo_grant \
  -Wl,--export=terminfo_confirm

LAYOUT_LDFLAGS = $(LDFLAGS_COMMON) \
                 -Wl,--undefined=Clay__MeasureText \
                 -Wl,--undefined=Clay__QueryScrollOffset \
                 $(LAYOUT_EXPORTS)

INPUT_LDFLAGS = $(LDFLAGS_COMMON) \
                $(INPUT_EXPORTS)

DEPS = $(wildcard src/*.c src/*.h)

all: layout.wasm input.wasm layout.wasm.ts input.wasm.ts
	@echo "Built layout.wasm ($$(wc -c < layout.wasm) bytes raw, $$(gzip -c layout.wasm | wc -c) bytes gzip)"
	@echo "Built input.wasm  ($$(wc -c < input.wasm) bytes raw, $$(gzip -c input.wasm | wc -c) bytes gzip)"

# Apply every patch in patches/ to the clay submodule before compiling. clay.h
# is reset to pristine first, so the applied set always matches patches/*.patch
# exactly (idempotent, applied in sorted order). Reverted by `make clean`.
# Opt-outs like CLAY_DEBUG_MODE_ENABLED=0 are selected via CFLAGS above.
# Drop individual patches as their changes ship in upstream clay.
.PHONY: clay-patch
clay-patch: $(CLAY_PATCHES)
	@git -C clay checkout -- clay.h
	@for p in $(CLAY_PATCHES); do \
	  git -C clay apply ../$$p || { echo "ERROR: failed to apply $$p to clay/clay.h" >&2; exit 1; }; \
	done

layout.wasm: $(DEPS) clay-patch
	$(CC) $(LAYOUT_CFLAGS) $(LAYOUT_LDFLAGS) -o $@ src/module-layout.c

input.wasm: $(DEPS)
	$(CC) $(INPUT_CFLAGS) $(INPUT_LDFLAGS) -o $@ src/module-input.c

layout.wasm.ts: layout.wasm
	deno run --allow-read --allow-write tasks/bundle-wasm.ts layout.wasm layout.wasm.ts

input.wasm.ts: input.wasm
	deno run --allow-read --allow-write tasks/bundle-wasm.ts input.wasm input.wasm.ts

clean:
	rm -f layout.wasm input.wasm layout.wasm.ts input.wasm.ts
	-git -C clay checkout -- clay.h

.PHONY: all clean
