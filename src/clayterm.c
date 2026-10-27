/* clayterm.c — WASM terminal rendering engine for Clay UI
 *
 * Public API (exported to WASM):
 *   clayterm_size   — compute arena size for given dimensions
 *   clayterm_init   — initialize a Clayterm instance in provided memory
 *   clayterm_resize — rebuild dimension-dependent storage in place
 *   reduce          — decode command buffer, run Clay layout, render to ANSI
 *   output          — pointer to output byte buffer
 *   length          — length of output byte buffer
 *   measure         — Clay text measurement callback
 *   error_count, error_type, error_message_length, error_message_ptr
 *                   — per-render Clay error accessors
 */

#include "clayterm.h"
#include "transitions.h"
#include "../clay/clay.h"
#include "buffer.h"
#include "cell.h"
#include "frame.h"
#include "mem.h"
#include "utf8.h"
#include "wcwidth.h"

/* ── Instance state ───────────────────────────────────────────────── */

/* Clayterm-specific error codes, numbered past Clay's error enum (0..8).
 * Mirrored by ERROR_TYPES in term.ts. */
#define CLAYTERM_ERR_CLIP_DEPTH_EXCEEDED 9
#define CLAYTERM_ERR_COMBINING_MARKS_EXCEEDED 10

#define CLAYTERM_STR_(x) #x
#define CLAYTERM_STR(x) CLAYTERM_STR_(x)

struct Clayterm {
  int w, h;
  uint32_t runlist_capacity;
  FrameContext frames;
  Clay_Context *clay;
  /* RENDER_CAP_* bits pushed by the host via set_capabilities(), retained
   * across resize updates. */
  uint32_t caps;
};

/* 128 bytes per cell: ~84 bytes worst-case for CUP + SGR sequences, plus up
 * to 4 (base SMP char) + 8×4 (combining marks) = 36 bytes of cluster text. */
#define OUT_BYTES_PER_CELL 128

/* Fixed per-frame slack on top of the per-cell budget, for output emitted
 * once per frame rather than per cell: the BSU/ESU synchronized-output pair
 * and one OSC 22 pointer shape. Keeps them from being dropped on tiny grids
 * where the per-cell budget alone is tight. */
#define OUT_FRAME_OVERHEAD 64

/* Pointer shape names in wire-index order; mirrors POINTER_SHAPES in
 * pointer-shape.ts. */
static const char *const POINTER_SHAPES[] = {
    "default",       "none",      "context-menu", "help",        "pointer",
    "progress",      "wait",      "cell",         "crosshair",   "text",
    "vertical-text", "alias",     "copy",         "move",        "no-drop",
    "not-allowed",   "grab",      "grabbing",     "e-resize",    "n-resize",
    "ne-resize",     "nw-resize", "s-resize",     "se-resize",   "sw-resize",
    "w-resize",      "ew-resize", "ns-resize",    "nesw-resize", "nwse-resize",
    "zoom-in",       "zoom-out",
};
#define POINTER_SHAPE_COUNT                                                    \
  ((int)(sizeof(POINTER_SHAPES) / sizeof(POINTER_SHAPES[0])))

/* Clay calls hover functions in hit-test order, ancestors first, so the
 * last call is the innermost declaring element. */
static void cursor_hover(Clay_ElementId id, Clay_PointerData pointer,
                         void *shape) {
  (void)id;
  (void)pointer;
  struct Clayterm *ct = Clay_GetCurrentContext()->errorHandler.userData;
  Frame *frame = ct->frames.current;
  frame->hover_shape = (uint8_t)(uintptr_t)shape;
}

/* ── Cell buffer ops ──────────────────────────────────────────────── */

static Cell *cell_at(struct Clayterm *ct, Cell *buf, int x, int y) {
  return &buf[y * ct->w + x];
}

static int setcell(struct Clayterm *ct, int x, int y, uint32_t ch, uint32_t fg,
                   uint32_t bg) {
  Frame *frame = ct->frames.current;
  if (x < 0 || x >= ct->w || y < 0 || y >= ct->h)
    return 0;
  if (frame->clip.enabled) {
    if (x < frame->clip.active.x ||
        x >= frame->clip.active.x + frame->clip.active.w)
      return 0;
    if (y < frame->clip.active.y ||
        y >= frame->clip.active.y + frame->clip.active.h)
      return 0;
  }
  Cell *c = cell_at(ct, frame->cells, x, y);
  c->ch = ch;
  c->fg = fg;
  if (!(bg & ATTR_DEFAULT)) {
    c->bg = bg;
  }
  for (int i = 0; i < CELL_MAX_COMBINING; i++)
    c->combining[i] = 0;
  return 1;
}

/* Surface a COMBINING_MARKS_EXCEEDED error once per frame. */
static void report_combining_exceeded(struct Clayterm *ct) {
  Frame *frame = ct->frames.current;
  if (frame->combining_exceeded)
    return;
  frame->combining_exceeded = true;
  if (frame->error_count >= FRAME_MAX_ERRORS)
    return;
  static const char msg[] =
      "cell exceeds combining-mark limit of " CLAYTERM_STR(
          CELL_MAX_COMBINING) "; excess marks truncated";
  frame->errors[frame->error_count++] = (Clay_ErrorData){
      .errorType = (Clay_ErrorType)CLAYTERM_ERR_COMBINING_MARKS_EXCEEDED,
      .errorText = {.isStaticallyAllocated = true,
                    .length = (int32_t)(sizeof(msg) - 1),
                    .chars = msg},
      .userData = ct,
  };
}

/* Append a combining-mark codepoint to the cell at (x, y) in the back buffer.
 * Marks beyond CELL_MAX_COMBINING are dropped (truncation from end) and
 * reported once per frame.
 */
static void append_combining(struct Clayterm *ct, int x, int y, uint32_t cp) {
  if (x < 0 || x >= ct->w || y < 0 || y >= ct->h)
    return;
  Cell *c = cell_at(ct, ct->frames.current->cells, x, y);
  for (int i = 0; i < CELL_MAX_COMBINING; i++) {
    if (c->combining[i] == 0) {
      c->combining[i] = cp;
      return;
    }
  }
  report_combining_exceeded(ct);
}

/* ── Escape sequence generation ───────────────────────────────────── */

static void emit_attr(struct Clayterm *ct, uint32_t fg, uint32_t bg) {
  Frame *frame = ct->frames.current;
  Buffer *out = &frame->context->output;
  if (fg == frame->emission.lastfg && bg == frame->emission.lastbg)
    return;

  /* SGR reset */
  buf_str(out, "\x1b[0m");

  /* style attributes from fg high byte */
  if (fg & ATTR_BOLD)
    buf_str(out, "\x1b[1m");
  if (fg & ATTR_DIM)
    buf_str(out, "\x1b[2m");
  if (fg & ATTR_ITALIC)
    buf_str(out, "\x1b[3m");
  if (fg & ATTR_UNDERLINE)
    buf_str(out, "\x1b[4m");
  if (fg & ATTR_BLINK)
    buf_str(out, "\x1b[5m");
  if (fg & ATTR_REVERSE)
    buf_str(out, "\x1b[7m");
  if (fg & ATTR_STRIKEOUT)
    buf_str(out, "\x1b[9m");

  /* foreground truecolor */
  if (!(fg & ATTR_DEFAULT)) {
    buf_str(out, "\x1b[38;2;");
    buf_num(out, (fg >> 16) & 0xff);
    buf_put(out, ";", 1);
    buf_num(out, (fg >> 8) & 0xff);
    buf_put(out, ";", 1);
    buf_num(out, fg & 0xff);
    buf_put(out, "m", 1);
  }

  /* background truecolor */
  if (!(bg & ATTR_DEFAULT)) {
    buf_str(out, "\x1b[48;2;");
    buf_num(out, (bg >> 16) & 0xff);
    buf_put(out, ";", 1);
    buf_num(out, (bg >> 8) & 0xff);
    buf_put(out, ";", 1);
    buf_num(out, bg & 0xff);
    buf_put(out, "m", 1);
  }

  frame->emission.lastfg = fg;
  frame->emission.lastbg = bg;
}

/** Emit CUP sequence. `row` is the 1-based terminal row of the region. */
static void emit_cursor(struct Clayterm *ct, int x, int y, int row) {
  Frame *frame = ct->frames.current;
  Buffer *out = &frame->context->output;
  buf_str(out, "\x1b[");
  buf_num(out, y + row);
  buf_put(out, ";", 1);
  buf_num(out, x + 1);
  buf_put(out, "H", 1);
}

static void emit_ch(struct Clayterm *ct, int x, int y, int row, uint32_t ch) {
  Frame *frame = ct->frames.current;
  Buffer *out = &frame->context->output;
  if (frame->emission.lastx != x - 1 || frame->emission.lasty != y) {
    emit_cursor(ct, x, y, row);
  }
  frame->emission.lastx = x;
  frame->emission.lasty = y;

  if (!iswprint(ch))
    ch = 0xfffd;
  buf_char(out, ch);
}

/**
 * Diff the current frame's cells against the last frame and emit changed cells
 * using absolute CUP positioning (\x1b[row;colH). Unchanged cells are
 * skipped, making this efficient for subsequent frames where most of
 * the screen is static. Derived from termbox2 tb_present.
 */
static void present_cups(struct Clayterm *ct, int row) {
  Frame *frame = ct->frames.current;
  Buffer *out = &frame->context->output;
  CaretState *caret = &frame->caret;

  /* Synchronized Output (DEC mode 2026): the terminal buffers everything
   * between BSU and ESU and presents it in one atomic repaint, so a frame
   * never tears mid-update. Unsupported terminals ignore the private mode;
   * whether we emit the wrap at all is decided by the sync-output
   * capability. */
  int sync = ct->caps & RENDER_CAP_SYNC_OUTPUT;
  int start = out->length;
  if (sync)
    buf_str(out, "\x1b[?2026h");
  /* Body start: the no-op check below compares against this so the BSU
   * itself never counts as frame content. */
  int body = out->length;

  for (int y = 0; y < ct->h; y++) {
    for (int x = 0; x < ct->w;) {
      Cell *back = cell_at(ct, frame->cells, x, y);
      Cell *front = cell_at(ct, ct->frames.previous->cells, x, y);

      int w = wcwidth(back->ch);
      if (w < 1)
        w = 1;

      if (cell_cmp(back, front)) {
        emit_attr(ct, back->fg, back->bg);

        if (w > 1 && x >= ct->w - (w - 1)) {
          /* wide char doesn't fit, send spaces */
          for (int i = x; i < ct->w; i++)
            emit_ch(ct, i, y, row, ' ');
        } else {
          emit_ch(ct, x, y, row, back->ch);
          for (int ci = 0; ci < CELL_MAX_COMBINING && back->combining[ci]; ci++)
            buf_char(out, back->combining[ci]);
        }
      }
      /* The completed frame becomes the next diff baseline. Mark every
       * fitting wide glyph, including unchanged ones, so a later narrow
       * glyph redraws the terminal's continuation cell. */
      if (w > 1 && x < ct->w - (w - 1)) {
        for (int i = 1; i < w; i++) {
          Cell *tail = cell_at(ct, frame->cells, x + i, y);
          tail->ch = 0xffffffff;
          tail->fg = 0xffffffff;
          tail->bg = 0xffffffff;
        }
      }
      x += w;
    }
  }

  /* Show a declared caret once its cell is resolved. Otherwise, hide the
   * cursor if the renderer previously showed it. */
  bool show_caret = caret->declared && caret->placed;
  if (show_caret) {
    emit_cursor(ct, caret->x, caret->y, row);
    buf_str(out, "\x1b[?25h");
  } else if (frame->cursor_visible) {
    buf_str(out, "\x1b[?25l");
  }
  frame->cursor_visible = show_caret;

  if (out->length == body) {
    /* Nothing was emitted — no cell changes and no caret transition.
     * Rewind the BSU so a no-op frame still produces zero bytes. */
    out->length = start;
  } else if (sync) {
    buf_str(out, "\x1b[?2026l"); /* ESU: end synchronized update */
  }
}

/**
 * Emit current cells as newline-separated rows without CUP positioning.
 * Every cell is written (no diffing), and the completed frame becomes
 * the baseline for the next render. This is
 * used for inline "region" rendering where the caller manages cursor
 * positioning externally and the output must work in pipes.
 */
static void present_lines(struct Clayterm *ct) {
  Frame *frame = ct->frames.current;
  Buffer *out = &frame->context->output;
  for (int y = 0; y < ct->h; y++) {
    if (y > 0)
      buf_put(out, "\n", 1);
    for (int x = 0; x < ct->w;) {
      Cell *back = cell_at(ct, frame->cells, x, y);

      int w = wcwidth(back->ch);
      if (w < 1)
        w = 1;

      emit_attr(ct, back->fg, back->bg);

      if (w > 1 && x >= ct->w - (w - 1)) {
        for (int i = x; i < ct->w; i++) {
          buf_char(out, ' ');
        }
      } else {
        uint32_t ch = back->ch;
        if (!iswprint(ch))
          ch = 0xfffd;
        buf_char(out, ch);
        for (int ci = 0; ci < CELL_MAX_COMBINING && back->combining[ci]; ci++)
          buf_char(out, back->combining[ci]);
        for (int i = 1; i < w; i++) {
          Cell *fw = cell_at(ct, frame->cells, x + i, y);
          fw->ch = 0xffffffff;
          fw->fg = 0xffffffff;
          fw->bg = 0xffffffff;
        }
      }
      x += w;
    }
  }
}

/* ── Color conversion ─────────────────────────────────────────────── */

static uint32_t color(Clay_Color c) {
  uint8_t r = (uint8_t)c.r;
  uint8_t g = (uint8_t)c.g;
  uint8_t b = (uint8_t)c.b;
  return ((uint32_t)r << 16) | ((uint32_t)g << 8) | (uint32_t)b;
}

/* ── Clay render backend ──────────────────────────────────────────── */

static void render_rect(struct Clayterm *ct, int x0, int y0, int x1, int y1,
                        Clay_RectangleRenderData *r) {
  uint32_t bg = color(r->backgroundColor);
  for (int y = y0; y < y1; y++)
    for (int x = x0; x < x1; x++)
      setcell(ct, x, y, ' ', ATTR_DEFAULT, bg);
}

/* Return the byte length of the first `cps` code points of `start`,
 * clamped to at most `max_bytes`. Used at decode time to convert the
 * caller's code-point caret offset into a stable byte offset. */
static uint32_t utf8_bytes_for_cps(const char *start, uint32_t cps,
                                   uint32_t max_bytes) {
  uint32_t consumed = 0;
  const char *p = start;
  int rem = (int)max_bytes;
  for (uint32_t k = 0; k < cps && rem > 0; k++) {
    uint32_t cp;
    int n = utf8_decode(&cp, p);
    if (n <= 0) {
      n = 1;
    }
    if (n > rem) {
      n = rem;
    }
    consumed += (uint32_t)n;
    p += n;
    rem -= n;
  }
  return consumed;
}

static void render_text(struct Clayterm *ct, int x0, int y0,
                        Clay_RenderCommand *cmd) {
  CaretState *caret = &ct->frames.current->caret;
  Clay_TextRenderData *t = &cmd->renderData.text;
  uint32_t bg = (uint32_t)(uintptr_t)cmd->userData;
  uint32_t fg = color(t->textColor);

  /* text attrs are packed into the alpha channel by reduce() */
  uint32_t attrs = ((uint32_t)(uint8_t)t->textColor.a) << 24;
  fg |= attrs;

  const char *slice = t->stringContents.chars;
  int slice_len = t->stringContents.length;

  /* Determine whether this slice belongs to the caret's text node and
   * whether the caret still needs to be placed. If so, resolve the cell
   * as a side effect of the walk instead of doing a separate pass. */
  const char *node_start = caret->text.chars;
  const char *node_end = node_start ? node_start + caret->text.length : NULL;
  int caret_relevant = (node_start != NULL && !caret->placed &&
                        slice >= node_start && slice < node_end);

  /* Pre-check: if the slice's first byte is already past the target,
   * whitespace at the wrap seam was dropped by the layout engine. Snap
   * the caret to this slice's origin. */
  if (caret_relevant) {
    uint32_t slice_start_bytes = (uint32_t)(slice - node_start);
    if (slice_start_bytes > caret->byte_offset) {
      caret->x = x0;
      caret->y = y0;
      caret->placed = 1;
      caret_relevant = 0;
    }
  }

  const char *p = slice;
  int rem = slice_len;
  int x = x0;
  int last_x = -1; /* column of the most-recently written base cell */

  while (rem > 0) {
    /* Check at the top of each iteration: if the pointer we are about to
     * consume matches the target byte offset, the caret sits at the
     * current cell — right before this code point. */
    if (caret_relevant && (uint32_t)(p - node_start) == caret->byte_offset) {
      caret->x = x;
      caret->y = y0;
      caret->placed = 1;
      caret_relevant = 0;
    }

    uint32_t cp;
    int n = utf8_decode(&cp, p);
    if (n <= 0) {
      n = 1;
      cp = 0xfffd;
    }
    int cw = wcwidth(cp);
    if (cw < 0)
      cw = 1;
    if (cw > 0) {
      last_x = setcell(ct, x, y0, cp, fg, bg) ? x : -1;
      x += cw;
    } else if (last_x >= 0) {
      /* combining mark: attach to the preceding base cell */
      append_combining(ct, last_x, y0, cp);
    }
    p += n;
    rem -= n;
  }

  /* Remember the trailing cell of this slice as the end-of-content
   * fallback. If no later slice claims the target and the caret still
   * hasn't been placed by the end of the render command loop, this cell
   * is where a caret at offset == content-length lands. */
  if (caret_relevant) {
    caret->tail_x = x;
    caret->tail_y = y0;
    caret->tail_valid = 1;
  }
}

static void render_border(struct Clayterm *ct, int x0, int y0, int x1, int y1,
                          Clay_RenderCommand *cmd) {
  Clay_BorderRenderData *b = &cmd->renderData.border;
  /* Must match border packing in ops.ts.
   * userData points at eight required words in the command buffer: resolved
   * fg/bg pairs in top, right, bottom, left order. Fallback resolution
   * (shared color/bg vs side overrides) happens on the TypeScript side; this
   * renderer consumes explicit values only. The command buffer outlives the
   * render pass within reduce(). Missing userData is a wire-format violation.
   */
  const uint32_t *s = (const uint32_t *)cmd->userData;
  if (s == NULL) {
    __builtin_trap();
  }

  uint32_t top_fg = s[0];
  uint32_t top_bg = s[1];
  uint32_t right_fg = s[2];
  uint32_t right_bg = s[3];
  uint32_t bot_fg = s[4];
  uint32_t bot_bg = s[5];
  uint32_t left_fg = s[6];
  uint32_t left_bg = s[7];
  int top = b->width.top > 0;
  int bot = b->width.bottom > 0;
  int left = b->width.left > 0;
  int right = b->width.right > 0;

  /* corners — rounded when corner radius > 0. Drawn only when both adjacent
   * sides are enabled; a terminal cell holds a single fg/bg, so top corners
   * take the top side attributes and bottom corners take the bottom side
   * attributes (deterministic approximation of CSS split corners). */
  uint32_t tl = b->cornerRadius.topLeft > 0 ? 0x256d : 0x250c;
  uint32_t tr = b->cornerRadius.topRight > 0 ? 0x256e : 0x2510;
  uint32_t bl = b->cornerRadius.bottomLeft > 0 ? 0x2570 : 0x2514;
  uint32_t br = b->cornerRadius.bottomRight > 0 ? 0x256f : 0x2518;

  if (top && left)
    setcell(ct, x0, y0, tl, top_fg, top_bg);
  if (top && right)
    setcell(ct, x1 - 1, y0, tr, top_fg, top_bg);
  if (bot && left)
    setcell(ct, x0, y1 - 1, bl, bot_fg, bot_bg);
  if (bot && right)
    setcell(ct, x1 - 1, y1 - 1, br, bot_fg, bot_bg);

  /* horizontal edges */
  if (top)
    for (int x = x0 + left; x < x1 - right; x++)
      setcell(ct, x, y0, 0x2500, top_fg, top_bg);
  if (bot)
    for (int x = x0 + left; x < x1 - right; x++)
      setcell(ct, x, y1 - 1, 0x2500, bot_fg, bot_bg);

  /* vertical edges — excluding joined corner cells owned by top/bottom */
  if (left)
    for (int y = y0 + top; y < y1 - bot; y++)
      setcell(ct, x0, y, 0x2502, left_fg, left_bg);
  if (right)
    for (int y = y0 + top; y < y1 - bot; y++)
      setcell(ct, x1 - 1, y, 0x2502, right_fg, right_bg);
}

/* ── Command buffer helpers ───────────────────────────────────────── */

static uint32_t rd(uint32_t *buf, uint32_t len, uint32_t *i) {
  (void)len; /* assemble_frame checked every directive's extent. */
  return buf[(*i)++];
}

static float rdf(uint32_t *buf, uint32_t len, uint32_t *i) {
  uint32_t v = rd(buf, len, i);
  float f;
  memcpy(&f, &v, 4);
  return f;
}

static Clay_Color unpack_color(uint32_t c) {
  return (Clay_Color){
      .r = (float)((c >> 16) & 0xff),
      .g = (float)((c >> 8) & 0xff),
      .b = (float)(c & 0xff),
      .a = (float)((c >> 24) & 0xff),
  };
}

static Clay_SizingAxis decode_axis(uint32_t *buf, uint32_t len, uint32_t *i) {
  uint32_t type = rd(buf, len, i);
  float a = rdf(buf, len, i);
  float b = rdf(buf, len, i);
  Clay_SizingAxis axis = {0};
  switch (type) {
  case 0: /* FIT */
    axis.type = CLAY__SIZING_TYPE_FIT;
    axis.size.minMax.min = a;
    axis.size.minMax.max = b;
    break;
  case 1: /* GROW */
    axis.type = CLAY__SIZING_TYPE_GROW;
    axis.size.minMax.min = a;
    axis.size.minMax.max = b;
    break;
  case 2: /* PERCENT */
    axis.type = CLAY__SIZING_TYPE_PERCENT;
    axis.size.percent = a;
    break;
  case 3: /* FIXED */
    axis.type = CLAY__SIZING_TYPE_FIXED;
    axis.size.minMax.min = a;
    axis.size.minMax.max = a;
    break;
  }
  return axis;
}

/* ── Public API ───────────────────────────────────────────────────── */

static int align64(int n) { return (n + 63) & ~63; }

static uint32_t persistent_size(uint32_t runlist_capacity) {
  return align8(sizeof(struct Clayterm)) +
         2u * frame_storage_size(runlist_capacity);
}

/* Clay's element capacity drives nearly all of Clay_MinMemorySize, so scale it
 * with the grid instead of shipping Clay's fixed 8192-element default. 2x cells
 * bounds sane trees (leaves >= 1 cell, branching >= 2); the ceiling preserves
 * today's capacity for large grids, the floor keeps headroom on tiny ones.
 * Must run before Clay_MinMemorySize in both clayterm_size and
 * clayterm_resize so the queried size matches the arena setup. */
static void set_clay_capacity(int w, int h) {
  int64_t elems = (int64_t)w * h * 2;
  if (elems < 2048)
    elems = 2048;
  if (elems > FRAME_ELEMENT_CAPACITY)
    elems = FRAME_ELEMENT_CAPACITY;
  Clay_SetMaxElementCount((int)elems);
  Clay_SetMaxMeasureTextCacheWordCount((int)elems * 2);
}

int clayterm_size(int w, int h, int runlist_capacity) {
  if (w <= 0 || h <= 0 || runlist_capacity < 0 ||
      runlist_capacity > INT32_MAX / 4)
    return 0;
  int64_t cell_count = (int64_t)w * h;
  if (cell_count > INT32_MAX / (2 * sizeof(Cell) + OUT_BYTES_PER_CELL))
    return 0;
  /* Sizing must not reconfigure a live arena: the host can still fail to
   * grow memory after this query. Clay only needs the two capacity fields. */
  Clay_Context sizing = {0};
  Clay_Context *previous = Clay_GetCurrentContext();
  Clay_SetCurrentContext(&sizing);
  set_clay_capacity(w, h);
  int clay_bytes = align64((int)Clay_MinMemorySize());
  Clay_SetCurrentContext(previous);
  int64_t size =
      persistent_size((uint32_t)runlist_capacity) +
      2 * ((cell_count * sizeof(Cell) + 7) & ~7LL) +
      ((cell_count * OUT_BYTES_PER_CELL + OUT_FRAME_OVERHEAD + 7) & ~7LL) +
      clay_bytes;
  return size <= INT32_MAX ? (int)size : 0;
}

static void clay_error(Clay_ErrorData err) {
  struct Clayterm *ct = (struct Clayterm *)err.userData;
  if (ct->frames.current->error_count < FRAME_MAX_ERRORS) {
    ct->frames.current->errors[ct->frames.current->error_count++] = err;
  }
}

/* Surface a CLIP_DEPTH_EXCEEDED error once per frame. The message is a static
 * literal, so its pointer lives in WASM linear memory and is readable by the
 * host via error_message_ptr/length. */
static void report_clip_depth_exceeded(struct Clayterm *ct) {
  Frame *frame = ct->frames.current;
  if (frame->clip_depth_exceeded)
    return;
  frame->clip_depth_exceeded = true;
  if (frame->error_count >= FRAME_MAX_ERRORS)
    return;
  static const char msg[] =
      "clip nesting exceeds tracked depth limit of " CLAYTERM_STR(
          FRAME_CLIP_STACK_MAX) "; over-deep clips coalesced into the deepest "
                                "tracked region";
  frame->errors[frame->error_count++] = (Clay_ErrorData){
      .errorType = (Clay_ErrorType)CLAYTERM_ERR_CLIP_DEPTH_EXCEEDED,
      .errorText = {.isStaticallyAllocated = true,
                    .length = (int32_t)(sizeof(msg) - 1),
                    .chars = msg},
      .userData = ct,
  };
}

int error_count(struct Clayterm *ct) {
  return ct->frames.previous->error_count;
}

int error_type(struct Clayterm *ct, int index) {
  if (index < 0 || index >= ct->frames.previous->error_count)
    return -1;
  return (int)ct->frames.previous->errors[index].errorType;
}

int error_message_length(struct Clayterm *ct, int index) {
  if (index < 0 || index >= ct->frames.previous->error_count)
    return 0;
  return ct->frames.previous->errors[index].errorText.length;
}

int error_message_ptr(struct Clayterm *ct, int index) {
  if (index < 0 || index >= ct->frames.previous->error_count)
    return 0;
  return (int)ct->frames.previous->errors[index].errorText.chars;
}

struct Clayterm *clayterm_init(void *mem, int w, int h, int runlist_capacity) {
  struct Clayterm *ct = (struct Clayterm *)mem;
  *ct = (struct Clayterm){0};
  ct->runlist_capacity = (uint32_t)runlist_capacity;
  char *base = (char *)ct + align8(sizeof(struct Clayterm));
  frame_context_init(&ct->frames, base, ct->runlist_capacity);
  clayterm_resize(ct, w, h);
  return ct;
}

/* Rebuild viewport storage without resetting instance state such as
 * capabilities, retained directives, and emitted terminal state. */
void clayterm_resize(struct Clayterm *ct, int w, int h) {
  if (ct->clay)
    Clay_SetCurrentContext(ct->clay);
  set_clay_capacity(w, h);
  int cell_count = w * h;
  uint32_t cell_bytes = align8((uint32_t)cell_count * sizeof(Cell));
  uint32_t out_bytes =
      align8((uint32_t)cell_count * OUT_BYTES_PER_CELL + OUT_FRAME_OVERHEAD);
  char *base = (char *)ct + persistent_size(ct->runlist_capacity);

  ct->w = w;
  ct->h = h;
  ct->frames.frames[0].cells = (Cell *)base;
  ct->frames.frames[1].cells = (Cell *)(base + cell_bytes);
  ct->frames.output =
      (Buffer){base + cell_bytes * 2, 0,
               cell_count * OUT_BYTES_PER_CELL + OUT_FRAME_OVERHEAD};

  /* Discard results from the old layout. Traversal scratch is reset by
   * reduce() before use. */
  for (int i = 0; i < 2; i++) {
    Frame *frame = &ct->frames.frames[i];
    frame->layout_valid = 0;
    frame->pointer_count = 0;
    frame->error_count = 0;
    frame->animating_count = 0;
    frame_reset_caret(frame);
  }

  char *clay_mem = base + cell_bytes * 2 + out_bytes;
  int clay_bytes = align64((int)Clay_MinMemorySize());
  Clay_Arena arena =
      Clay_CreateArenaWithCapacityAndMemory(clay_bytes, clay_mem);
  /* Clay reads its previous context during initialization. Fill cells only
   * afterward: the resized cell buffers may overlap that old context. */
  ct->clay = Clay_Initialize(arena, (Clay_Dimensions){(float)w, (float)h},
                             (Clay_ErrorHandler){clay_error, ct});

  // initialize back buffer with spaces and default fg/bg
  cells_fill(ct->frames.current->cells, w, h, ' ', ATTR_DEFAULT, ATTR_DEFAULT);

  // initialize front buffer with zeros. Every cell will be
  // redrawn on the first render.
  cells_fill(ct->frames.previous->cells, w, h, 0, 0, 0);
}

void set_capabilities(struct Clayterm *ct, uint32_t caps) { ct->caps = caps; }

/* Check packed extents before copying or allowing Clay to borrow any bytes.
 * This is a wire-safety check; directive property validation stays on the host.
 */
static int packed_valid(const uint32_t *buf, int len) {
  int i = 0;
  int depth = 0;
  while (i < len) {
    uint32_t op = buf[i++];
    if (op == CLAYTERM_OP_OPEN_ELEMENT) {
      if (i == len)
        return 0;
      uint32_t bytes = buf[i++];
      uint32_t words = bytes / 4 + (bytes % 4 != 0);
      if (words >= (uint32_t)(len - i))
        return 0;
      i += (int)words;
      uint32_t mask = buf[i++];
      if (mask & ~0xffu)
        return 0;
      int props = ((mask & CLAYTERM_PROP_LAYOUT) ? 9 : 0) +
                  ((mask & CLAYTERM_PROP_BG_COLOR) ? 1 : 0) +
                  ((mask & CLAYTERM_PROP_CORNER_RADIUS) ? 1 : 0) +
                  ((mask & CLAYTERM_PROP_BORDER) ? 9 : 0) +
                  ((mask & CLAYTERM_PROP_CLIP) ? 1 : 0) +
                  ((mask & CLAYTERM_PROP_FLOATING) ? 7 : 0) +
                  ((mask & CLAYTERM_PROP_TRANSITION) ? 2 : 0) +
                  ((mask & CLAYTERM_PROP_CURSOR) ? 1 : 0);
      if (props > len - i)
        return 0;
      i += props;
      depth++;
    } else if (op == CLAYTERM_OP_TEXT) {
      if (len - i < 5)
        return 0;
      uint32_t bytes = buf[i + 4];
      i += 5;
      uint32_t words = bytes / 4 + (bytes % 4 != 0);
      if (words > (uint32_t)(len - i))
        return 0;
      i += (int)words;
    } else if (op == CLAYTERM_OP_CLOSE_ELEMENT) {
      if (depth == 0)
        return 0;
      depth--;
    } else {
      return 0;
    }
  }
  return depth == 0;
}

static int prepare_current_frame(struct Clayterm *ct, const uint32_t *buf,
                                 int len) {
  if (len < 0)
    return CLAYTERM_REDUCE_INVALID;
  if ((uint32_t)len > ct->runlist_capacity / 4)
    return CLAYTERM_REDUCE_CAPACITY;
  if (!packed_valid(buf, len))
    return CLAYTERM_REDUCE_INVALID;

  Frame *frame = ct->frames.current;
  frame_render_init(frame, ct->frames.previous);
  memcpy(frame->runlist, buf, (size_t)len * 4);
  frame->runlist_length = (uint32_t)len;
  return CLAYTERM_REDUCE_OK;
}

static void report_element_capacity_exceeded(struct Clayterm *ct) {
  Frame *frame = ct->frames.current;
  if (frame->metadata_exceeded)
    return;
  frame->metadata_exceeded = true;
  clay_error((Clay_ErrorData){
      .errorType = CLAY_ERROR_TYPE_ELEMENTS_CAPACITY_EXCEEDED,
      .errorText = CLAY_STRING("Frame element capacity exceeded."),
      .userData = ct,
  });
}

static void record_open(struct Clayterm *ct, Clay_ElementId id,
                        uint32_t offset) {
  Frame *frame = ct->frames.current;
  if (frame->open_depth == FRAME_ELEMENT_CAPACITY) {
    frame->open_overflow++;
    report_element_capacity_exceeded(ct);
    return;
  }

  int index = -1;
  /* Clay keeps the first declaration of a duplicate ID. Its error callback
   * reports the duplicate; give every open its own stack slot so a duplicate
   * close cannot change the first declaration's range. */
  if (id.stringId.length && frame_element_index(frame, id.id) < 0) {
    if (frame->element_count < FRAME_ELEMENT_CAPACITY) {
      index = (int)frame->element_count++;
      uint32_t bucket = id.id % FRAME_ELEMENT_CAPACITY;
      frame->elements[index] = (ElementInfo){
          .id = id,
          .offset = offset,
          .next = frame->element_buckets[bucket],
      };
      frame->element_buckets[bucket] = (uint32_t)index + 1;
    } else {
      report_element_capacity_exceeded(ct);
    }
  }
  frame->context->open_elements[frame->open_depth++] = index;
}

static void record_close(struct Clayterm *ct, uint32_t end) {
  Frame *frame = ct->frames.current;
  if (frame->open_overflow) {
    frame->open_overflow--;
    return;
  }
  if (frame->open_depth == 0)
    return;
  int index = frame->context->open_elements[--frame->open_depth];
  if (index >= 0) {
    ElementInfo *info = &frame->elements[index];
    info->length = end - info->offset;
  }
}

static Clay_RenderCommandArray execute_current_runlist(struct Clayterm *ct,
                                                       float deltaTime) {
  CaretState *caret = &ct->frames.current->caret;
  uint32_t *buf = ct->frames.current->runlist;
  uint32_t len = ct->frames.current->runlist_length;
  uint32_t i = 0;
  Clay_SetCurrentContext(ct->clay);

  Clay_BeginLayout();

  while (i < len) {
    uint32_t offset = i * 4;
    uint32_t op = rd(buf, len, &i);

    switch (op) {
    case CLAYTERM_OP_OPEN_ELEMENT: {
      /* read id string */
      uint32_t id_len = rd(buf, len, &i);
      uint32_t id_words = (id_len + 3) / 4;
      char *id_chars = (char *)&buf[i];
      i += id_words;

      Clay_ElementId eid = {0};
      int open_depth = ct->clay->openLayoutElementStack.length;
      if (id_len > 0) {
        Clay_String str = {.length = (int32_t)id_len, .chars = id_chars};
        eid = Clay__HashString(str, 0);
        Clay__OpenElementWithId(eid);
      } else {
        Clay__OpenElement();
      }
      int opened = ct->clay->openLayoutElementStack.length > open_depth;
      record_open(ct, opened ? eid : (Clay_ElementId){0}, offset);

      /* read property mask */
      uint32_t mask = rd(buf, len, &i);
      Clay_ElementDeclaration decl = {0};

      if (mask & CLAYTERM_PROP_LAYOUT) {
        decl.layout.sizing.width = decode_axis(buf, len, &i);
        decl.layout.sizing.height = decode_axis(buf, len, &i);

        uint32_t pad = rd(buf, len, &i);
        decl.layout.padding.left = pad & 0xff;
        decl.layout.padding.right = (pad >> 8) & 0xff;
        decl.layout.padding.top = (pad >> 16) & 0xff;
        decl.layout.padding.bottom = (pad >> 24) & 0xff;

        uint32_t gd = rd(buf, len, &i);
        decl.layout.childGap = gd & 0xffff;
        decl.layout.layoutDirection = (gd >> 16) & 0xff;

        uint32_t al = rd(buf, len, &i);
        decl.layout.childAlignment.x = al & 0xff;
        decl.layout.childAlignment.y = (al >> 8) & 0xff;
      }

      if (mask & CLAYTERM_PROP_BG_COLOR) {
        decl.backgroundColor = unpack_color(rd(buf, len, &i));
      }

      if (mask & CLAYTERM_PROP_CORNER_RADIUS) {
        uint32_t cr = rd(buf, len, &i);
        decl.cornerRadius.topLeft = (float)(cr & 0xff);
        decl.cornerRadius.topRight = (float)((cr >> 8) & 0xff);
        decl.cornerRadius.bottomLeft = (float)((cr >> 16) & 0xff);
        decl.cornerRadius.bottomRight = (float)((cr >> 24) & 0xff);
      }

      if (mask & CLAYTERM_PROP_BORDER) {
        uint32_t bw = rd(buf, len, &i);
        decl.border.width.left = bw & 0xff;
        decl.border.width.right = (bw >> 8) & 0xff;
        decl.border.width.top = (bw >> 16) & 0xff;
        decl.border.width.bottom = (bw >> 24) & 0xff;

        /* Border sides reserve layout space additively: effective padding
         * is userPadding + borderWidth per side (renderer-spec 12.2). */
        decl.layout.padding.left += decl.border.width.left;
        decl.layout.padding.right += decl.border.width.right;
        decl.layout.padding.top += decl.border.width.top;
        decl.layout.padding.bottom += decl.border.width.bottom;

        /* Resolved per-side fg/bg attribute words (top, right, bottom,
         * left). Routed to render_border via userData; the command buffer
         * remains valid for the whole render pass. */
        if (i + 8 <= len)
          decl.userData = (void *)&buf[i];
        i += 8;
      }

      if (mask & CLAYTERM_PROP_CLIP) {
        uint32_t cl = rd(buf, len, &i);
        decl.clip.horizontal = cl & 0xff;
        decl.clip.vertical = (cl >> 8) & 0xff;
      }

      if (mask & CLAYTERM_PROP_FLOATING) {
        decl.floating.offset.x = rdf(buf, len, &i);
        decl.floating.offset.y = rdf(buf, len, &i);
        decl.floating.expand.width = rdf(buf, len, &i);
        decl.floating.expand.height = rdf(buf, len, &i);
        decl.floating.parentId = rd(buf, len, &i);

        uint32_t fc = rd(buf, len, &i);
        decl.floating.attachTo = fc & 0xff;
        decl.floating.attachPoints.element = (fc >> 8) & 0xff;
        decl.floating.attachPoints.parent = (fc >> 16) & 0xff;
        decl.floating.pointerCaptureMode = (fc >> 24) & 0xff;

        uint32_t fd = rd(buf, len, &i);
        decl.floating.clipTo = fd & 0xff;
        decl.floating.zIndex = (int16_t)(fd >> 8);
      }

      if (mask & CLAYTERM_PROP_TRANSITION) {
        float duration = rdf(buf, len, &i);
        uint32_t props_and_flags = rd(buf, len, &i);
        uint16_t props = props_and_flags & 0xFFFF;
        uint8_t easing = (props_and_flags >> 16) & 0xFF;
        uint8_t interactive = (props_and_flags >> 24) & 0xFF;

        decl.transition.handler = ct_handler_for(easing);
        decl.transition.duration = duration;
        decl.transition.properties = (Clay_TransitionProperty)props;
        decl.transition.interactionHandling =
            interactive
                ? CLAY_TRANSITION_ALLOW_INTERACTIONS_WHILE_TRANSITIONING_POSITION
                : CLAY_TRANSITION_DISABLE_INTERACTIONS_WHILE_TRANSITIONING_POSITION;
      }

      uint32_t cursor = POINTER_SHAPE_COUNT;
      if (mask & CLAYTERM_PROP_CURSOR)
        cursor = rd(buf, len, &i);

      if (!opened)
        break;
      Clay__ConfigureOpenElement(decl);

      if (cursor < POINTER_SHAPE_COUNT && (ct->caps & RENDER_CAP_POINTER_SHAPE))
        Clay_OnHover(cursor_hover, (void *)(uintptr_t)cursor);
      break;
    }

    case CLAYTERM_OP_TEXT: {
      uint32_t col = rd(buf, len, &i);
      uint32_t bg = rd(buf, len, &i);
      uint32_t cfg = rd(buf, len, &i);
      uint32_t caret_offset = rd(buf, len, &i);
      uint32_t str_len = rd(buf, len, &i);
      uint32_t str_words = (str_len + 3) / 4;
      char *str_chars = (char *)&buf[i];
      i += str_words;
      Clay_String text = {.isStaticallyAllocated = false,
                          .length = (int32_t)str_len,
                          .chars = str_chars};

      /* A caret on empty content is a rendering commitment the layout
       * engine cannot satisfy on its own — zero cells give render_text
       * nothing to attach the cursor to. Substitute a single space so
       * the caret lands at the text element's origin, per the spec's
       * "as if the content were a single space" outcome. */
      if (caret_offset != 0xFFFFFFFF && str_len == 0) {
        text = CLAY_STRING(" ");
      }

      /* Record the FIRST caret declaration per frame for the
       * single-hardware-cursor contract; later declarations are
       * intentionally ignored (multi-cursor is unspecified).
       *
       * Convert the caller's code-point offset into a byte offset once
       * here so the render walk can identify the caret cell by simple
       * pointer arithmetic against the slice's chars pointer. */
      if (caret_offset != 0xFFFFFFFF && !caret->declared) {
        caret->text = text;
        caret->byte_offset =
            utf8_bytes_for_cps(text.chars, caret_offset, text.length);
        caret->declared = true;
      }

      Clay_TextElementConfig config = {0};
      config.userData = (void *)(uintptr_t)bg;
      config.textColor = unpack_color(col);
      config.fontSize = cfg & 0xff;
      config.fontId = (cfg >> 8) & 0xff;
      config.wrapMode = (cfg >> 16) & 0xff;
      /* attrs byte -> alpha channel for render_text to extract */
      config.textColor.a = (float)((cfg >> 24) & 0xff);

      Clay__OpenTextElement(text, config);
      break;
    }

    case CLAYTERM_OP_CLOSE_ELEMENT:
      Clay__CloseElement();
      record_close(ct, i * 4);
      break;

    default:
      break;
    }
  }

  return Clay_EndLayout(deltaTime);
}

static void commit_current_frame(struct Clayterm *ct, float px, float py,
                                 int pointer) {
  Frame *frame = ct->frames.current;
  /* Clay skips layout and leaves old hit-test results on element overflow.
   * Those bounds and strings do not describe this frame. */
  if (ct->clay->booleanWarnings.maxElementsExceeded) {
    report_element_capacity_exceeded(ct);
    return;
  }
  frame->layout_valid = 1;

  /* pointer: 0 = absent, 1 = up, 2 = down. The hit test runs against this
   * frame's layout and fires cursor_hover for declaring elements. */
  if (pointer) {
    Clay_SetPointerState((Clay_Vector2){px, py}, pointer == 2);
    Clay_ElementIdArray ids = Clay_GetPointerOverIds();
    for (int i = 0; i < ids.length; i++) {
      Clay_String id = ids.internalArray[i].stringId;
      if (!id.length)
        continue;
      if (frame->pointer_count == FRAME_ELEMENT_CAPACITY) {
        report_element_capacity_exceeded(ct);
        break;
      }
      frame->pointer_ids[frame->pointer_count++] = id;
    }
  }
}

static void draw_current_frame(struct Clayterm *ct,
                               Clay_RenderCommandArray cmds) {
  Frame *frame = ct->frames.current;
  CaretState *caret = &frame->caret;
  cells_fill(frame->cells, ct->w, ct->h, ' ', ATTR_DEFAULT, ATTR_DEFAULT);

  /* walk Clay render commands into back buffer */
  for (int32_t j = 0; j < cmds.length; j++) {
    Clay_RenderCommand *cmd = Clay_RenderCommandArray_Get(&cmds, j);
    Clay_BoundingBox box = cmd->boundingBox;
    int x0 = (int)box.x;
    int y0 = (int)box.y;
    int x1 = (int)(box.x + box.width);
    int y1 = (int)(box.y + box.height);

    switch (cmd->commandType) {
    case CLAY_RENDER_COMMAND_TYPE_RECTANGLE:
      render_rect(ct, x0, y0, x1, y1, &cmd->renderData.rectangle);
      break;
    case CLAY_RENDER_COMMAND_TYPE_TEXT:
      render_text(ct, x0, y0, cmd);
      break;
    case CLAY_RENDER_COMMAND_TYPE_BORDER:
      render_border(ct, x0, y0, x1, y1, cmd);
      break;
    case CLAY_RENDER_COMMAND_TYPE_SCISSOR_START: {
      /* intersect the child box with the current active rect (if any) */
      int nx0 = x0, ny0 = y0, nx1 = x1, ny1 = y1;
      if (frame->clip.depth > 0) {
        ClipRect top = frame->clip.stack[frame->clip.depth - 1];
        if (top.x > nx0)
          nx0 = top.x;
        if (top.y > ny0)
          ny0 = top.y;
        if (top.x + top.w < nx1)
          nx1 = top.x + top.w;
        if (top.y + top.h < ny1)
          ny1 = top.y + top.h;
      }
      int nw = nx1 - nx0;
      int nh = ny1 - ny0;
      if (nw < 0)
        nw = 0;
      if (nh < 0)
        nh = 0;
      if (frame->clip.depth < FRAME_CLIP_STACK_MAX) {
        ClipRect r = {nx0, ny0, nw, nh};
        frame->clip.stack[frame->clip.depth++] = r;
        frame->clip.enabled = true;
        frame->clip.active = r;
      } else {
        /* Out of tracked slots: coalesce this level into the deepest tracked
         * region (leave the active rect untouched) and remember to pop it
         * without disturbing the tracked stack. */
        frame->clip.overflow++;
        report_clip_depth_exceeded(ct);
      }
      break;
    }
    case CLAY_RENDER_COMMAND_TYPE_SCISSOR_END:
      if (frame->clip.overflow > 0) {
        /* Closing an untracked level: nothing was pushed, so leave the tracked
         * stack and active rect alone. */
        frame->clip.overflow--;
        break;
      }
      if (frame->clip.depth > 0)
        frame->clip.depth--;
      if (frame->clip.depth > 0) {
        ClipRect top = frame->clip.stack[frame->clip.depth - 1];
        frame->clip.enabled = true;
        frame->clip.active = top;
      } else {
        frame->clip.enabled = false;
      }
      break;
    default:
      break;
    }
  }

  /* End-of-content fallback: if a caret was declared and its target byte
   * offset is one past the last byte of the caret text node, the trailing
   * cell of the last walked caret slice is where it lands. */
  if (caret->declared && !caret->placed && caret->tail_valid &&
      caret->byte_offset == (uint32_t)caret->text.length) {
    caret->x = caret->tail_x;
    caret->y = caret->tail_y;
    caret->placed = 1;
  }
}

static void write_current_frame(struct Clayterm *ct, int mode, int row) {
  Frame *frame = ct->frames.current;
  Buffer *out = &frame->context->output;
  if (mode == 1) {
    present_lines(ct);
  } else {
    present_cups(ct, row);
  }

  if ((ct->caps & RENDER_CAP_POINTER_SHAPE) &&
      frame->hover_shape != frame->pointer_shape) {
    frame->pointer_shape = frame->hover_shape;
    buf_str(out, "\x1b]22;");
    buf_str(out, POINTER_SHAPES[frame->pointer_shape]);
    buf_str(out, "\x1b\\");
  }
}

int reduce(struct Clayterm *ct, uint32_t *buf, int len, int mode, int row,
           float deltaTime, float px, float py, int pointer) {

  // set up the current frame's runlist
  int status = prepare_current_frame(ct, buf, len);
  if (status != CLAYTERM_REDUCE_OK)
    return status;

  // run directives to receive render commands
  Clay_RenderCommandArray commands = execute_current_runlist(ct, deltaTime);

  // compute final book keeping
  commit_current_frame(ct, px, py, pointer);

  // draw the cells for this frame
  draw_current_frame(ct, commands);

  // perform diff and copy any changes to output buffer
  write_current_frame(ct, mode, row);

  // render complete, current becomes previous
  frame_context_swap_frames(&ct->frames);

  return CLAYTERM_REDUCE_OK;
}

char *output(struct Clayterm *ct) { return ct->frames.output.data; }

int length(struct Clayterm *ct) { return ct->frames.output.length; }

uint32_t animating(struct Clayterm *ct) {
  return ct->frames.previous->animating_count;
}

int get_element_bounds(struct Clayterm *ct, const char *name, int name_len,
                       float *out) {
  Frame *frame = ct->frames.previous;
  if (!frame->layout_valid)
    return 0;
  Clay_String str = {.length = name_len, .chars = name};
  Clay_ElementId eid = Clay__HashString(str, 0);
  int index = frame_element_index(frame, eid.id);
  if (index < 0)
    return 0;
  Clay_SetCurrentContext(ct->clay);
  Clay_ElementData data = Clay_GetElementData(frame->elements[index].id);
  if (!data.found) {
    return 0;
  }
  out[0] = data.boundingBox.x;
  out[1] = data.boundingBox.y;
  out[2] = data.boundingBox.width;
  out[3] = data.boundingBox.height;
  return 1;
}

int pointer_over_count(struct Clayterm *ct) {
  return ct->frames.previous->pointer_count;
}

int pointer_over_id_string_length(struct Clayterm *ct, int index) {
  Frame *frame = ct->frames.previous;
  if (index < 0 || index >= frame->pointer_count)
    return 0;
  return frame->pointer_ids[index].length;
}

int pointer_over_id_string_ptr(struct Clayterm *ct, int index) {
  Frame *frame = ct->frames.previous;
  if (index < 0 || index >= frame->pointer_count)
    return 0;
  return (int)frame->pointer_ids[index].chars;
}

void measure(int ret, int txt) {
  /* Read Clay_StringSlice from txt address.
   * Clay_StringSlice layout: { int32_t length, const char *chars, ... }
   * We only need length and chars. */
  int32_t slen = *(int32_t *)txt;
  const char *chars = *(const char **)(txt + 4);

  int w = 0;
  const char *p = chars;
  int rem = slen;
  while (rem > 0) {
    uint32_t cp;
    int n = utf8_decode(&cp, p);
    if (n <= 0) {
      n = 1;
      cp = 0xfffd;
    }
    /* Mirror draw_text: non-printables render as one U+FFFD cell, so
     * they must measure as one cell. */
    int cw = wcwidth(cp);
    if (cw < 0)
      cw = 1;
    if (cw > 0)
      w += cw;
    p += n;
    rem -= n;
  }

  /* Write Clay_Dimensions { float width, float height } to ret */
  float *dims = (float *)ret;
  dims[0] = (float)w;
  dims[1] = 1.0f;
}
