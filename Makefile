CC = clang
TARGET = clayterm.wasm
OWN_TARGET = clayterm-own.wasm
SRC = src/module.c
CLAY_PATCHES = $(sort $(wildcard patches/*.patch))

CFLAGS = --target=wasm32 -nostdlib -O2 \
         -ffunction-sections -fdata-sections \
         -mbulk-memory \
         -DCLAY_IMPLEMENTATION -DCLAY_WASM \
         -DCLAY_DEBUG_MODE_ENABLED=0 \
         -Isrc -I.

# Own-measure: Clay__MeasureText is defined in C (clayterm.c) instead of
# imported through clay.measureTextFunction. The width logic already lived in
# measure(), so the JS<->C trampoline was pure overhead. Both builds get it.
MEASURE_FLAGS = -DCLAYTERM_OWN_MEASURE

# Own-memory: the module defines and exports its own linear memory instead of
# importing env.memory, sized so a wasi app compiled --import-memory can live
# in the same memory (bento multi-module payloads share one linear memory).
# The app owns the low addresses, so this module's data/stack/heap move above
# GLOBAL_BASE (64 MiB) inside an initial 4096 pages (256 MiB), no max. Own
# builds also answer Clay's scroll-offset callback in C: no engine hosts the
# clay.* import namespace for them, and the host's answer is (0, 0) anyway.
OWN_MEMORY_FLAGS = -DCLAYTERM_OWN_MEMORY -DCLAYTERM_OWN_SCROLL \
                   -Wl,--initial-memory=268435456 \
                   -Wl,--global-base=67108864

EXPORTS = \
  -Wl,--export=__heap_base \
  -Wl,--export=clayterm_size \
  -Wl,--export=init \
  -Wl,--export=set_capabilities \
  -Wl,--export=reduce \
  -Wl,--export=output \
  -Wl,--export=length \
  -Wl,--export=measure \
  -Wl,--export=Clay_SetPointerState \
  -Wl,--export=pointer_over_count \
  -Wl,--export=pointer_over_id_string_length \
  -Wl,--export=pointer_over_id_string_ptr \
  -Wl,--export=get_element_bounds \
  -Wl,--export=animating \
  -Wl,--export=error_count \
  -Wl,--export=error_type \
  -Wl,--export=error_message_length \
  -Wl,--export=error_message_ptr \
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

# Own-memory-only exports: they route the shared-memory layout (state region,
# ops transfer buffer) to the importing app, which cannot read this module's
# __heap_base global through a plain import.
OWN_EXPORTS = \
  -Wl,--export=clayterm_init \
  -Wl,--export=clayterm_ops_buf

LDFLAGS = -Wl,--no-entry \
          -Wl,--import-memory \
          -Wl,--stack-first \
          -Wl,--strip-all \
          -Wl,--gc-sections \
          -Wl,--undefined=Clay__MeasureText \
          -Wl,--undefined=Clay__QueryScrollOffset \
          $(EXPORTS)

OWN_LDFLAGS = -Wl,--no-entry \
          -Wl,--strip-all \
          -Wl,--gc-sections \
          -Wl,--undefined=Clay__MeasureText \
          -Wl,--undefined=Clay__QueryScrollOffset \
          $(EXPORTS) $(OWN_EXPORTS)

all: $(TARGET) wasm.ts
	@echo "Built $(TARGET) ($$(wc -c < $(TARGET)) bytes raw, $$(gzip -c $(TARGET) | wc -c) bytes gzip)"

DEPS = $(wildcard src/*.c src/*.h)

define compile_rule
@git -C clay checkout -- clay.h
@for p in $(CLAY_PATCHES); do \
  git -C clay apply ../$$p || { echo "ERROR: failed to apply $$p to clay/clay.h" >&2; exit 1; }; \
done
$(CC) $(CFLAGS) $(MEASURE_FLAGS) $(2) $(3) -o $1 $(SRC)
endef

# Apply every patch in patches/ to the clay submodule before compiling. clay.h
# is reset to pristine first, so the applied set always matches patches/*.patch
# exactly (idempotent, applied in sorted order). Reverted by `make clean`.
# Opt-outs like CLAY_DEBUG_MODE_ENABLED=0 are selected via CFLAGS above.
# Drop individual patches as their changes ship in upstream clay.
$(TARGET): $(DEPS) $(CLAY_PATCHES)
	$(call compile_rule,$(TARGET),$(LDFLAGS),)

# Same module, but defining (not importing) its own linear memory, for engines
# that instantiate modules without a host memory to hand over (bento
# multi-module: the app imports this memory). Not used by the npm artifact.
$(OWN_TARGET): $(DEPS) $(CLAY_PATCHES)
	$(call compile_rule,$(OWN_TARGET),$(OWN_LDFLAGS),$(OWN_MEMORY_FLAGS))

wasm.ts: $(TARGET)
	deno run --allow-read --allow-write tasks/bundle-wasm.ts

clean:
	rm -f $(TARGET) $(OWN_TARGET) wasm.ts
	-git -C clay checkout -- clay.h

.PHONY: all clean
