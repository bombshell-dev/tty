/* mem.h — memcpy/memset shims for freestanding wasm32 */

#ifndef MEM_H
#define MEM_H

#include <stdint.h>

typedef __SIZE_TYPE__ size_t;

void *memcpy(void *dst, const void *src, size_t n);
void *memset(void *dst, int c, size_t n);
size_t strlen(const char *s);
uint32_t align8(uint32_t n);

#endif
