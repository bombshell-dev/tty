/* input.h — VT/ANSI escape sequence parser for terminal input
 *
 * Decodes raw terminal bytes into structured InputEvent records. Handles
 * escape sequences (arrow keys, function keys, etc.), mouse protocols
 * (VT200, SGR, urxvt), UTF-8 multibyte characters, and control keys.
 *
 *
 * Usage:
 *   1. input does not allocate any memory itself, so start by allocating
 *      input_size() bytes of memory.
 *   2. Call input_init(mem, esc_latency_ms) to get an InputState.
 *   3. When bytes arrive from stdin, call input_scan(st, buf, len, now).
 *   4. Read events with input_count(st) and input_event(st, i).
 *   5. Check input_delay(st): if non-zero, re-call input_scan() with
 *      an empty buffer (len=0) after that many milliseconds to resolve
 *      a pending lone ESC.
 *
 * Example:
 *
 *   void *mem = malloc(input_size());
 *   struct InputState *st = input_init(mem, 50);
 *
 *   // in your event loop:
 *   int accepted = input_scan(st, buf, nread, now_ms);
 *   for (int i = 0; i < input_count(st); i++) {
 *     struct InputEvent *ev = input_event(st, i);
 *     // handle ev->type, ev->key, ev->ch, ev->mod ...
 *   }
 *   int delay = input_delay(st);
 *   if (delay > 0) {
 *     // schedule another input_scan(st, NULL, 0, now_ms) after delay ms
 *   }
 *
 * Gotchas:
 *
 *   - input_scan() may accept fewer bytes than provided if the internal
 *     buffer (SCAN_BUFFER_SIZE) is full. The caller must re-feed the remainder.
 *   - Event pointers from input_event() are invalidated by the next
 *     input_scan() call. Copy any data you need before scanning again.
 *   - At most 128 events are produced per scan. If saturated, the last
 *     slot is overwritten. In practice this is unreachable.
 *   - A lone ESC byte is ambiguous: it could be the Escape key or the
 *     start of a sequence. The parser holds it until either more bytes
 *     arrive or the ESC latency expires. You must honour input_delay() and
 *     re-call input_scan() with len=0 to flush it.
 *   - The `now` parameter must be monotonically increasing milliseconds
 *     (e.g. Date.now()). The parser uses it solely for ESC latency
 *     disambiguation.
 */

#ifndef INPUT_H
#define INPUT_H

#include <stdint.h>

/* ── Event types ──────────────────────────────────────────────────── */

#define EVENT_KEY 1
#define EVENT_MOUSE 2
#define EVENT_RESIZE 3
#define EVENT_CURSOR 4
#define EVENT_POINTERSHAPE 5

/* ── Modifier flags (bitwise) ─────────────────────────────────────── */

#define MOD_ALT 1
#define MOD_CTRL 2
#define MOD_SHIFT 4
#define MOD_MOTION 8
#define MOD_RELEASE 16

/* ── Kitty action types ──────────────────────────────────────────── */

#define ACTION_NONE 0
#define ACTION_PRESS 1
#define ACTION_REPEAT 2
#define ACTION_RELEASE 3

/* ── Key codes ────────────────────────────────────────────────────── */

/* Function keys */
#define KEY_F1 0xFFFF
#define KEY_F2 0xFFFE
#define KEY_F3 0xFFFD
#define KEY_F4 0xFFFC
#define KEY_F5 0xFFFB
#define KEY_F6 0xFFFA
#define KEY_F7 0xFFF9
#define KEY_F8 0xFFF8
#define KEY_F9 0xFFF7
#define KEY_F10 0xFFF6
#define KEY_F11 0xFFF5
#define KEY_F12 0xFFF4

/* Navigation */
#define KEY_ARROW_UP 0xFFF3
#define KEY_ARROW_DOWN 0xFFF2
#define KEY_ARROW_LEFT 0xFFF1
#define KEY_ARROW_RIGHT 0xFFF0
#define KEY_HOME 0xFFEF
#define KEY_END 0xFFEE
#define KEY_INSERT 0xFFED
#define KEY_DELETE 0xFFEC
#define KEY_PGUP 0xFFEB
#define KEY_PGDN 0xFFEA
#define KEY_BACKTAB 0xFFE9

/* Numpad */
#define KEY_NUMPAD_0 0xFFE2
#define KEY_NUMPAD_1 0xFFE1
#define KEY_NUMPAD_2 0xFFE0
#define KEY_NUMPAD_3 0xFFDF
#define KEY_NUMPAD_4 0xFFDE
#define KEY_NUMPAD_5 0xFFDD
#define KEY_NUMPAD_6 0xFFDC
#define KEY_NUMPAD_7 0xFFDB
#define KEY_NUMPAD_8 0xFFDA
#define KEY_NUMPAD_9 0xFFD9
#define KEY_NUMPAD_DECIMAL 0xFFD8
#define KEY_NUMPAD_DIVIDE 0xFFD7
#define KEY_NUMPAD_MULTIPLY 0xFFD6
#define KEY_NUMPAD_SUBTRACT 0xFFD5
#define KEY_NUMPAD_ADD 0xFFD4
#define KEY_NUMPAD_ENTER 0xFFD3
#define KEY_NUMPAD_EQUAL 0xFFD2

/* Modifier keys */
#define KEY_SHIFT_LEFT 0xFFD1
#define KEY_SHIFT_RIGHT 0xFFD0
#define KEY_CONTROL_LEFT 0xFFCF
#define KEY_CONTROL_RIGHT 0xFFCE
#define KEY_ALT_LEFT 0xFFCD
#define KEY_ALT_RIGHT 0xFFCC
#define KEY_SUPER_LEFT 0xFFCB
#define KEY_SUPER_RIGHT 0xFFCA
#define KEY_HYPER_LEFT 0xFFC9
#define KEY_HYPER_RIGHT 0xFFC8
#define KEY_META_LEFT 0xFFC7
#define KEY_META_RIGHT 0xFFC6
#define KEY_CAPS_LOCK 0xFFC5
#define KEY_NUM_LOCK 0xFFC4
#define KEY_SCROLL_LOCK 0xFFC3

/* Mouse */
#define KEY_MOUSE_LEFT 0xFFE8
#define KEY_MOUSE_RIGHT 0xFFE7
#define KEY_MOUSE_MIDDLE 0xFFE6
#define KEY_MOUSE_RELEASE 0xFFE5
#define KEY_MOUSE_WHEEL_UP 0xFFE4
#define KEY_MOUSE_WHEEL_DOWN 0xFFE3

/* Special keys (ASCII range) */
#define KEY_ESC 0x1B
#define KEY_ENTER 0x0D
#define KEY_TAB 0x09
#define KEY_BACKSPACE 0x7F
#define KEY_SPACE 0x20

/**
 * Parsed terminal input event. All fields are represented as numbers for
 * efficient transport via linear memory. A semantic layer is added on top in
 * input.ts
 *
 * @field type  Event kind: EVENT_KEY, EVENT_MOUSE, or EVENT_RESIZE.
 * @field mod   Bitwise combination of MOD_ALT, MOD_CTRL, MOD_SHIFT, MOD_MOTION.
 * @field key   KEY_* constant for special keys, raw byte for control chars,
 *              or 0 when the event is a printable character (see ch).
 * @field ch    Unicode codepoint for printable characters, 0 otherwise.
 * @field x        Mouse column (0-based). Only valid for EVENT_MOUSE.
 * @field y        Mouse row (0-based). Only valid for EVENT_MOUSE.
 * @field w        Terminal width. Only valid for EVENT_RESIZE.
 * @field h        Terminal height. Only valid for EVENT_RESIZE.
 * @field action    Kitty event type: ACTION_NONE/PRESS/REPEAT/RELEASE.
 * @field shifted   Shifted key codepoint (Kitty alternate keys).
 * @field base      Base layout key codepoint (Kitty alternate keys).
 * @field text_len  Number of valid codepoints in text[] (0-8).
 * @field text      Associated text codepoints (Kitty enhancement level 16+).
 * @field report_len  Number of valid bytes in report[]. Only valid for
 *                    EVENT_POINTERSHAPE.
 * @field report      Raw payload of an OSC 22 pointer-shape reply, the bytes
 *                    between `OSC 22 ;` and the terminator. Truncated to
 *                    MAX_REPORT_BYTES. Only valid for EVENT_POINTERSHAPE.
 */

#define MAX_TEXT_CODEPOINTS 8
#define MAX_REPORT_BYTES 64

struct InputEvent {
  uint8_t type;
  uint8_t mod;
  uint16_t key;
  uint32_t ch;
  int32_t x;
  int32_t y;
  int32_t w;
  int32_t h;
  uint8_t action;
  uint32_t shifted;
  uint32_t base;
  uint32_t text[MAX_TEXT_CODEPOINTS];
  uint8_t text_len;
  uint16_t report_len;
  uint8_t report[MAX_REPORT_BYTES];
};

/**
 * A struct in which the entire input state can be stored. It is deliberately
 * opaque since it comprises the private state of the input scanner.
 */
struct InputState;

/**
 * Return the number of bytes needed to allocate an InputState.
 *
 * @return  Required arena size in bytes (8-byte aligned).
 */
int input_size(void);

/**
 * Initialize an input parser in the provided memory.
 *
 * @param mem             Pointer to at least input_size() bytes.
 * @param esc_latency_ms  ESC disambiguation latency in milliseconds.
 * @return                Initialized parser state.
 */
struct InputState *input_init(void *mem, int esc_latency_ms);

/**
 * Feed raw bytes into the parser and produce events.
 *
 * @param st   Parser state from input_init().
 * @param buf  Input bytes to parse.
 * @param len  Number of bytes in buf.
 * @param now  Current timestamp in milliseconds (e.g. Date.now()).
 *             Used for ESC latency disambiguation.
 * @return     Number of bytes accepted. May be less than len if the
 *             internal buffer is full (caller should re-feed the rest).
 */
int input_scan(struct InputState *st, const char *buf, int len, double now);

/**
 * Return the number of events produced by the last input_scan() call.
 *
 * @param st  Parser state.
 * @return    Event count (0 to 128).
 */
int input_count(struct InputState *st);

/**
 * Return a pointer to the event at the given index.
 *
 * @param st     Parser state.
 * @param index  Event index (0-based).
 * @return       Pointer to the event, or NULL if index is out of range.
 */
struct InputEvent *input_event(struct InputState *st, int index);

/**
 * Return the ESC latency delay if an ambiguous ESC is pending.
 *
 * @param st  Parser state.
 * @return    esc_latency_ms if a lone ESC is buffered, 0 otherwise.
 *            When non-zero, the caller should re-call input_scan()
 *            with an empty buffer after this many milliseconds.
 */
int input_delay(struct InputState *st);

#endif
