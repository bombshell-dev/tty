/* tty.h — WASM terminal rendering engine for Clay UI */

#ifndef TTY_H
#define TTY_H

#include <stdint.h>

#include "cell.h"

struct tty;

/* WASM exports */
int tty_size(int w, int h);
struct tty *init(void *mem, int w, int h);
void reduce(struct tty *ct, uint32_t *buf, int len, int mode, int row,
            float deltaTime);
char *output(struct tty *ct);
int length(struct tty *ct);
int animating(struct tty *ct);
void measure(int ret, int txt);

int get_element_bounds(const char *name, int name_len, float *out);

int pointer_over_count(void);
int pointer_over_id_string_length(int index);
int pointer_over_id_string_ptr(int index);

#endif
