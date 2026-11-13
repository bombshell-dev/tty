/* string.h — <string.h> for freestanding wasm32, as included by xxhash.h */

#ifndef CLAYTERM_STRING_H
#define CLAYTERM_STRING_H

#include "mem.h"

/* Declared for XXH128_isEqual, which is never called; mem.c has no memcmp. */
int memcmp(const void *a, const void *b, size_t n);

#endif
