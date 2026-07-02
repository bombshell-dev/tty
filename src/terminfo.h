/* terminfo.h — shared terminal capability layer
 *
 * Implements the capability struct and terminfo binary parsing defined
 * by specs/terminfo-spec.md. The renderer reads the struct; the input
 * parser writes probe responses into it; this module owns the baseline
 * and the parse path.
 */

#ifndef TERMINFO_H
#define TERMINFO_H

#include <stdint.h>

/* Capability flag bits (terminfo-spec section 6). */
#define TERMINFO_TRUECOLOR (1u << 0)
#define TERMINFO_BCE (1u << 1)
#define TERMINFO_AM (1u << 2)
#define TERMINFO_XENL (1u << 3)
#define TERMINFO_ALTSCREEN (1u << 4)
#define TERMINFO_STYLED_UNDERLINE (1u << 5)
#define TERMINFO_SYNC (1u << 6)
#define TERMINFO_KITTY_KEYBOARD (1u << 7)
#define TERMINFO_KITTY_GRAPHICS (1u << 8)
#define TERMINFO_KITTY_COLOR (1u << 9)
#define TERMINFO_HYPERLINKS (1u << 10)
#define TERMINFO_POINTER_SHAPE (1u << 11)
#define TERMINFO_THEME_FG (1u << 12)
#define TERMINFO_THEME_BG (1u << 13)
#define TERMINFO_THEME_CURSOR (1u << 14)

/* Probe-fence marker: set in `confirmed` (never in `flags`) when a DA1
 * device attributes report is recognized. The queryTermInfo probe
 * window uses it to detect completion. */
#define TERMINFO_DA1 (1u << 31)

struct TermInfo {
  uint32_t generation;
  uint32_t colors;
  uint32_t flags;
  uint32_t confirmed;
  uint32_t theme_fg;
  uint32_t theme_bg;
  uint32_t theme_cursor;
};

/**
 * Return the number of bytes needed to hold a TermInfo struct.
 */
int terminfo_size(void);

/**
 * Initialize a capability struct to the xterm-256color baseline
 * (terminfo-spec section 7.1). Generation starts at 1.
 *
 * @param mem  Pointer to at least terminfo_size() bytes.
 * @return     The initialized struct.
 */
struct TermInfo *terminfo_init(void *mem);

/**
 * Parse a compiled terminfo entry into a capability struct.
 *
 * Supports the legacy (0432) and extended number (01036) storage
 * formats, including the extended capability table (RGB, Tc, Su,
 * Smulx). All reads are bounds-checked. On any malformed input the
 * struct is left untouched (all-or-nothing, TINV-3).
 *
 * On success the entry's standard capabilities replace the baseline:
 * booleans absent from the entry are cleared, colors becomes the
 * entry's max_colors (0 when the entry does not define it), and the
 * generation is bumped once.
 *
 * @param bytes  Compiled terminfo entry.
 * @param len    Byte length.
 * @param ti     Struct to populate.
 * @return       0 on success, nonzero parse-result code on failure.
 */
int terminfo_parse(const uint8_t *bytes, int len, struct TermInfo *ti);

/**
 * Grant capability flag bits from evidence collected outside the
 * parser (environment evidence at handle creation, e.g. COLORTERM).
 * Bumps the generation only when the flags actually change.
 */
void terminfo_grant(struct TermInfo *ti, uint32_t flags);

/**
 * Look up a standard string capability in a compiled terminfo entry.
 * Bounds-checked against len; works for both storage formats.
 *
 * @param bytes    Compiled terminfo entry.
 * @param len      Byte length.
 * @param index    Standard string capability index (ncurses Caps).
 * @param out_len  Receives the string length (excluding NUL).
 * @return         Pointer into bytes, or NULL when absent/malformed.
 */
const char *terminfo_str(const uint8_t *bytes, int len, int index,
                         int *out_len);

#endif
