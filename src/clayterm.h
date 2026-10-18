/* clayterm.h — WASM terminal rendering engine for Clay UI */

#ifndef CLAYTERM_H
#define CLAYTERM_H

#include <stdint.h>

#include "cell.h"

struct Clayterm;

/* Capability bits for set_capabilities(). */
#define RENDER_CAP_SYNC_OUTPUT (1u << 0)

/* WASM exports */
int clayterm_size(int w, int h);
struct Clayterm *init(void *mem, int w, int h);
void set_capabilities(struct Clayterm *ct, uint32_t caps);
void reduce(struct Clayterm *ct, uint32_t *buf, int len, int mode, int row,
            float deltaTime);
char *output(struct Clayterm *ct);
int length(struct Clayterm *ct);
int animating(struct Clayterm *ct);
void measure(int ret, int txt);

int get_element_bounds(const char *name, int name_len, float *out);

int pointer_over_count(void);
int pointer_over_id_string_length(int index);
int pointer_over_id_string_ptr(int index);

/* Own-memory builds only: the module defines its linear memory, so these
 * exports route the shared-memory layout to the importing app. */
#ifdef CLAYTERM_OWN_MEMORY
struct Clayterm *clayterm_init(int w, int h);
int clayterm_ops_buf(int w, int h);
#endif

#endif
