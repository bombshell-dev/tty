/* cell.h — cell type and buffer operations */

#ifndef CELL_H
#define CELL_H

#include <stdint.h>

/* Maximum combining marks stored per cell. Marks beyond this limit are
 * silently truncated from the end; the first CELL_MAX_COMBINING are kept. */
#define CELL_MAX_COMBINING 8

typedef struct {
  uint32_t ch;
  uint32_t fg;                          /* 0xAARRGGBB — upper byte: attribute flags */
  uint32_t bg;                          /* 0xAARRGGBB — upper byte: attribute flags */
  uint32_t combining[CELL_MAX_COMBINING]; /* zero-terminated combining-mark codepoints */
} Cell;

/* Attribute flags (packed into high byte of fg) */
#define ATTR_BOLD 0x01000000
#define ATTR_DIM 0x02000000
#define ATTR_ITALIC 0x04000000
#define ATTR_UNDERLINE 0x08000000
#define ATTR_BLINK 0x10000000
#define ATTR_REVERSE 0x20000000
#define ATTR_STRIKEOUT 0x40000000
#define ATTR_DEFAULT 0x80000000 /* use terminal default color */

#define ATTR_MASK 0xFF000000
#define COLOR_MASK 0x00FFFFFF

void cells_fill(Cell *buf, int w, int h, uint32_t ch, uint32_t fg, uint32_t bg);
int cell_cmp(Cell *a, Cell *b);

#endif
