/* clayterm.c — WASM terminal rendering engine for Clay UI
 *
 * Public API (exported to WASM):
 *   clayterm_size  — compute arena size for given dimensions
 *   init           — initialize a Clayterm instance in provided memory
 *   reduce         — decode command buffer, run Clay layout, render to ANSI
 *   output         — pointer to output byte buffer
 *   length         — length of output byte buffer
 *   measure        — Clay text measurement callback
 *   error_count, error_type, error_message_length, error_message_ptr
 *                  — per-render Clay error accessors
 */

#include "clayterm.h"
#include "transitions.h"
#include "../clay/clay.h"
#include "buffer.h"
#include "cell.h"
#include "mem.h"
#include "utf8.h"
#include "wcwidth.h"

/* Module-level pointer to the Term currently executing reduce().
 * Set/cleared around each render pass so transition handlers (which Clay
 * invokes with no userData — see Clay_TransitionCallbackArguments) can
 * report back to the right Term's animating_count. Revisit once
 * nicbarker/clay#603 lands userData on transition callbacks; then the
 * handler can resolve its Term from args directly and this can go away. */
struct Clayterm *ct_active_context = NULL;

/* ── Command buffer protocol ──────────────────────────────────────── */

#define OP_BEGIN_LAYOUT 0x01
#define OP_OPEN_ELEMENT 0x02
#define OP_TEXT 0x03
#define OP_CLOSE_ELEMENT 0x04
#define OP_END_LAYOUT 0x05

#define PROP_LAYOUT 0x01
#define PROP_BG_COLOR 0x02
#define PROP_CORNER_RADIUS 0x04
#define PROP_BORDER 0x08
#define PROP_CLIP 0x10
#define PROP_FLOATING 0x20
#define PROP_TRANSITION 0x40

/* ── Instance state ───────────────────────────────────────────────── */

#define MAX_ERRORS 32

/* clip stack depth: nesting beyond this clamps to the deepest rect */
#define CLIP_STACK_MAX 16

/* Clayterm-specific error code, numbered past Clay's error enum (0..8).
 * Mirrored by ERROR_TYPES in term.ts. */
#define CLAYTERM_ERR_CLIP_DEPTH_EXCEEDED 9

#define CLAYTERM_STR_(x) #x
#define CLAYTERM_STR(x) CLAYTERM_STR_(x)

typedef struct {
  int x, y, w, h;
} ClipRect;

struct Clayterm {
  int w, h;
  Cell *front;
  Cell *back;
  Buffer out;
  uint32_t lastfg, lastbg;
  int lastx, lasty;
  /* clip region (active top mirrored here so setcell stays unchanged) */
  int clipx, clipy, clipw, cliph;
  int clipping;
  /* clip stack: nesting pushes intersected rects, leaving pops to restore */
  ClipRect clipstack[CLIP_STACK_MAX];
  int clipdepth;
  /* untracked clip levels open beyond CLIP_STACK_MAX; popped without
   * touching the tracked stack so push/pop stays symmetric */
  int clipoverflow;
  /* set once per frame when nesting first exceeds the tracked depth */
  int clip_depth_exceeded;
  /* error collection */
  Clay_ErrorData errors[MAX_ERRORS];
  int error_count;
  int animating_count;
  /* Caret state for hardware-cursor management. The renderer records the
   * first text node carrying a caret declaration per frame, then locates
   * the corresponding cell after Clay layout. had_caret_last_frame is the
   * only cross-frame bit retained. */
  const char
      *caret_text_chars; /* start of caret-bearing text node's bytes, or NULL */
  int caret_text_length; /* byte length of that text node */
  uint32_t caret_offset; /* code-point offset within that text node */
  int caret_x, caret_y;  /* resolved cell (column, row), valid only when
                            caret_text_chars != NULL */
  int has_caret;         /* 1 when the current frame placed a caret */
  int had_caret_last_frame; /* 1 when the previous frame placed a caret */
};

/* Memory layout inside the arena provided by the host:
 *   [Clayterm struct] [front cells] [back cells] [output buffer]
 *
 * Output buffer is sized at 64 bytes per cell — enough for worst-case
 * full-screen redraws with truecolor SGR sequences on every cell.
 */
#define OUT_BYTES_PER_CELL 64

/* ── Cell buffer ops ──────────────────────────────────────────────── */

static Cell *cell_at(struct Clayterm *ct, Cell *buf, int x, int y) {
  return &buf[y * ct->w + x];
}

static void setcell(struct Clayterm *ct, int x, int y, uint32_t ch, uint32_t fg,
                    uint32_t bg) {
  if (x < 0 || x >= ct->w || y < 0 || y >= ct->h)
    return;
  if (ct->clipping) {
    if (x < ct->clipx || x >= ct->clipx + ct->clipw)
      return;
    if (y < ct->clipy || y >= ct->clipy + ct->cliph)
      return;
  }
  Cell *c = cell_at(ct, ct->back, x, y);
  c->ch = ch;
  c->fg = fg;
  if (!(bg & ATTR_DEFAULT)) {
    c->bg = bg;
  }
}

/* ── Escape sequence generation ───────────────────────────────────── */

static void emit_attr(struct Clayterm *ct, uint32_t fg, uint32_t bg) {
  if (fg == ct->lastfg && bg == ct->lastbg)
    return;

  /* SGR reset */
  buf_str(&ct->out, "\x1b[0m");

  /* style attributes from fg high byte */
  if (fg & ATTR_BOLD)
    buf_str(&ct->out, "\x1b[1m");
  if (fg & ATTR_DIM)
    buf_str(&ct->out, "\x1b[2m");
  if (fg & ATTR_ITALIC)
    buf_str(&ct->out, "\x1b[3m");
  if (fg & ATTR_UNDERLINE)
    buf_str(&ct->out, "\x1b[4m");
  if (fg & ATTR_BLINK)
    buf_str(&ct->out, "\x1b[5m");
  if (fg & ATTR_REVERSE)
    buf_str(&ct->out, "\x1b[7m");
  if (fg & ATTR_STRIKEOUT)
    buf_str(&ct->out, "\x1b[9m");

  /* foreground truecolor */
  if (!(fg & ATTR_DEFAULT)) {
    buf_str(&ct->out, "\x1b[38;2;");
    buf_num(&ct->out, (fg >> 16) & 0xff);
    buf_put(&ct->out, ";", 1);
    buf_num(&ct->out, (fg >> 8) & 0xff);
    buf_put(&ct->out, ";", 1);
    buf_num(&ct->out, fg & 0xff);
    buf_put(&ct->out, "m", 1);
  }

  /* background truecolor */
  if (!(bg & ATTR_DEFAULT)) {
    buf_str(&ct->out, "\x1b[48;2;");
    buf_num(&ct->out, (bg >> 16) & 0xff);
    buf_put(&ct->out, ";", 1);
    buf_num(&ct->out, (bg >> 8) & 0xff);
    buf_put(&ct->out, ";", 1);
    buf_num(&ct->out, bg & 0xff);
    buf_put(&ct->out, "m", 1);
  }

  ct->lastfg = fg;
  ct->lastbg = bg;
}

/** Emit CUP sequence. `row` is the 1-based terminal row of the region. */
static void emit_cursor(struct Clayterm *ct, int x, int y, int row) {
  buf_str(&ct->out, "\x1b[");
  buf_num(&ct->out, y + row);
  buf_put(&ct->out, ";", 1);
  buf_num(&ct->out, x + 1);
  buf_put(&ct->out, "H", 1);
}

static void emit_ch(struct Clayterm *ct, int x, int y, int row, uint32_t ch) {
  if (ct->lastx != x - 1 || ct->lasty != y) {
    emit_cursor(ct, x, y, row);
  }
  ct->lastx = x;
  ct->lasty = y;

  if (!iswprint(ch))
    ch = 0xfffd;
  buf_char(&ct->out, ch);
}

/**
 * Diff back buffer against front buffer and emit only changed cells
 * using absolute CUP positioning (\x1b[row;colH). Unchanged cells are
 * skipped, making this efficient for subsequent frames where most of
 * the screen is static. Derived from termbox2 tb_present.
 */
static void present_cups(struct Clayterm *ct, int row) {
  ct->lastx = -1;
  ct->lasty = -1;

  for (int y = 0; y < ct->h; y++) {
    for (int x = 0; x < ct->w;) {
      Cell *back = cell_at(ct, ct->back, x, y);
      Cell *front = cell_at(ct, ct->front, x, y);

      int w = wcwidth(back->ch);
      if (w < 1)
        w = 1;

      if (cell_cmp(back, front)) {
        /* copy to front */
        *front = *back;

        emit_attr(ct, back->fg, back->bg);

        if (w > 1 && x >= ct->w - (w - 1)) {
          /* wide char doesn't fit, send spaces */
          for (int i = x; i < ct->w; i++)
            emit_ch(ct, i, y, row, ' ');
        } else {
          emit_ch(ct, x, y, row, back->ch);
          /* mark trailing cells of wide char as invalid in front
           * so they'll diff when overwritten by narrow chars */
          for (int i = 1; i < w; i++) {
            Cell *fw = cell_at(ct, ct->front, x + i, y);
            fw->ch = 0xffffffff;
            fw->fg = 0xffffffff;
            fw->bg = 0xffffffff;
          }
        }
      }
      x += w;
    }
  }

  /* Hardware cursor management: per the spec's outcome contract,
   * leave the cursor visible at the caret cell if a caret was declared
   * this frame; otherwise hide it if and only if a caret was declared
   * last frame. When neither this frame nor any prior frame declared
   * a caret, emit nothing. */
  if (ct->has_caret) {
    emit_cursor(ct, ct->caret_x, ct->caret_y, row);
    buf_str(&ct->out, "\x1b[?25h");
  } else if (ct->had_caret_last_frame) {
    buf_str(&ct->out, "\x1b[?25l");
  }
  ct->had_caret_last_frame = ct->has_caret;
}

/**
 * Emit back buffer as newline-separated rows without CUP positioning.
 * Every cell is written (no diffing), and the front buffer is primed
 * so that a subsequent present() call can diff efficiently. This is
 * used for inline "region" rendering where the caller manages cursor
 * positioning externally and the output must work in pipes.
 */
static void present_lines(struct Clayterm *ct) {
  for (int y = 0; y < ct->h; y++) {
    if (y > 0)
      buf_put(&ct->out, "\n", 1);
    for (int x = 0; x < ct->w;) {
      Cell *back = cell_at(ct, ct->back, x, y);
      Cell *front = cell_at(ct, ct->front, x, y);

      int w = wcwidth(back->ch);
      if (w < 1)
        w = 1;

      *front = *back;

      emit_attr(ct, back->fg, back->bg);

      if (w > 1 && x >= ct->w - (w - 1)) {
        for (int i = x; i < ct->w; i++) {
          buf_char(&ct->out, ' ');
        }
      } else {
        uint32_t ch = back->ch;
        if (!iswprint(ch))
          ch = 0xfffd;
        buf_char(&ct->out, ch);
        for (int i = 1; i < w; i++) {
          Cell *fw = cell_at(ct, ct->front, x + i, y);
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

/**
 * Locate the cell where the caret should be rendered given the per-line
 * text commands produced by Clay's wrap pass. Iterates render commands
 * in order, accumulating code points consumed across slices that belong
 * to the caret text node, until the caret's code-point offset is reached.
 */
static void locate_caret(struct Clayterm *ct, Clay_RenderCommandArray *cmds) {
  if (ct->caret_text_chars == NULL) {
    return;
  }
  const char *node_start = ct->caret_text_chars;
  const char *node_end = node_start + ct->caret_text_length;
  uint32_t target = ct->caret_offset;
  uint32_t accumulated = 0;

  for (int32_t j = 0; j < cmds->length; j++) {
    Clay_RenderCommand *cmd = Clay_RenderCommandArray_Get(cmds, j);
    if (cmd->commandType != CLAY_RENDER_COMMAND_TYPE_TEXT) {
      continue;
    }
    Clay_TextRenderData *t = &cmd->renderData.text;
    const char *slice = t->stringContents.chars;
    int slice_len = t->stringContents.length;
    if (slice < node_start || slice >= node_end) {
      continue;
    }
    /* count code points in this slice */
    uint32_t slice_cps = 0;
    int x_cells = 0;
    const char *p = slice;
    int rem = slice_len;
    while (rem > 0) {
      uint32_t cp;
      int n = utf8_decode(&cp, p);
      if (n <= 0) {
        n = 1;
        cp = 0xfffd;
      }
      if (accumulated + slice_cps == target) {
        ct->caret_x = (int)cmd->boundingBox.x + x_cells;
        ct->caret_y = (int)cmd->boundingBox.y;
        return;
      }
      int cw = wcwidth(cp);
      if (cw < 0) {
        cw = 1;
      }
      x_cells += cw;
      slice_cps++;
      p += n;
      rem -= n;
    }
    if (accumulated + slice_cps == target) {
      /* caret sits just after this slice's last code point */
      ct->caret_x = (int)cmd->boundingBox.x + x_cells;
      ct->caret_y = (int)cmd->boundingBox.y;
      return;
    }
    accumulated += slice_cps;
  }
  /* offset out of range: behavior is unspecified by the spec; leave
   * caret_x/caret_y at their sentinel -1 values and let the emission
   * step suppress visibility. */
  ct->has_caret = 0;
}

static void render_text(struct Clayterm *ct, int x0, int y0,
                        Clay_RenderCommand *cmd) {

  Clay_TextRenderData *t = &cmd->renderData.text;
  uint32_t bg = (uint32_t)(uintptr_t)cmd->userData;
  uint32_t fg = color(t->textColor);

  /* text attrs are packed into the alpha channel by reduce() */
  uint32_t attrs = ((uint32_t)(uint8_t)t->textColor.a) << 24;
  fg |= attrs;

  const char *p = t->stringContents.chars;
  int rem = t->stringContents.length;
  int x = x0;

  while (rem > 0) {
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
      setcell(ct, x, y0, cp, fg, bg);
      x += cw;
    }
    p += n;
    rem -= n;
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

static uint32_t rd(uint32_t *buf, int len, int *i) {
  if (*i < len)
    return buf[(*i)++];
  return 0;
}

static float rdf(uint32_t *buf, int len, int *i) {
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

static Clay_SizingAxis decode_axis(uint32_t *buf, int len, int *i) {
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

int clayterm_size(int w, int h) {
  int cell_count = w * h;
  int cell_bytes = cell_count * (int)sizeof(Cell);
  int out_bytes = cell_count * OUT_BYTES_PER_CELL;
  int clay_bytes = (int)Clay_MinMemorySize();
  return align8((int)sizeof(struct Clayterm)) + align8(cell_bytes) /* front */
         + align8(cell_bytes)                                      /* back */
         + align8(out_bytes)    /* output buffer */
         + align64(clay_bytes); /* Clay arena */
}

static void clay_error(Clay_ErrorData err) {
  struct Clayterm *ct = (struct Clayterm *)err.userData;
  if (ct->error_count < MAX_ERRORS) {
    ct->errors[ct->error_count++] = err;
  }
}

/* Surface a CLIP_DEPTH_EXCEEDED error once per frame. The message is a static
 * literal, so its pointer lives in WASM linear memory and is readable by the
 * host via error_message_ptr/length. */
static void report_clip_depth_exceeded(struct Clayterm *ct) {
  if (ct->clip_depth_exceeded)
    return;
  ct->clip_depth_exceeded = 1;
  if (ct->error_count >= MAX_ERRORS)
    return;
  static const char msg[] =
      "clip nesting exceeds tracked depth limit of " CLAYTERM_STR(
          CLIP_STACK_MAX) "; over-deep clips coalesced into the deepest "
                          "tracked region";
  ct->errors[ct->error_count++] = (Clay_ErrorData){
      .errorType = (Clay_ErrorType)CLAYTERM_ERR_CLIP_DEPTH_EXCEEDED,
      .errorText = {.isStaticallyAllocated = true,
                    .length = (int32_t)(sizeof(msg) - 1),
                    .chars = msg},
      .userData = ct,
  };
}

int error_count(struct Clayterm *ct) { return ct->error_count; }

int error_type(struct Clayterm *ct, int index) {
  if (index < 0 || index >= ct->error_count)
    return -1;
  return (int)ct->errors[index].errorType;
}

int error_message_length(struct Clayterm *ct, int index) {
  if (index < 0 || index >= ct->error_count)
    return 0;
  return ct->errors[index].errorText.length;
}

int error_message_ptr(struct Clayterm *ct, int index) {
  if (index < 0 || index >= ct->error_count)
    return 0;
  return (int)ct->errors[index].errorText.chars;
}

struct Clayterm *init(void *mem, int w, int h) {
  struct Clayterm *ct = (struct Clayterm *)mem;
  int cell_count = w * h;
  int cell_bytes = align8(cell_count * (int)sizeof(Cell));
  int out_bytes = align8(cell_count * OUT_BYTES_PER_CELL);
  char *base = (char *)mem + align8((int)sizeof(struct Clayterm));

  char *clay_mem = base + cell_bytes * 2 + out_bytes;
  int clay_bytes = align64((int)Clay_MinMemorySize());
  Clay_Arena arena =
      Clay_CreateArenaWithCapacityAndMemory(clay_bytes, clay_mem);
  Clay_Initialize(arena, (Clay_Dimensions){(float)w, (float)h},
                  (Clay_ErrorHandler){clay_error, ct});

  *ct = (struct Clayterm){
      .w = w,
      .h = h,
      .front = (Cell *)base,
      .back = (Cell *)(base + cell_bytes),
      .out = {base + cell_bytes * 2, 0, cell_count * OUT_BYTES_PER_CELL},
      .lastfg = 0xffffffff,
      .lastbg = 0xffffffff,
      .lastx = -1,
      .lasty = -1,
  };

  // initialize back buffer with spaces and default fg/bg
  cells_fill(ct->back, w, h, ' ', ATTR_DEFAULT, ATTR_DEFAULT);

  // initialize front buffer with zeros. Every cell will be
  cells_fill(ct->front, w, h, 0, 0, 0);
  return ct;
}

void reduce(struct Clayterm *ct, uint32_t *buf, int len, int mode, int row,
            float deltaTime) {
  int i = 0;
  ct_active_context = ct;
  ct->error_count = 0;
  ct->animating_count = 0;
  ct->caret_text_chars = NULL;
  ct->caret_text_length = 0;
  ct->caret_offset = 0;
  ct->caret_x = -1;
  ct->caret_y = -1;
  ct->has_caret = 0;

  Clay_BeginLayout();

  while (i < len) {
    uint32_t op = rd(buf, len, &i);

    switch (op) {
    case OP_OPEN_ELEMENT: {
      /* read id string */
      uint32_t id_len = rd(buf, len, &i);
      int id_words = (id_len + 3) / 4;
      char *id_chars = (char *)&buf[i];
      i += id_words;

      if (id_len > 0) {
        Clay_String str = {.length = (int32_t)id_len, .chars = id_chars};
        Clay_ElementId eid = Clay__HashString(str, 0);
        Clay__OpenElementWithId(eid);
      } else {
        Clay__OpenElement();
      }

      /* read property mask */
      uint32_t mask = rd(buf, len, &i);
      Clay_ElementDeclaration decl = {0};

      if (mask & PROP_LAYOUT) {
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

      if (mask & PROP_BG_COLOR) {
        decl.backgroundColor = unpack_color(rd(buf, len, &i));
      }

      if (mask & PROP_CORNER_RADIUS) {
        uint32_t cr = rd(buf, len, &i);
        decl.cornerRadius.topLeft = (float)(cr & 0xff);
        decl.cornerRadius.topRight = (float)((cr >> 8) & 0xff);
        decl.cornerRadius.bottomLeft = (float)((cr >> 16) & 0xff);
        decl.cornerRadius.bottomRight = (float)((cr >> 24) & 0xff);
      }

      if (mask & PROP_BORDER) {
        uint32_t bw = rd(buf, len, &i);
        decl.border.width.left = bw & 0xff;
        decl.border.width.right = (bw >> 8) & 0xff;
        decl.border.width.top = (bw >> 16) & 0xff;
        decl.border.width.bottom = (bw >> 24) & 0xff;

        /* Resolved per-side fg/bg attribute words (top, right, bottom,
         * left). Routed to render_border via userData; the command buffer
         * remains valid for the whole render pass. */
        if (i + 8 <= len)
          decl.userData = (void *)&buf[i];
        i += 8;
      }

      if (mask & PROP_CLIP) {
        uint32_t cl = rd(buf, len, &i);
        decl.clip.horizontal = cl & 0xff;
        decl.clip.vertical = (cl >> 8) & 0xff;
      }

      if (mask & PROP_FLOATING) {
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

      if (mask & PROP_TRANSITION) {
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

      Clay__ConfigureOpenElement(decl);
      break;
    }

    case OP_TEXT: {
      uint32_t col = rd(buf, len, &i);
      uint32_t bg = rd(buf, len, &i);
      uint32_t cfg = rd(buf, len, &i);
      uint32_t caret = rd(buf, len, &i);
      uint32_t str_len = rd(buf, len, &i);
      int str_words = (str_len + 3) / 4;
      char *str_chars = (char *)&buf[i];
      i += str_words;

      /* Record the FIRST caret declaration per frame for the
       * single-hardware-cursor contract; later declarations are
       * intentionally ignored (multi-cursor is unspecified). */
      if (caret != 0xFFFFFFFF && ct->caret_text_chars == NULL) {
        ct->caret_text_chars = str_chars;
        ct->caret_text_length = (int)str_len;
        ct->caret_offset = caret;
        ct->has_caret = 1;
      }

      Clay_String text = {.length = (int32_t)str_len, .chars = str_chars};

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

    case OP_CLOSE_ELEMENT:
      Clay__CloseElement();
      break;

    default:
      break;
    }
  }

  Clay_RenderCommandArray cmds = Clay_EndLayout(deltaTime);

  /* resolve caret cell from this frame's text commands */
  locate_caret(ct, &cmds);

  /* reset output state */
  ct->out.length = 0;
  ct->lastfg = ct->lastbg = 0xffffffff;
  ct->lastx = ct->lasty = -1;
  ct->clipdepth = 0;
  ct->clipoverflow = 0;
  ct->clip_depth_exceeded = 0;
  ct->clipping = 0;

  cells_fill(ct->back, ct->w, ct->h, ' ', ATTR_DEFAULT, ATTR_DEFAULT);

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
      if (ct->clipdepth > 0) {
        ClipRect top = ct->clipstack[ct->clipdepth - 1];
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
      if (ct->clipdepth < CLIP_STACK_MAX) {
        ClipRect r = {nx0, ny0, nw, nh};
        ct->clipstack[ct->clipdepth++] = r;
        ct->clipping = 1;
        ct->clipx = nx0;
        ct->clipy = ny0;
        ct->clipw = nw;
        ct->cliph = nh;
      } else {
        /* Out of tracked slots: coalesce this level into the deepest tracked
         * region (leave the active rect untouched) and remember to pop it
         * without disturbing the tracked stack. */
        ct->clipoverflow++;
        report_clip_depth_exceeded(ct);
      }
      break;
    }
    case CLAY_RENDER_COMMAND_TYPE_SCISSOR_END:
      if (ct->clipoverflow > 0) {
        /* Closing an untracked level: nothing was pushed, so leave the tracked
         * stack and active rect alone. */
        ct->clipoverflow--;
        break;
      }
      if (ct->clipdepth > 0)
        ct->clipdepth--;
      if (ct->clipdepth > 0) {
        ClipRect top = ct->clipstack[ct->clipdepth - 1];
        ct->clipping = 1;
        ct->clipx = top.x;
        ct->clipy = top.y;
        ct->clipw = top.w;
        ct->cliph = top.h;
      } else {
        ct->clipping = 0;
      }
      break;
    default:
      break;
    }
  }

  if (mode == 1) {
    present_lines(ct);
  } else {
    present_cups(ct, row);
  }

  ct_active_context = NULL;
}

char *output(struct Clayterm *ct) { return ct->out.data; }

int length(struct Clayterm *ct) { return ct->out.length; }

int animating(struct Clayterm *ct) { return ct->animating_count; }

int get_element_bounds(const char *name, int name_len, float *out) {
  Clay_String str = {.length = name_len, .chars = name};
  Clay_ElementId eid = Clay__HashString(str, 0);
  Clay_ElementData data = Clay_GetElementData(eid);
  if (!data.found) {
    return 0;
  }
  out[0] = data.boundingBox.x;
  out[1] = data.boundingBox.y;
  out[2] = data.boundingBox.width;
  out[3] = data.boundingBox.height;
  return 1;
}

int pointer_over_count(void) { return Clay_GetPointerOverIds().length; }

int pointer_over_id_string_length(int index) {
  Clay_ElementIdArray ids = Clay_GetPointerOverIds();
  if (index >= ids.length)
    return 0;
  return ids.internalArray[index].stringId.length;
}

int pointer_over_id_string_ptr(int index) {
  Clay_ElementIdArray ids = Clay_GetPointerOverIds();
  if (index >= ids.length)
    return 0;
  return (int)ids.internalArray[index].stringId.chars;
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
    }
    int cw = wcwidth(cp);
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
