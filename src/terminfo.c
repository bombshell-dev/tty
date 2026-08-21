/* terminfo.c — shared terminal capability layer */

#include "terminfo.h"

#include "mem.h"

#define TI_MAGIC_LEGACY 0x011a
#define TI_MAGIC_EXTENDED 0x021e

/* Standard capability indices (ncurses Caps). */
#define TI_BOOL_AM 1
#define TI_BOOL_XENL 4
#define TI_BOOL_BCE 28
#define TI_NUM_MAX_COLORS 13
#define TI_STR_SMCUP 28

int terminfo_size(void) { return align8(sizeof(struct TermInfo)); }

struct TermInfo *terminfo_init(void *mem) {
  struct TermInfo *ti = (struct TermInfo *)mem;
  ti->generation = 1;
  ti->colors = 256;
  ti->flags = TERMINFO_BCE | TERMINFO_AM | TERMINFO_XENL | TERMINFO_ALTSCREEN;
  ti->confirmed = 0;
  ti->theme_fg = 0;
  ti->theme_bg = 0;
  ti->theme_cursor = 0;
  return ti;
}

void terminfo_grant(struct TermInfo *ti, uint32_t flags) {
  if ((ti->flags & flags) == flags)
    return;
  ti->flags |= flags;
  ti->generation++;
}

static uint16_t rd_u16(const uint8_t *b, int off) {
  return (uint16_t)(b[off] | (b[off + 1] << 8));
}

/* Signed terminfo number: -1 = absent, -2 = cancelled. */
static int32_t rd_num(const uint8_t *b, int off, int width) {
  if (width == 2) {
    uint16_t v = rd_u16(b, off);
    if (v == 0xffff)
      return -1;
    if (v == 0xfffe)
      return -2;
    return (int32_t)v;
  }
  uint32_t v = (uint32_t)b[off] | ((uint32_t)b[off + 1] << 8) |
               ((uint32_t)b[off + 2] << 16) | ((uint32_t)b[off + 3] << 24);
  return (int32_t)v;
}

static int rd_i16(const uint8_t *b, int off) {
  uint16_t v = rd_u16(b, off);
  if (v == 0xffff)
    return -1;
  if (v == 0xfffe)
    return -2;
  return (int)v;
}

static int ti_strnlen(const uint8_t *b, int max) {
  int n = 0;
  while (n < max && b[n])
    n++;
  return n;
}

static int name_is(const uint8_t *table, int table_len, int off,
                   const char *name) {
  if (off < 0 || off >= table_len)
    return 0;
  int i = 0;
  while (name[i]) {
    if (off + i >= table_len || table[off + i] != (uint8_t)name[i])
      return 0;
    i++;
  }
  return off + i < table_len && table[off + i] == 0;
}

/* Extended capability block (after the standard sections). Returns 0 on
 * success, nonzero when the declared structure runs out of bounds.
 * Grants flag bits into *flags for RGB/Tc/Su booleans and Smulx. */
static int parse_ext(const uint8_t *b, int len, int off, int numw,
                     uint32_t *flags) {
  if (off & 1)
    off++;
  if (off + 10 > len)
    return 0; /* no extended block */

  int eb = rd_i16(b, off);
  int en = rd_i16(b, off + 2);
  int es = rd_i16(b, off + 4);
  int table_strings = rd_i16(b, off + 6);
  int table_len = rd_i16(b, off + 8);
  if (eb < 0 || en < 0 || es < 0 || table_strings < 0 || table_len < 0)
    return 1;

  int bools_off = off + 10;
  int nums_off = bools_off + eb;
  if (nums_off & 1)
    nums_off++;
  int offsets_off = nums_off + en * numw;
  int name_count = eb + en + es;
  int names_off = offsets_off + es * 2;
  int table_off = names_off + name_count * 2;
  if (table_off + table_len > len)
    return 1;

  const uint8_t *table = b + table_off;

  /* Value strings sit at the head of the table; names follow. Name
   * offsets are relative to the start of the names sub-table. */
  int names_base = 0;
  for (int i = 0; i < es; i++) {
    int v = rd_i16(b, offsets_off + i * 2);
    if (v < 0)
      continue;
    if (v >= table_len)
      return 1;
    int end = v + ti_strnlen(table + v, table_len - v) + 1;
    if (end > names_base)
      names_base = end;
  }

  for (int i = 0; i < name_count; i++) {
    int noff = rd_i16(b, names_off + i * 2);
    if (noff < 0)
      continue;
    noff += names_base;

    if (i < eb) {
      if (!b[bools_off + i])
        continue;
      if (name_is(table, table_len, noff, "Tc") ||
          name_is(table, table_len, noff, "RGB")) {
        *flags |= TERMINFO_TRUECOLOR;
      } else if (name_is(table, table_len, noff, "Su")) {
        *flags |= TERMINFO_STYLED_UNDERLINE;
      }
    } else if (i >= eb + en) {
      int v = rd_i16(b, offsets_off + (i - eb - en) * 2);
      if (v < 0)
        continue;
      if (name_is(table, table_len, noff, "Smulx")) {
        *flags |= TERMINFO_STYLED_UNDERLINE;
      }
    }
  }

  return 0;
}

const char *terminfo_str(const uint8_t *bytes, int len, int index,
                         int *out_len) {
  if (!bytes || len < 12 || index < 0)
    return 0;
  uint16_t magic = rd_u16(bytes, 0);
  int numw;
  if (magic == TI_MAGIC_LEGACY) {
    numw = 2;
  } else if (magic == TI_MAGIC_EXTENDED) {
    numw = 4;
  } else {
    return 0;
  }

  int name_size = rd_i16(bytes, 2);
  int bool_count = rd_i16(bytes, 4);
  int num_count = rd_i16(bytes, 6);
  int str_count = rd_i16(bytes, 8);
  int table_len = rd_i16(bytes, 10);
  if (name_size < 0 || bool_count < 0 || num_count < 0 || str_count < 0 ||
      table_len < 0)
    return 0;
  if (index >= str_count)
    return 0;

  int nums_off = 12 + name_size + bool_count;
  if (nums_off & 1)
    nums_off++;
  int strs_off = nums_off + num_count * numw;
  int table_off = strs_off + str_count * 2;
  if (table_off + table_len > len)
    return 0;

  int v = rd_i16(bytes, strs_off + index * 2);
  if (v < 0 || v >= table_len)
    return 0;
  int n = ti_strnlen(bytes + table_off + v, table_len - v);
  if (n == 0)
    return 0;
  if (out_len)
    *out_len = n;
  return (const char *)(bytes + table_off + v);
}

int terminfo_parse(const uint8_t *bytes, int len, struct TermInfo *ti) {
  if (len < 12)
    return 1;

  uint16_t magic = rd_u16(bytes, 0);
  int numw;
  if (magic == TI_MAGIC_LEGACY) {
    numw = 2;
  } else if (magic == TI_MAGIC_EXTENDED) {
    numw = 4;
  } else {
    return 2;
  }

  int name_size = rd_i16(bytes, 2);
  int bool_count = rd_i16(bytes, 4);
  int num_count = rd_i16(bytes, 6);
  int str_count = rd_i16(bytes, 8);
  int table_len = rd_i16(bytes, 10);
  if (name_size < 0 || bool_count < 0 || num_count < 0 || str_count < 0 ||
      table_len < 0)
    return 3;

  int bools_off = 12 + name_size;
  int nums_off = bools_off + bool_count;
  if (nums_off & 1)
    nums_off++;
  int strs_off = nums_off + num_count * numw;
  int table_off = strs_off + str_count * 2;
  int end = table_off + table_len;
  if (end > len)
    return 4;

  uint32_t flags = 0;
  if (bool_count > TI_BOOL_AM && bytes[bools_off + TI_BOOL_AM])
    flags |= TERMINFO_AM;
  if (bool_count > TI_BOOL_XENL && bytes[bools_off + TI_BOOL_XENL])
    flags |= TERMINFO_XENL;
  if (bool_count > TI_BOOL_BCE && bytes[bools_off + TI_BOOL_BCE])
    flags |= TERMINFO_BCE;

  int32_t colors = 0;
  if (num_count > TI_NUM_MAX_COLORS) {
    int32_t v = rd_num(bytes, nums_off + TI_NUM_MAX_COLORS * numw, numw);
    if (v > 0)
      colors = v;
  }
  if (colors >= (1 << 24))
    flags |= TERMINFO_TRUECOLOR;

  if (str_count > TI_STR_SMCUP) {
    int v = rd_i16(bytes, strs_off + TI_STR_SMCUP * 2);
    if (v >= 0 && v < table_len)
      flags |= TERMINFO_ALTSCREEN;
  }

  if (parse_ext(bytes, len, end, numw, &flags))
    return 5;

  /* The entry describes the terminal completely for the capabilities it
   * owns: replace them, leave probe-only flags and theme fields alone. */
  uint32_t keep =
      ~(TERMINFO_TRUECOLOR | TERMINFO_BCE | TERMINFO_AM | TERMINFO_XENL |
        TERMINFO_ALTSCREEN | TERMINFO_STYLED_UNDERLINE);
  ti->flags = (ti->flags & keep) | flags;
  ti->colors = (uint32_t)colors;
  ti->generation++;
  return 0;
}
