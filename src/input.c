/* input.c — VT/ANSI escape sequence parser
 *
 * Decodes raw terminal input bytes into structured InputEvent records.
 * All state lives in an arena-allocated InputState; no libc required.
 *
 * Public API (exported to WASM):
 *   input_size    — compute arena size
 *   input_init    — initialize parser state in provided memory
 *   input_scan    — feed bytes, produce events
 *   input_count   — number of events from last scan
 *   input_event   — pointer to event by index
 *   input_pending  — deadline for pending ESC (0 = none)
 */

#include "input.h"
#include "terminfo.h"
#include "trie.h"
#include "mem.h"
#include "utf8.h"

#define SCAN_BUFFER_SIZE 4096
#define MAX_EVENTS 128
/* Longest capability query response we will buffer before giving up. */
#define MAX_RESPONSE 1024

/* ── State ────────────────────────────────────────────────────────── */

struct InputState {
  int esc_latency_ms;
  char buf[SCAN_BUFFER_SIZE];
  int len;
  double esc_time;
  struct InputEvent events[MAX_EVENTS];
  int count;
  int trie_len;
  struct TermInfo *ti;
  struct TermInfo ti_private;
  Trie trie;
};

/* ── Helpers ──────────────────────────────────────────────────────── */

static void shift(struct InputState *st, int n) {
  st->len -= n;
  if (st->len > 0) {
    /* move remaining bytes to front */
    for (int i = 0; i < st->len; i++)
      st->buf[i] = st->buf[i + n];
  }
}

static struct InputEvent *emit(struct InputState *st) {
  if (st->count >= MAX_EVENTS)
    return &st->events[MAX_EVENTS - 1]; /* saturate */
  struct InputEvent *ev = &st->events[st->count++];
  memset(ev, 0, sizeof(*ev));
  return ev;
}

/* ── Mouse parsing ────────────────────────────────────────────────── */

#define MOUSE_BUTTON_MASK 3
#define MOUSE_BUTTON_LEFT 0
#define MOUSE_BUTTON_MIDDLE 1
#define MOUSE_BUTTON_RIGHT 2
#define MOUSE_BUTTON_RELEASE 3
#define MOUSE_WHEEL_BIT 64

static uint8_t mouse_mods(int b) {
  uint8_t m = 0;
  if (b & 4)
    m |= MOD_SHIFT;
  if (b & 8)
    m |= MOD_ALT;
  if (b & 16)
    m |= MOD_CTRL;
  if (b & 32)
    m |= MOD_MOTION;
  return m;
}

static uint16_t mouse_button(int b) {
  switch (b & MOUSE_BUTTON_MASK) {
  case MOUSE_BUTTON_LEFT:
    if (b & MOUSE_WHEEL_BIT) {
      return KEY_MOUSE_WHEEL_UP;
    } else {
      return KEY_MOUSE_LEFT;
    }
  case MOUSE_BUTTON_MIDDLE:
    if (b & MOUSE_WHEEL_BIT) {
      return KEY_MOUSE_WHEEL_DOWN;
    } else {
      return KEY_MOUSE_MIDDLE;
    }
  case MOUSE_BUTTON_RIGHT:
    return KEY_MOUSE_RIGHT;
  case MOUSE_BUTTON_RELEASE:
    return KEY_MOUSE_RELEASE;
  default:
    return KEY_MOUSE_LEFT;
  }
}

static int parse_mouse_vt200(struct InputState *st, struct InputEvent *ev) {
  /* \x1b[M + 3 bytes = 6 total */
  if (st->len < 6)
    return PARSE_NEED_MORE;
  if (st->buf[0] != '\x1b' || st->buf[1] != '[' || st->buf[2] != 'M')
    return PARSE_ERR;

  int b = st->buf[3] - 0x20;
  ev->type = EVENT_MOUSE;
  ev->key = mouse_button(b);
  ev->mod = mouse_mods(b);
  if (ev->key == KEY_MOUSE_RELEASE)
    ev->mod |= MOD_RELEASE;
  ev->x = ((uint8_t)st->buf[4]) - 0x21;
  ev->y = ((uint8_t)st->buf[5]) - 0x21;

  shift(st, 6);
  return PARSE_OK;
}

static int parse_mouse_sgr(struct InputState *st, struct InputEvent *ev) {
  /* \x1b[< btn ; x ; y {M|m} */
  if (st->len < 3)
    return PARSE_NEED_MORE;
  if (st->buf[0] != '\x1b' || st->buf[1] != '[' || st->buf[2] != '<')
    return PARSE_ERR;

  int num[3] = {-1, -1, -1};
  int ni = 0;
  int cur = -1;
  char trail = ' ';
  int i = 3;

  while (i < st->len && ni < 3) {
    char c = st->buf[i];
    if (c >= '0' && c <= '9') {
      if (cur == -1)
        cur = 0;
      cur = cur * 10 + (c - '0');
    } else if (cur != -1 &&
               ((ni < 2 && c == ';') || (ni == 2 && (c == 'm' || c == 'M')))) {
      num[ni++] = cur;
      cur = -1;
      trail = c;
    } else {
      return PARSE_ERR;
    }
    i++;
  }

  if (num[2] == -1)
    return PARSE_NEED_MORE;

  ev->type = EVENT_MOUSE;
  ev->key = mouse_button(num[0]);
  ev->mod = mouse_mods(num[0]);
  if (trail == 'm')
    ev->mod |= MOD_RELEASE;
  ev->x = (num[1] - 1 < 0) ? 0 : num[1] - 1;
  ev->y = (num[2] - 1 < 0) ? 0 : num[2] - 1;

  shift(st, i);
  return PARSE_OK;
}

static int parse_mouse_urxvt(struct InputState *st, struct InputEvent *ev) {
  /* \x1b[ btn ; x ; y M  (no '<' prefix, digits start at buf[2]) */
  if (st->len < 3)
    return PARSE_NEED_MORE;
  if (st->buf[0] != '\x1b' || st->buf[1] != '[')
    return PARSE_ERR;
  /* must start with a digit at buf[2] */
  if (st->buf[2] < '0' || st->buf[2] > '9')
    return PARSE_ERR;

  int num[3] = {-1, -1, -1};
  int ni = 0;
  int cur = -1;
  int i = 2;

  while (i < st->len && ni < 3) {
    char c = st->buf[i];
    if (c >= '0' && c <= '9') {
      if (cur == -1)
        cur = 0;
      cur = cur * 10 + (c - '0');
    } else if (cur != -1 && ((ni < 2 && c == ';') || (ni == 2 && c == 'M'))) {
      num[ni++] = cur;
      cur = -1;
    } else {
      return PARSE_ERR;
    }
    i++;
  }

  if (num[2] == -1)
    return PARSE_NEED_MORE;

  int b = num[0] - 0x20;
  ev->type = EVENT_MOUSE;
  ev->key = mouse_button(b);
  ev->mod = mouse_mods(b);
  if (ev->key == KEY_MOUSE_RELEASE)
    ev->mod |= MOD_RELEASE;
  ev->x = (num[1] - 1 < 0) ? 0 : num[1] - 1;
  ev->y = (num[2] - 1 < 0) ? 0 : num[2] - 1;

  shift(st, i);
  return PARSE_OK;
}

static int parse_mouse(struct InputState *st, struct InputEvent *ev) {
  if (st->len < 2)
    return PARSE_NEED_MORE;
  if (st->buf[0] != '\x1b' || st->buf[1] != '[')
    return PARSE_ERR;
  if (st->len < 3)
    return PARSE_NEED_MORE;

  int rv;
  if (st->buf[2] == 'M') {
    rv = parse_mouse_vt200(st, ev);
  } else if (st->buf[2] == '<') {
    rv = parse_mouse_sgr(st, ev);
  } else if (st->buf[2] >= '0' && st->buf[2] <= '9') {
    rv = parse_mouse_urxvt(st, ev);
  } else {
    rv = PARSE_ERR;
  }
  return rv;
}

/* ── Kitty keyboard protocol (CSI u) ──────────────────────────────── */

static uint16_t kitty_key(int cp) {
  switch (cp) {
  case 9:
    return KEY_TAB;
  case 13:
    return KEY_ENTER;
  case 27:
    return KEY_ESC;
  case 127:
    return KEY_BACKSPACE;
  case 57344:
    return KEY_ESC;
  case 57345:
    return KEY_ENTER;
  case 57346:
    return KEY_TAB;
  case 57347:
    return KEY_BACKSPACE;
  case 57348:
    return KEY_INSERT;
  case 57349:
    return KEY_DELETE;
  case 57350:
    return KEY_ARROW_LEFT;
  case 57351:
    return KEY_ARROW_RIGHT;
  case 57352:
    return KEY_ARROW_UP;
  case 57353:
    return KEY_ARROW_DOWN;
  case 57354:
    return KEY_PGUP;
  case 57355:
    return KEY_PGDN;
  case 57356:
    return KEY_HOME;
  case 57357:
    return KEY_END;
  case 57376:
    return KEY_F1;
  case 57377:
    return KEY_F2;
  case 57378:
    return KEY_F3;
  case 57379:
    return KEY_F4;
  case 57380:
    return KEY_F5;
  case 57381:
    return KEY_F6;
  case 57382:
    return KEY_F7;
  case 57383:
    return KEY_F8;
  case 57384:
    return KEY_F9;
  case 57385:
    return KEY_F10;
  case 57386:
    return KEY_F11;
  case 57387:
    return KEY_F12;
  case 57399:
    return KEY_NUMPAD_0;
  case 57400:
    return KEY_NUMPAD_1;
  case 57401:
    return KEY_NUMPAD_2;
  case 57402:
    return KEY_NUMPAD_3;
  case 57403:
    return KEY_NUMPAD_4;
  case 57404:
    return KEY_NUMPAD_5;
  case 57405:
    return KEY_NUMPAD_6;
  case 57406:
    return KEY_NUMPAD_7;
  case 57407:
    return KEY_NUMPAD_8;
  case 57408:
    return KEY_NUMPAD_9;
  case 57409:
    return KEY_NUMPAD_DECIMAL;
  case 57410:
    return KEY_NUMPAD_DIVIDE;
  case 57411:
    return KEY_NUMPAD_MULTIPLY;
  case 57412:
    return KEY_NUMPAD_SUBTRACT;
  case 57413:
    return KEY_NUMPAD_ADD;
  case 57414:
    return KEY_NUMPAD_ENTER;
  case 57415:
    return KEY_NUMPAD_EQUAL;
  case 57441:
    return KEY_SHIFT_LEFT;
  case 57442:
    return KEY_CONTROL_LEFT;
  case 57443:
    return KEY_ALT_LEFT;
  case 57444:
    return KEY_SUPER_LEFT;
  case 57445:
    return KEY_HYPER_LEFT;
  case 57446:
    return KEY_META_LEFT;
  case 57447:
    return KEY_SHIFT_RIGHT;
  case 57448:
    return KEY_CONTROL_RIGHT;
  case 57449:
    return KEY_ALT_RIGHT;
  case 57450:
    return KEY_SUPER_RIGHT;
  case 57451:
    return KEY_HYPER_RIGHT;
  case 57452:
    return KEY_META_RIGHT;
  case 57358:
    return KEY_CAPS_LOCK;
  case 57359:
    return KEY_NUM_LOCK;
  case 57360:
    return KEY_SCROLL_LOCK;
  default:
    return 0;
  }
}

static uint8_t kitty_mod(int mod) {
  if (mod <= 1)
    return 0;
  int bits = mod - 1;
  uint8_t out = 0;
  if (bits & 1)
    out |= MOD_SHIFT;
  if (bits & 2)
    out |= MOD_ALT;
  if (bits & 4)
    out |= MOD_CTRL;
  return out;
}

static int parse_csi_u(struct InputState *st, struct InputEvent *ev) {
  /* CSI key:shifted:base ; mod:action ; text u */
  if (st->len < 2)
    return PARSE_NEED_MORE;
  if (st->buf[0] != '\x1b' || st->buf[1] != '[')
    return PARSE_ERR;
  if (st->len < 4)
    return PARSE_NEED_MORE;
  if (st->buf[2] < '0' && st->buf[2] != ';')
    return PARSE_ERR;
  if (st->buf[2] > '9' && st->buf[2] != ';')
    return PARSE_ERR;

  /* fields[param][sub]: up to 3 params, up to 3 sub-fields each */
  int fields[3][3];
  for (int p = 0; p < 3; p++)
    for (int s = 0; s < 3; s++)
      fields[p][s] = -1;

  int param = 0;
  int sub = 0;
  int cur = -1;
  int i = 2;
  int done = 0;
  int text_start = -1;
  int text_end = -1;

  while (i < st->len && !done) {
    char c = st->buf[i];
    if (c >= '0' && c <= '9') {
      if (cur == -1)
        cur = 0;
      cur = cur * 10 + (c - '0');
    } else if (c == ':') {
      if (param < 3 && sub < 3)
        fields[param][sub] = cur;
      cur = -1;
      sub++;
      if (param == 2 && text_start == -1)
        text_start = i + 1;
    } else if (c == ';') {
      if (param < 3 && sub < 3)
        fields[param][sub] = cur;
      cur = -1;
      param++;
      sub = 0;
    } else if (c == 'u') {
      if (param < 3 && sub < 3)
        fields[param][sub] = cur;
      if (param == 2 && text_start != -1) {
        text_end = i;
      }
      done = 1;
    } else {
      return PARSE_ERR;
    }
    i++;
  }

  if (!done)
    return PARSE_NEED_MORE;

  int cp = fields[0][0];
  int mod = fields[1][0];

  if (cp == -1)
    cp = 0;
  if (mod == -1)
    mod = 1;

  ev->type = EVENT_KEY;
  ev->mod = kitty_mod(mod);

  uint16_t key = kitty_key(cp);
  if (key) {
    ev->key = key;
  } else {
    ev->ch = (uint32_t)cp;
  }

  /* action */
  if (fields[1][1] > 0) {
    ev->action = (uint8_t)fields[1][1];
  }

  /* alternate keys */
  if (fields[0][1] > 0) {
    ev->shifted = (uint32_t)fields[0][1];
  }
  if (fields[0][2] > 0) {
    ev->base = (uint32_t)fields[0][2];
  }

  /* associated text: decode codepoints from param 2 */
  if (param >= 2 && fields[2][0] >= 0) {
    /* find the start of param 2 by counting semicolons */
    int off = 2;
    int sc = 0;
    for (int j = 2; j < i; j++) {
      if (st->buf[j] == ';') {
        sc++;
        if (sc == 2) {
          off = j + 1;
          break;
        }
      }
    }
    /* parse colon-separated codepoints */
    int tc = 0;
    int val = -1;
    for (int j = off; j < i - 1 && tc < MAX_TEXT_CODEPOINTS; j++) {
      char c = st->buf[j];
      if (c >= '0' && c <= '9') {
        if (val == -1)
          val = 0;
        val = val * 10 + (c - '0');
      } else if (c == ':') {
        if (val >= 0)
          ev->text[tc++] = (uint32_t)val;
        val = -1;
      }
    }
    if (val >= 0 && tc < MAX_TEXT_CODEPOINTS)
      ev->text[tc++] = (uint32_t)val;
    ev->text_len = (uint8_t)tc;
  }

  shift(st, i);
  return PARSE_OK;
}

static uint16_t csi_legacy_key(char term, int number) {
  switch (term) {
  case 'A':
    return KEY_ARROW_UP;
  case 'B':
    return KEY_ARROW_DOWN;
  case 'C':
    return KEY_ARROW_RIGHT;
  case 'D':
    return KEY_ARROW_LEFT;
  case 'H':
    return KEY_HOME;
  case 'F':
    return KEY_END;
  case 'P':
    return KEY_F1;
  case 'Q':
    return KEY_F2;
  case 'S':
    return KEY_F4;
  case '~':
    switch (number) {
    case 2:
      return KEY_INSERT;
    case 3:
      return KEY_DELETE;
    case 5:
      return KEY_PGUP;
    case 6:
      return KEY_PGDN;
    case 7:
      return KEY_HOME;
    case 8:
      return KEY_END;
    case 11:
      return KEY_F1;
    case 12:
      return KEY_F2;
    case 13:
      return KEY_F3;
    case 14:
      return KEY_F4;
    case 15:
      return KEY_F5;
    case 17:
      return KEY_F6;
    case 18:
      return KEY_F7;
    case 19:
      return KEY_F8;
    case 20:
      return KEY_F9;
    case 21:
      return KEY_F10;
    case 23:
      return KEY_F11;
    case 24:
      return KEY_F12;
    default:
      return 0;
    }
  default:
    return 0;
  }
}

/* Parse DSR cursor position response: CSI row ; col R */
static int parse_cursor(struct InputState *st, struct InputEvent *ev) {
  if (st->len < 2)
    return PARSE_NEED_MORE;
  if (st->buf[0] != '\x1b' || st->buf[1] != '[')
    return PARSE_ERR;
  if (st->len < 3)
    return PARSE_NEED_MORE;

  int row = 0;
  int col = 0;
  int param = 0;
  int i = 2;

  while (i < st->len) {
    char c = st->buf[i];
    if (c >= '0' && c <= '9') {
      if (param == 0) {
        row = row * 10 + (c - '0');
      } else {
        col = col * 10 + (c - '0');
      }
    } else if (c == ';') {
      if (param > 0)
        return PARSE_ERR;
      param++;
    } else if (c == 'R') {
      if (param != 1)
        return PARSE_ERR;
      i++;
      ev->type = EVENT_CURSOR;
      ev->y = row;
      ev->x = col;
      shift(st, i);
      return PARSE_OK;
    } else {
      return PARSE_ERR;
    }
    i++;
  }
  return PARSE_NEED_MORE;
}

/* Parse Kitty-enhanced legacy CSI sequences (non-u terminators).
 * Format: CSI [number] [; mod[:action]] terminator
 * Handles A-D, F, H, P, Q, S, ~ terminators with optional :action */
static int parse_csi_legacy(struct InputState *st, struct InputEvent *ev) {
  if (st->len < 2)
    return PARSE_NEED_MORE;
  if (st->buf[0] != '\x1b' || st->buf[1] != '[')
    return PARSE_ERR;
  if (st->len < 3)
    return PARSE_NEED_MORE;

  int number = -1;
  int mod = -1;
  int action = -1;
  int param = 0;
  int sub = 0;
  int i = 2;
  int cur = -1;
  char term = 0;

  while (i < st->len) {
    char c = st->buf[i];
    if (c >= '0' && c <= '9') {
      if (cur == -1)
        cur = 0;
      cur = cur * 10 + (c - '0');
    } else if (c == ';') {
      if (param == 0)
        number = cur;
      else if (param == 1 && sub == 0)
        mod = cur;
      cur = -1;
      param++;
      sub = 0;
    } else if (c == ':') {
      if (param == 1 && sub == 0)
        mod = cur;
      cur = -1;
      sub++;
    } else if ((c >= 'A' && c <= 'D') || c == 'F' || c == 'H' || c == 'P' ||
               c == 'Q' || c == 'S' || c == '~') {
      if (param == 0)
        number = cur;
      else if (param == 1 && sub == 0)
        mod = cur;
      else if (param == 1 && sub > 0)
        action = cur;
      term = c;
      i++;
      break;
    } else {
      return PARSE_ERR;
    }
    i++;
  }

  if (term == 0)
    return PARSE_NEED_MORE;

  uint16_t key = csi_legacy_key(term, number > 0 ? number : 0);
  if (key == 0)
    return PARSE_ERR;

  ev->type = EVENT_KEY;
  ev->key = key;
  ev->mod = kitty_mod(mod > 0 ? mod : 1);
  if (action > 0)
    ev->action = (uint8_t)action;

  shift(st, i);
  return PARSE_OK;
}

/* ── Capability query responses (terminfo-spec section 9) ─────────── */

/* Update a capability flag from a probe response: probe evidence sets
 * the confirmed bit and overrides whatever the terminfo entry or
 * environment granted. One generation bump per logical update. */
static void ti_confirm(struct InputState *st, uint32_t bit, int on) {
  struct TermInfo *ti = st->ti;
  uint32_t flags = on ? (ti->flags | bit) : (ti->flags & ~bit);
  uint32_t confirmed = ti->confirmed | bit;
  if (flags == ti->flags && confirmed == ti->confirmed)
    return;
  ti->flags = flags;
  ti->confirmed = confirmed;
  ti->generation++;
}

static void ti_theme(struct InputState *st, uint32_t bit, uint32_t *slot,
                     uint32_t color) {
  struct TermInfo *ti = st->ti;
  if ((ti->flags & bit) && (ti->confirmed & bit) && *slot == color)
    return;
  *slot = color;
  ti->flags |= bit;
  ti->confirmed |= bit;
  ti->generation++;
}

static int hexval(char c) {
  if (c >= '0' && c <= '9')
    return c - '0';
  if (c >= 'a' && c <= 'f')
    return c - 'a' + 10;
  if (c >= 'A' && c <= 'F')
    return c - 'A' + 10;
  return -1;
}

/* Scale a 1-4 hex digit channel to 8-bit (rounded). */
static int color_channel(const char *s, int n, uint32_t *out) {
  if (n < 1 || n > 4)
    return 0;
  int v = 0;
  for (int i = 0; i < n; i++) {
    int h = hexval(s[i]);
    if (h < 0)
      return 0;
    v = v * 16 + h;
  }
  int max = (1 << (4 * n)) - 1;
  *out = (uint32_t)((v * 255 + max / 2) / max);
  return 1;
}

/* Parse an OSC color payload: X11 "rgb:R/G/B" (1-4 hex digits per
 * channel, "rgba:" alpha ignored) or "#"-hash with equal-width
 * channels. Returns 0 when no color is recognized. */
static int parse_color_spec(const char *s, int len, uint32_t *out) {
  if (len >= 4 && s[0] == 'r' && s[1] == 'g' && s[2] == 'b') {
    int i = 3;
    if (i < len && s[i] == 'a')
      i++;
    if (i >= len || s[i] != ':')
      return 0;
    i++;
    uint32_t ch[3];
    for (int c = 0; c < 3; c++) {
      int start = i;
      while (i < len && hexval(s[i]) >= 0)
        i++;
      if (!color_channel(s + start, i - start, &ch[c]))
        return 0;
      if (c < 2) {
        if (i >= len || s[i] != '/')
          return 0;
        i++;
      }
    }
    *out = (ch[0] << 16) | (ch[1] << 8) | ch[2];
    return 1;
  }
  if (len >= 4 && s[0] == '#') {
    int n = 0;
    while (1 + n < len && hexval(s[1 + n]) >= 0)
      n++;
    if (n % 3 != 0)
      return 0;
    int w = n / 3;
    uint32_t ch[3];
    for (int c = 0; c < 3; c++) {
      if (!color_channel(s + 1 + c * w, w, &ch[c]))
        return 0;
    }
    *out = (ch[0] << 16) | (ch[1] << 8) | ch[2];
    return 1;
  }
  return 0;
}

static int payload_contains(const char *s, int len, const char *needle) {
  int n = (int)strlen(needle);
  for (int i = 0; i + n <= len; i++) {
    int j = 0;
    while (j < n && s[i + j] == needle[j])
      j++;
    if (j == n)
      return 1;
  }
  return 0;
}

/* Find a BEL or ST terminator from `start`. Returns the index one past
 * the terminator, 0 when more bytes are needed, or -1 when the
 * response exceeds MAX_RESPONSE. */
static int find_st(struct InputState *st, int start) {
  for (int i = start; i < st->len; i++) {
    char c = st->buf[i];
    if (c == '\x07')
      return i + 1;
    if (c == '\x1b') {
      if (i + 1 >= st->len)
        return 0;
      if (st->buf[i + 1] == '\\')
        return i + 2;
      return -1;
    }
    if (i - start > MAX_RESPONSE)
      return -1;
  }
  return 0;
}

/* OSC 21 payload: ";"-separated key=value pairs. */
static void osc21_apply(struct InputState *st, const char *s, int len) {
  ti_confirm(st, TERMINFO_KITTY_COLOR, 1);
  int i = 0;
  while (i < len) {
    int start = i;
    while (i < len && s[i] != ';')
      i++;
    int eq = start;
    while (eq < i && s[eq] != '=')
      eq++;
    if (eq < i) {
      const char *key = s + start;
      int klen = eq - start;
      const char *val = s + eq + 1;
      int vlen = i - eq - 1;
      uint32_t color;
      if (vlen > 0 && parse_color_spec(val, vlen, &color)) {
        if (klen == 10 && payload_contains(key, klen, "foreground")) {
          ti_theme(st, TERMINFO_THEME_FG, &st->ti->theme_fg, color);
        } else if (klen == 10 && payload_contains(key, klen, "background")) {
          ti_theme(st, TERMINFO_THEME_BG, &st->ti->theme_bg, color);
        } else if (klen == 6 && payload_contains(key, klen, "cursor")) {
          ti_theme(st, TERMINFO_THEME_CURSOR, &st->ti->theme_cursor, color);
        }
      }
    }
    if (i < len)
      i++;
  }
}

/* OSC 10/11/12 theme color reports, OSC 21 kitty color, OSC 22 kitty
 * pointer shape. Other OSC numbers are not consumed. */
static int parse_osc_response(struct InputState *st) {
  int i = 2;
  int num = -1;
  while (i < st->len && st->buf[i] >= '0' && st->buf[i] <= '9') {
    num = (num == -1 ? 0 : num) * 10 + (st->buf[i] - '0');
    if (num > 22)
      return PARSE_ERR;
    i++;
  }
  if (i >= st->len)
    return PARSE_NEED_MORE;
  if (st->buf[i] != ';')
    return PARSE_ERR;
  if (num != 10 && num != 11 && num != 12 && num != 21 && num != 22)
    return PARSE_ERR;
  i++;

  int end = find_st(st, i);
  if (end == 0)
    return PARSE_NEED_MORE;
  if (end < 0)
    return PARSE_ERR;

  int plen = end - i;
  if (st->buf[end - 1] == '\x07') {
    plen -= 1;
  } else {
    plen -= 2;
  }
  const char *payload = st->buf + i;

  uint32_t color;
  switch (num) {
  case 10:
    if (parse_color_spec(payload, plen, &color))
      ti_theme(st, TERMINFO_THEME_FG, &st->ti->theme_fg, color);
    break;
  case 11:
    if (parse_color_spec(payload, plen, &color))
      ti_theme(st, TERMINFO_THEME_BG, &st->ti->theme_bg, color);
    break;
  case 12:
    if (parse_color_spec(payload, plen, &color))
      ti_theme(st, TERMINFO_THEME_CURSOR, &st->ti->theme_cursor, color);
    break;
  case 21:
    osc21_apply(st, payload, plen);
    break;
  case 22:
    ti_confirm(st, TERMINFO_POINTER_SHAPE, 1);
    break;
  }

  shift(st, end);
  return PARSE_OK;
}

/* XTGETTCAP reply: DCS 1 + r … ST (valid) or DCS 0 + r … ST (invalid).
 * We only query RGB (524742) and Tc (5463), so a valid reply naming
 * either confirms truecolor; an invalid reply denies it. */
static int parse_dcs_response(struct InputState *st) {
  if (st->len < 5)
    return PARSE_NEED_MORE;
  char ok = st->buf[2];
  if ((ok != '0' && ok != '1') || st->buf[3] != '+' || st->buf[4] != 'r')
    return PARSE_ERR;

  int end = find_st(st, 5);
  if (end == 0)
    return PARSE_NEED_MORE;
  if (end < 0)
    return PARSE_ERR;

  const char *payload = st->buf + 5;
  int plen = end - 5 - (st->buf[end - 1] == '\x07' ? 1 : 2);
  if (ok == '1') {
    if (payload_contains(payload, plen, "524742") ||
        payload_contains(payload, plen, "5463")) {
      ti_confirm(st, TERMINFO_TRUECOLOR, 1);
    }
  } else {
    ti_confirm(st, TERMINFO_TRUECOLOR, 0);
  }

  shift(st, end);
  return PARSE_OK;
}

/* Kitty graphics reply: APC _G … ST with ";OK" on success. */
static int parse_apc_response(struct InputState *st) {
  if (st->len < 3)
    return PARSE_NEED_MORE;
  if (st->buf[2] != 'G')
    return PARSE_ERR;

  int end = find_st(st, 3);
  if (end == 0)
    return PARSE_NEED_MORE;
  if (end < 0)
    return PARSE_ERR;

  const char *payload = st->buf + 3;
  int plen = end - 3 - (st->buf[end - 1] == '\x07' ? 1 : 2);
  ti_confirm(st, TERMINFO_KITTY_GRAPHICS,
             payload_contains(payload, plen, ";OK"));

  shift(st, end);
  return PARSE_OK;
}

/* CSI ? … replies: kitty keyboard flags (final 'u'), DECRPM (final 'y'
 * with '$' intermediate), DA1 device attributes (final 'c'). */
static int parse_csi_private(struct InputState *st) {
  if (st->len < 3)
    return PARSE_NEED_MORE;
  if (st->buf[2] != '?')
    return PARSE_ERR;

  int nums[4] = {-1, -1, -1, -1};
  int ni = 0;
  int cur = -1;
  char intermediate = 0;
  int i = 3;

  while (i < st->len) {
    char c = st->buf[i];
    if (c >= '0' && c <= '9') {
      if (cur == -1)
        cur = 0;
      cur = cur * 10 + (c - '0');
    } else if (c == ';' || c == ':') {
      if (ni < 4)
        nums[ni++] = cur;
      cur = -1;
    } else if (c >= 0x20 && c <= 0x2f) {
      intermediate = c;
    } else if (c >= 0x40 && c <= 0x7e) {
      if (ni < 4)
        nums[ni++] = cur;
      i++;

      if (c == 'u' && intermediate == 0) {
        ti_confirm(st, TERMINFO_KITTY_KEYBOARD, 1);
      } else if (c == 'y' && intermediate == '$') {
        if (nums[0] == 2026 && ni >= 2) {
          int v = nums[1];
          ti_confirm(st, TERMINFO_SYNC, v == 1 || v == 2 || v == 3);
        }
        /* other modes: consumed silently */
      } else if (c == 'c' && intermediate == 0) {
        if (!(st->ti->confirmed & TERMINFO_DA1)) {
          st->ti->confirmed |= TERMINFO_DA1;
          st->ti->generation++;
        }
      } else {
        return PARSE_ERR;
      }

      shift(st, i);
      return PARSE_OK;
    } else {
      return PARSE_ERR;
    }
    i++;
  }
  return PARSE_NEED_MORE;
}

static int parse_response(struct InputState *st) {
  if (st->len < 2)
    return PARSE_NEED_MORE;
  switch (st->buf[1]) {
  case ']':
    return parse_osc_response(st);
  case 'P':
    return parse_dcs_response(st);
  case '_':
    return parse_apc_response(st);
  case '[':
    return parse_csi_private(st);
  default:
    return PARSE_ERR;
  }
}

/* ── Cap table (xterm defaults) ───────────────────────────────────── */

struct CapEntry {
  const char *seq;
  uint16_t key;
  uint8_t mod;
};

static const struct CapEntry base_caps[] = {
    /* xterm base keys (no modifiers) */
    {"\x1bOP", KEY_F1, 0},
    {"\x1bOQ", KEY_F2, 0},
    {"\x1bOR", KEY_F3, 0},
    {"\x1bOS", KEY_F4, 0},
    {"\x1b[15~", KEY_F5, 0},
    {"\x1b[17~", KEY_F6, 0},
    {"\x1b[18~", KEY_F7, 0},
    {"\x1b[19~", KEY_F8, 0},
    {"\x1b[20~", KEY_F9, 0},
    {"\x1b[21~", KEY_F10, 0},
    {"\x1b[23~", KEY_F11, 0},
    {"\x1b[24~", KEY_F12, 0},
    {"\x1b[2~", KEY_INSERT, 0},
    {"\x1b[3~", KEY_DELETE, 0},
    {"\x1bOH", KEY_HOME, 0},
    {"\x1bOF", KEY_END, 0},
    {"\x1b[5~", KEY_PGUP, 0},
    {"\x1b[6~", KEY_PGDN, 0},
    {"\x1bOA", KEY_ARROW_UP, 0},
    {"\x1bOB", KEY_ARROW_DOWN, 0},
    {"\x1bOD", KEY_ARROW_LEFT, 0},
    {"\x1bOC", KEY_ARROW_RIGHT, 0},
    {"\x1b[Z", KEY_BACKTAB, 0},
    /* alternate arrow sequences (CSI, used by many terminals) */
    {"\x1b[A", KEY_ARROW_UP, 0},
    {"\x1b[B", KEY_ARROW_DOWN, 0},
    {"\x1b[D", KEY_ARROW_LEFT, 0},
    {"\x1b[C", KEY_ARROW_RIGHT, 0},
    /* alternate home/end (CSI ~ style) */
    {"\x1b[1~", KEY_HOME, 0},
    {"\x1b[4~", KEY_END, 0},
    {"\x1b[H", KEY_HOME, 0},
    {"\x1b[F", KEY_END, 0},
    {0, 0, 0},
};

/* xterm modifier combos — modifier code: 2=Shift 3=Alt 4=Alt+Shift
 * 5=Ctrl 6=Ctrl+Shift 7=Ctrl+Alt 8=Ctrl+Alt+Shift */
static const struct CapEntry mod_caps[] = {
    /* arrows */
    {"\x1b[1;2A", KEY_ARROW_UP, MOD_SHIFT},
    {"\x1b[1;3A", KEY_ARROW_UP, MOD_ALT},
    {"\x1b[1;4A", KEY_ARROW_UP, MOD_ALT | MOD_SHIFT},
    {"\x1b[1;5A", KEY_ARROW_UP, MOD_CTRL},
    {"\x1b[1;6A", KEY_ARROW_UP, MOD_CTRL | MOD_SHIFT},
    {"\x1b[1;7A", KEY_ARROW_UP, MOD_CTRL | MOD_ALT},
    {"\x1b[1;8A", KEY_ARROW_UP, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {"\x1b[1;2B", KEY_ARROW_DOWN, MOD_SHIFT},
    {"\x1b[1;3B", KEY_ARROW_DOWN, MOD_ALT},
    {"\x1b[1;4B", KEY_ARROW_DOWN, MOD_ALT | MOD_SHIFT},
    {"\x1b[1;5B", KEY_ARROW_DOWN, MOD_CTRL},
    {"\x1b[1;6B", KEY_ARROW_DOWN, MOD_CTRL | MOD_SHIFT},
    {"\x1b[1;7B", KEY_ARROW_DOWN, MOD_CTRL | MOD_ALT},
    {"\x1b[1;8B", KEY_ARROW_DOWN, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {"\x1b[1;2C", KEY_ARROW_RIGHT, MOD_SHIFT},
    {"\x1b[1;3C", KEY_ARROW_RIGHT, MOD_ALT},
    {"\x1b[1;4C", KEY_ARROW_RIGHT, MOD_ALT | MOD_SHIFT},
    {"\x1b[1;5C", KEY_ARROW_RIGHT, MOD_CTRL},
    {"\x1b[1;6C", KEY_ARROW_RIGHT, MOD_CTRL | MOD_SHIFT},
    {"\x1b[1;7C", KEY_ARROW_RIGHT, MOD_CTRL | MOD_ALT},
    {"\x1b[1;8C", KEY_ARROW_RIGHT, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {"\x1b[1;2D", KEY_ARROW_LEFT, MOD_SHIFT},
    {"\x1b[1;3D", KEY_ARROW_LEFT, MOD_ALT},
    {"\x1b[1;4D", KEY_ARROW_LEFT, MOD_ALT | MOD_SHIFT},
    {"\x1b[1;5D", KEY_ARROW_LEFT, MOD_CTRL},
    {"\x1b[1;6D", KEY_ARROW_LEFT, MOD_CTRL | MOD_SHIFT},
    {"\x1b[1;7D", KEY_ARROW_LEFT, MOD_CTRL | MOD_ALT},
    {"\x1b[1;8D", KEY_ARROW_LEFT, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    /* home/end */
    {"\x1b[1;2H", KEY_HOME, MOD_SHIFT},
    {"\x1b[1;3H", KEY_HOME, MOD_ALT},
    {"\x1b[1;4H", KEY_HOME, MOD_ALT | MOD_SHIFT},
    {"\x1b[1;5H", KEY_HOME, MOD_CTRL},
    {"\x1b[1;6H", KEY_HOME, MOD_CTRL | MOD_SHIFT},
    {"\x1b[1;7H", KEY_HOME, MOD_CTRL | MOD_ALT},
    {"\x1b[1;8H", KEY_HOME, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {"\x1b[1;2F", KEY_END, MOD_SHIFT},
    {"\x1b[1;3F", KEY_END, MOD_ALT},
    {"\x1b[1;4F", KEY_END, MOD_ALT | MOD_SHIFT},
    {"\x1b[1;5F", KEY_END, MOD_CTRL},
    {"\x1b[1;6F", KEY_END, MOD_CTRL | MOD_SHIFT},
    {"\x1b[1;7F", KEY_END, MOD_CTRL | MOD_ALT},
    {"\x1b[1;8F", KEY_END, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    /* insert */
    {"\x1b[2;2~", KEY_INSERT, MOD_SHIFT},
    {"\x1b[2;3~", KEY_INSERT, MOD_ALT},
    {"\x1b[2;4~", KEY_INSERT, MOD_ALT | MOD_SHIFT},
    {"\x1b[2;5~", KEY_INSERT, MOD_CTRL},
    {"\x1b[2;6~", KEY_INSERT, MOD_CTRL | MOD_SHIFT},
    {"\x1b[2;7~", KEY_INSERT, MOD_CTRL | MOD_ALT},
    {"\x1b[2;8~", KEY_INSERT, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    /* delete */
    {"\x1b[3;2~", KEY_DELETE, MOD_SHIFT},
    {"\x1b[3;3~", KEY_DELETE, MOD_ALT},
    {"\x1b[3;4~", KEY_DELETE, MOD_ALT | MOD_SHIFT},
    {"\x1b[3;5~", KEY_DELETE, MOD_CTRL},
    {"\x1b[3;6~", KEY_DELETE, MOD_CTRL | MOD_SHIFT},
    {"\x1b[3;7~", KEY_DELETE, MOD_CTRL | MOD_ALT},
    {"\x1b[3;8~", KEY_DELETE, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    /* pgup */
    {"\x1b[5;2~", KEY_PGUP, MOD_SHIFT},
    {"\x1b[5;3~", KEY_PGUP, MOD_ALT},
    {"\x1b[5;4~", KEY_PGUP, MOD_ALT | MOD_SHIFT},
    {"\x1b[5;5~", KEY_PGUP, MOD_CTRL},
    {"\x1b[5;6~", KEY_PGUP, MOD_CTRL | MOD_SHIFT},
    {"\x1b[5;7~", KEY_PGUP, MOD_CTRL | MOD_ALT},
    {"\x1b[5;8~", KEY_PGUP, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    /* pgdn */
    {"\x1b[6;2~", KEY_PGDN, MOD_SHIFT},
    {"\x1b[6;3~", KEY_PGDN, MOD_ALT},
    {"\x1b[6;4~", KEY_PGDN, MOD_ALT | MOD_SHIFT},
    {"\x1b[6;5~", KEY_PGDN, MOD_CTRL},
    {"\x1b[6;6~", KEY_PGDN, MOD_CTRL | MOD_SHIFT},
    {"\x1b[6;7~", KEY_PGDN, MOD_CTRL | MOD_ALT},
    {"\x1b[6;8~", KEY_PGDN, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    /* F1–F4 */
    {"\x1b[1;2P", KEY_F1, MOD_SHIFT},
    {"\x1b[1;3P", KEY_F1, MOD_ALT},
    {"\x1b[1;4P", KEY_F1, MOD_ALT | MOD_SHIFT},
    {"\x1b[1;5P", KEY_F1, MOD_CTRL},
    {"\x1b[1;6P", KEY_F1, MOD_CTRL | MOD_SHIFT},
    {"\x1b[1;7P", KEY_F1, MOD_CTRL | MOD_ALT},
    {"\x1b[1;8P", KEY_F1, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {"\x1b[1;2Q", KEY_F2, MOD_SHIFT},
    {"\x1b[1;3Q", KEY_F2, MOD_ALT},
    {"\x1b[1;4Q", KEY_F2, MOD_ALT | MOD_SHIFT},
    {"\x1b[1;5Q", KEY_F2, MOD_CTRL},
    {"\x1b[1;6Q", KEY_F2, MOD_CTRL | MOD_SHIFT},
    {"\x1b[1;7Q", KEY_F2, MOD_CTRL | MOD_ALT},
    {"\x1b[1;8Q", KEY_F2, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {"\x1b[1;2R", KEY_F3, MOD_SHIFT},
    {"\x1b[1;3R", KEY_F3, MOD_ALT},
    {"\x1b[1;4R", KEY_F3, MOD_ALT | MOD_SHIFT},
    {"\x1b[1;5R", KEY_F3, MOD_CTRL},
    {"\x1b[1;6R", KEY_F3, MOD_CTRL | MOD_SHIFT},
    {"\x1b[1;7R", KEY_F3, MOD_CTRL | MOD_ALT},
    {"\x1b[1;8R", KEY_F3, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {"\x1b[1;2S", KEY_F4, MOD_SHIFT},
    {"\x1b[1;3S", KEY_F4, MOD_ALT},
    {"\x1b[1;4S", KEY_F4, MOD_ALT | MOD_SHIFT},
    {"\x1b[1;5S", KEY_F4, MOD_CTRL},
    {"\x1b[1;6S", KEY_F4, MOD_CTRL | MOD_SHIFT},
    {"\x1b[1;7S", KEY_F4, MOD_CTRL | MOD_ALT},
    {"\x1b[1;8S", KEY_F4, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    /* F5–F12 */
    {"\x1b[15;2~", KEY_F5, MOD_SHIFT},
    {"\x1b[15;3~", KEY_F5, MOD_ALT},
    {"\x1b[15;4~", KEY_F5, MOD_ALT | MOD_SHIFT},
    {"\x1b[15;5~", KEY_F5, MOD_CTRL},
    {"\x1b[15;6~", KEY_F5, MOD_CTRL | MOD_SHIFT},
    {"\x1b[15;7~", KEY_F5, MOD_CTRL | MOD_ALT},
    {"\x1b[15;8~", KEY_F5, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {"\x1b[17;2~", KEY_F6, MOD_SHIFT},
    {"\x1b[17;3~", KEY_F6, MOD_ALT},
    {"\x1b[17;4~", KEY_F6, MOD_ALT | MOD_SHIFT},
    {"\x1b[17;5~", KEY_F6, MOD_CTRL},
    {"\x1b[17;6~", KEY_F6, MOD_CTRL | MOD_SHIFT},
    {"\x1b[17;7~", KEY_F6, MOD_CTRL | MOD_ALT},
    {"\x1b[17;8~", KEY_F6, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {"\x1b[18;2~", KEY_F7, MOD_SHIFT},
    {"\x1b[18;3~", KEY_F7, MOD_ALT},
    {"\x1b[18;4~", KEY_F7, MOD_ALT | MOD_SHIFT},
    {"\x1b[18;5~", KEY_F7, MOD_CTRL},
    {"\x1b[18;6~", KEY_F7, MOD_CTRL | MOD_SHIFT},
    {"\x1b[18;7~", KEY_F7, MOD_CTRL | MOD_ALT},
    {"\x1b[18;8~", KEY_F7, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {"\x1b[19;2~", KEY_F8, MOD_SHIFT},
    {"\x1b[19;3~", KEY_F8, MOD_ALT},
    {"\x1b[19;4~", KEY_F8, MOD_ALT | MOD_SHIFT},
    {"\x1b[19;5~", KEY_F8, MOD_CTRL},
    {"\x1b[19;6~", KEY_F8, MOD_CTRL | MOD_SHIFT},
    {"\x1b[19;7~", KEY_F8, MOD_CTRL | MOD_ALT},
    {"\x1b[19;8~", KEY_F8, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {"\x1b[20;2~", KEY_F9, MOD_SHIFT},
    {"\x1b[20;3~", KEY_F9, MOD_ALT},
    {"\x1b[20;4~", KEY_F9, MOD_ALT | MOD_SHIFT},
    {"\x1b[20;5~", KEY_F9, MOD_CTRL},
    {"\x1b[20;6~", KEY_F9, MOD_CTRL | MOD_SHIFT},
    {"\x1b[20;7~", KEY_F9, MOD_CTRL | MOD_ALT},
    {"\x1b[20;8~", KEY_F9, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {"\x1b[21;2~", KEY_F10, MOD_SHIFT},
    {"\x1b[21;3~", KEY_F10, MOD_ALT},
    {"\x1b[21;4~", KEY_F10, MOD_ALT | MOD_SHIFT},
    {"\x1b[21;5~", KEY_F10, MOD_CTRL},
    {"\x1b[21;6~", KEY_F10, MOD_CTRL | MOD_SHIFT},
    {"\x1b[21;7~", KEY_F10, MOD_CTRL | MOD_ALT},
    {"\x1b[21;8~", KEY_F10, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {"\x1b[23;2~", KEY_F11, MOD_SHIFT},
    {"\x1b[23;3~", KEY_F11, MOD_ALT},
    {"\x1b[23;4~", KEY_F11, MOD_ALT | MOD_SHIFT},
    {"\x1b[23;5~", KEY_F11, MOD_CTRL},
    {"\x1b[23;6~", KEY_F11, MOD_CTRL | MOD_SHIFT},
    {"\x1b[23;7~", KEY_F11, MOD_CTRL | MOD_ALT},
    {"\x1b[23;8~", KEY_F11, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {"\x1b[24;2~", KEY_F12, MOD_SHIFT},
    {"\x1b[24;3~", KEY_F12, MOD_ALT},
    {"\x1b[24;4~", KEY_F12, MOD_ALT | MOD_SHIFT},
    {"\x1b[24;5~", KEY_F12, MOD_CTRL},
    {"\x1b[24;6~", KEY_F12, MOD_CTRL | MOD_SHIFT},
    {"\x1b[24;7~", KEY_F12, MOD_CTRL | MOD_ALT},
    {"\x1b[24;8~", KEY_F12, MOD_CTRL | MOD_ALT | MOD_SHIFT},

    {0, 0, 0},
};

/* ── Public API ───────────────────────────────────────────────────── */

/* terminfo key_* string capability indices (ncurses Caps) mapped to
 * KEY_* codes. Indices verified against tic output. */
struct KeyCap {
  uint16_t index;
  uint16_t key;
};

static const struct KeyCap key_caps[] = {
    {59, KEY_DELETE},      /* kdch1 */
    {61, KEY_ARROW_DOWN},  /* kcud1 */
    {66, KEY_F1},          /* kf1 */
    {67, KEY_F10},         /* kf10 */
    {68, KEY_F2},          /* kf2 */
    {69, KEY_F3},          /* kf3 */
    {70, KEY_F4},          /* kf4 */
    {71, KEY_F5},          /* kf5 */
    {72, KEY_F6},          /* kf6 */
    {73, KEY_F7},          /* kf7 */
    {74, KEY_F8},          /* kf8 */
    {75, KEY_F9},          /* kf9 */
    {76, KEY_HOME},        /* khome */
    {77, KEY_INSERT},      /* kich1 */
    {79, KEY_ARROW_LEFT},  /* kcub1 */
    {81, KEY_PGDN},        /* knp */
    {82, KEY_PGUP},        /* kpp */
    {83, KEY_ARROW_RIGHT}, /* kcuf1 */
    {87, KEY_ARROW_UP},    /* kcuu1 */
    {148, KEY_BACKTAB},    /* kcbt */
    {164, KEY_END},        /* kend */
    {216, KEY_F11},        /* kf11 */
    {217, KEY_F12},        /* kf12 */
    {0, 0},
};

int input_size(void) { return align8((int)sizeof(struct InputState)); }

struct InputState *input_init(void *mem, int esc_latency_ms,
                              const uint8_t *terminfo, int terminfo_len,
                              struct TermInfo *ti) {
  struct InputState *st = (struct InputState *)mem;
  memset(st, 0, sizeof(struct InputState));
  st->esc_latency_ms = esc_latency_ms;
  st->ti = ti ? ti : terminfo_init(&st->ti_private);

  /* build escape sequence trie: terminfo keys first (first writer wins
   * in trie_add, so the entry's sequences take precedence), then the
   * xterm defaults for anything the entry does not define */
  trie_init(st->trie, &st->trie_len);
  if (terminfo && terminfo_len > 0) {
    for (int i = 0; key_caps[i].key; i++) {
      int n = 0;
      const char *seq =
          terminfo_str(terminfo, terminfo_len, key_caps[i].index, &n);
      if (seq && n > 0)
        trie_add(st->trie, &st->trie_len, seq, n, key_caps[i].key, 0);
    }
  }
  for (int i = 0; base_caps[i].seq; i++)
    trie_add(st->trie, &st->trie_len, base_caps[i].seq,
             strlen(base_caps[i].seq), base_caps[i].key, base_caps[i].mod);
  for (int i = 0; mod_caps[i].seq; i++)
    trie_add(st->trie, &st->trie_len, mod_caps[i].seq, strlen(mod_caps[i].seq),
             mod_caps[i].key, mod_caps[i].mod);

  return st;
}

int input_scan(struct InputState *st, const char *buf, int len, double now) {

  /* append incoming bytes (may be partial if buffer is full) */
  int space = SCAN_BUFFER_SIZE - st->len;
  int accepted = len < space ? len : space;
  if (accepted > 0) {
    memcpy(st->buf + st->len, buf, accepted);
    st->len += accepted;
  }

  st->count = 0;

  while (st->len > 0 && st->count < MAX_EVENTS) {
    /* ── ESC handling ───────────────────────────────────────────── */
    if ((uint8_t)st->buf[0] == 0x1b) {
      /* lone ESC? */
      if (st->len == 1) {
        if (st->esc_time == 0)
          st->esc_time = now;
        if (now - st->esc_time >= (double)st->esc_latency_ms) {
          struct InputEvent *ev = emit(st);
          ev->type = EVENT_KEY;
          ev->key = KEY_ESC;
          shift(st, 1);
          st->esc_time = 0;
          continue;
        }
        /* pending — caller should retry after timeout */
        return accepted;
      }

      /* try trie match */
      {
        int consumed = 0;
        uint16_t key = 0;
        uint8_t mod = 0;
        int rv = trie_match(st->trie, st->buf, st->len, &consumed, &key, &mod);
        if (rv == PARSE_OK) {
          struct InputEvent *ev = emit(st);
          ev->type = EVENT_KEY;
          ev->key = key;
          ev->mod = mod;
          shift(st, consumed);
          st->esc_time = 0;
          continue;
        }
        if (rv == PARSE_NEED_MORE) {
          return accepted;
        }
      }

      /* try mouse */
      {
        struct InputEvent mev;
        memset(&mev, 0, sizeof(mev));
        int rv = parse_mouse(st, &mev);
        if (rv == PARSE_OK) {
          struct InputEvent *ev = emit(st);
          *ev = mev;
          st->esc_time = 0;
          continue;
        }
        if (rv == PARSE_NEED_MORE) {
          return accepted;
        }
      }

      /* try CSI u (Kitty keyboard protocol) */
      {
        struct InputEvent kev;
        memset(&kev, 0, sizeof(kev));
        int rv = parse_csi_u(st, &kev);
        if (rv == PARSE_OK) {
          struct InputEvent *ev = emit(st);
          *ev = kev;
          st->esc_time = 0;
          continue;
        }
        if (rv == PARSE_NEED_MORE) {
          return accepted;
        }
      }

      /* try DSR cursor position response */
      {
        struct InputEvent kev;
        memset(&kev, 0, sizeof(kev));
        int rv = parse_cursor(st, &kev);
        if (rv == PARSE_OK) {
          struct InputEvent *ev = emit(st);
          *ev = kev;
          st->esc_time = 0;
          continue;
        }
        if (rv == PARSE_NEED_MORE) {
          return accepted;
        }
      }

      /* try Kitty-enhanced legacy CSI (arrows, fn keys, etc.) */
      {
        struct InputEvent kev;
        memset(&kev, 0, sizeof(kev));
        int rv = parse_csi_legacy(st, &kev);
        if (rv == PARSE_OK) {
          struct InputEvent *ev = emit(st);
          *ev = kev;
          st->esc_time = 0;
          continue;
        }
        if (rv == PARSE_NEED_MORE) {
          return accepted;
        }
      }

      /* try capability query responses (OSC/DCS/APC/CSI ?) — consumed
       * silently into the capability struct, never surfaced as events */
      {
        int rv = parse_response(st);
        if (rv == PARSE_OK) {
          st->esc_time = 0;
          continue;
        }
        if (rv == PARSE_NEED_MORE) {
          return accepted;
        }
      }

      /* unrecognized ESC sequence: treat as Alt + next byte */
      shift(st, 1);
      st->esc_time = 0;

      if (st->len > 0) {
        uint8_t b = (uint8_t)st->buf[0];
        struct InputEvent *ev = emit(st);
        ev->type = EVENT_KEY;
        ev->mod = MOD_ALT;

        if (b < 0x20) {
          ev->key = b;
          ev->mod |= MOD_CTRL;
          shift(st, 1);
        } else if (b == 0x7f) {
          ev->key = KEY_BACKSPACE;
          shift(st, 1);
        } else if (b >= 0x20 && b < 0x80) {
          ev->ch = b;
          shift(st, 1);
        } else {
          /* Alt + UTF-8 char */
          int need = utf8_len(b);
          if (need > st->len) {
            return accepted; /* need more */
          }
          uint32_t cp;
          utf8_decode(&cp, st->buf);
          ev->ch = cp;
          shift(st, need);
        }
      }
      continue;
    }

    /* ── Control characters ─────────────────────────────────────── */
    uint8_t b = (uint8_t)st->buf[0];

    if (b < 0x20) {
      struct InputEvent *ev = emit(st);
      ev->type = EVENT_KEY;
      ev->key = b;
      if (b != KEY_TAB && b != KEY_ENTER) {
        ev->mod = MOD_CTRL;
      }
      shift(st, 1);
      st->esc_time = 0;
      continue;
    }

    /* ── Backspace (0x7f) ───────────────────────────────────────── */
    if (b == 0x7f) {
      struct InputEvent *ev = emit(st);
      ev->type = EVENT_KEY;
      ev->key = KEY_BACKSPACE;
      shift(st, 1);
      st->esc_time = 0;
      continue;
    }

    /* ── Printable / UTF-8 ──────────────────────────────────────── */
    {
      int need = utf8_len(b);
      if (need > st->len) {
        return accepted; /* partial UTF-8 */
      }
      uint32_t cp;
      int n = utf8_decode(&cp, st->buf);
      if (n <= 0) {
        n = 1;
        cp = 0xfffd;
      }
      struct InputEvent *ev = emit(st);
      ev->type = EVENT_KEY;
      ev->ch = cp;
      shift(st, n);
      st->esc_time = 0;
    }
  }

  return accepted;
}

int input_count(struct InputState *st) { return st->count; }

struct InputEvent *input_event(struct InputState *st, int index) {
  if (index < 0 || index >= st->count)
    return 0;
  return &st->events[index];
}

int input_delay(struct InputState *st) {
  if (st->esc_time > 0) {
    return st->esc_latency_ms;
  }
  return 0;
}
