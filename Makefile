CC = clang
TARGET = clayterm.wasm
SRC = src/module.c

CFLAGS = --target=wasm32 -nostdlib -O2 \
         -ffunction-sections -fdata-sections \
         -mbulk-memory \
         -DCLAY_IMPLEMENTATION -DCLAY_WASM \
         -Isrc -I.

EXPORTS = \
  -Wl,--export=__heap_base \
  -Wl,--export=clayterm_size \
  -Wl,--export=init \
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
  -Wl,--export=input_delay

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

$(TARGET): $(DEPS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $(SRC)

wasm.ts: $(TARGET)
	deno run --allow-read --allow-write tasks/bundle-wasm.ts

clean:
	rm -f $(TARGET) wasm.ts

.PHONY: all clean
