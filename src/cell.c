/* cell.c — cell buffer operations */

#include "cell.h"

void cells_fill(Cell *buf, int w, int h, uint32_t ch, uint32_t fg,
                uint32_t bg) {
  /* Designated init zeros unspecified fields (including combining[]). */
  Cell tmpl = {.ch = ch, .fg = fg, .bg = bg};
  for (int i = 0; i < w * h; i++)
    buf[i] = tmpl;
}

int cell_cmp(Cell *a, Cell *b) {
  if (a->ch != b->ch || a->fg != b->fg || a->bg != b->bg)
    return 1;
  for (int i = 0; i < CELL_MAX_COMBINING; i++) {
    if (a->combining[i] != b->combining[i])
      return 1;
  }
  return 0;
}
