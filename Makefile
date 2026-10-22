CC = clang
TARGET = clayterm.wasm
SRC = src/module.c
CLAY_PATCHES = $(sort $(wildcard patches/*.patch))

CFLAGS = --target=wasm32 -nostdlib -O2 \
         -ffunction-sections -fdata-sections \
         -mbulk-memory \
         -DCLAY_IMPLEMENTATION -DCLAY_WASM \
         -DCLAY_DEBUG_MODE_ENABLED=0 \
         -Isrc -Ibuild/clay -I.

EXPORTS = \
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

LDFLAGS = -Wl,--no-entry \
          -Wl,--import-memory \
          -Wl,--stack-first \
          -Wl,--strip-all \
          -Wl,--gc-sections \
          -Wl,--undefined=Clay__MeasureText \
          -Wl,--undefined=Clay__QueryScrollOffset \
          $(EXPORTS)

all: $(TARGET) wasm.ts
	@echo "Built $(TARGET) ($$(wc -c < $(TARGET)) bytes raw, $$(gzip -c $(TARGET) | wc -c) bytes gzip)"

DEPS = $(wildcard src/*.c src/*.h)

# Patch a generated copy; never reset or edit the upstream submodule checkout.
build/clay/clay.h: clay/clay.h $(CLAY_PATCHES)
	@mkdir -p build/clay
	git -C clay show HEAD:clay.h > $@
	@for p in $(CLAY_PATCHES); do patch -s -d build/clay -p1 < $$p || exit 1; done

$(TARGET): $(DEPS) build/clay/clay.h
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $(SRC)

native: build/clay/clay.h
	deno run --allow-read --allow-write --allow-env --allow-run tasks/build-native.ts

wasm.ts: $(TARGET)
	deno run --allow-read --allow-write tasks/bundle-wasm.ts

clean:
	rm -f $(TARGET) wasm.ts
	rm -rf build/clay build/native-clay native

.PHONY: all clean native
