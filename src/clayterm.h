/* clayterm.h — WASM terminal rendering engine for Clay UI */

#ifndef CLAYTERM_H
#define CLAYTERM_H

#include <stdint.h>

#include "cell.h"

struct Clayterm;

/* Capability bits for set_capabilities(). */
#define RENDER_CAP_SYNC_OUTPUT (1u << 0)
#define RENDER_CAP_POINTER_SHAPE (1u << 1)

/* Packed directives and their property-group masks. */
#define CLAYTERM_OP_OPEN_ELEMENT 0x02
#define CLAYTERM_OP_TEXT 0x03
#define CLAYTERM_OP_CLOSE_ELEMENT 0x04
#define CLAYTERM_PROP_LAYOUT 0x01
#define CLAYTERM_PROP_BG_COLOR 0x02
#define CLAYTERM_PROP_CORNER_RADIUS 0x04
#define CLAYTERM_PROP_BORDER 0x08
#define CLAYTERM_PROP_CLIP 0x10
#define CLAYTERM_PROP_FLOATING 0x20
#define CLAYTERM_PROP_TRANSITION 0x40
#define CLAYTERM_PROP_CURSOR 0x80

/* Bytes of retained text-measurement cache keys per instance. Mirrors the
 * host's fixed transfer budget in term-native.ts (1MB of payload plus 120
 * bytes per Clay element at the 8192-element default), so any frame within
 * that budget has its keys copied. Larger frames borrow theirs from the
 * frame's own wire bytes for the duration of reduce(). */
#define CLAYTERM_TEXT_KEY_BYTES (1024 * 1024 + 8192 * 120)

/* WASM exports */
int clayterm_size(int w, int h);
struct Clayterm *init(void *mem, int w, int h);
int set_capabilities(struct Clayterm *ct, uint32_t caps);
int pointer_shape(struct Clayterm *ct);
void set_pointer_shape(struct Clayterm *ct, int shape);
void reduce(struct Clayterm *ct, uint32_t *buf, int len, int mode, int row,
            float deltaTime, float px, float py, int pointer);
char *output(struct Clayterm *ct);
int length(struct Clayterm *ct);
int animating(struct Clayterm *ct);
void measure(int ret, int txt);

int get_element_bounds(const char *name, int name_len, float *out);

int pointer_over_count(void);
int pointer_over_id_string_length(int index);
int pointer_over_id_string_ptr(int index);

/* Clay hook (patches/clay-measure-text-cache-key.patch): userData is the
 * owning Clayterm from Clay's error handler. */
const char *clayterm_copy_text_key(void *userData, const char *chars,
                                   int32_t length);

#endif
