/* clayterm.h — WASM terminal rendering engine for Clay UI */

#ifndef CLAYTERM_H
#define CLAYTERM_H

#include <stdint.h>

#include "cell.h"

struct Clayterm;

/* WASM exports */
int clayterm_size(int w, int h);
struct Clayterm *init(void *mem, int w, int h);
void reduce(struct Clayterm *ct, uint32_t *buf, int len, int mode, int row);
char *output(struct Clayterm *ct);
int length(struct Clayterm *ct);
void measure(int ret, int txt);

int get_scroll_delta(struct Clayterm *ct, const char *name, int name_len,
                     float *out);
int get_element_bounds(const char *name, int name_len, float *out);

int pointer_over_count(void);
int pointer_over_id_string_length(int index);
int pointer_over_id_string_ptr(int index);

#endif
