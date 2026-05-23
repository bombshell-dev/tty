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
#include "../clay/clay.h"
#include "buffer.h"
#include "cell.h"
#include "mem.h"
#include "utf8.h"
#include "wcwidth.h"

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

/* ── Instance state ───────────────────────────────────────────────── */

#define MAX_ERRORS 32
#define MAX_SCROLL_DELTAS 16

struct ScrollDelta {
  uint32_t id;
  float dx, dy;
};

struct Clayterm {
  int w, h;
  Cell *front;
  Cell *back;
  Buffer out;
  uint32_t lastfg, lastbg;
  int lastx, lasty;
  /* clip region */
  int clipx, clipy, clipw, cliph;
  int clipping;
  /* error collection */
  Clay_ErrorData errors[MAX_ERRORS];
  int error_count;
  /* scroll delta reporting */
  struct ScrollDelta scroll_deltas[MAX_SCROLL_DELTAS];
  int scroll_delta_count;
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

static void render_text(struct Clayterm *ct, int x0, int y0,
                        Clay_TextRenderData *t) {
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
      setcell(ct, x, y0, cp, fg, ATTR_DEFAULT);
      x += cw;
    }
    p += n;
    rem -= n;
  }
}

static void render_border(struct Clayterm *ct, int x0, int y0, int x1, int y1,
                          Clay_BorderRenderData *b) {
  uint32_t fg = color(b->color);
  uint32_t bg = ATTR_DEFAULT;
  int top = b->width.top > 0;
  int bot = b->width.bottom > 0;
  int left = b->width.left > 0;
  int right = b->width.right > 0;

  /* corners — rounded when corner radius > 0 */
  uint32_t tl = b->cornerRadius.topLeft > 0 ? 0x256d : 0x250c;
  uint32_t tr = b->cornerRadius.topRight > 0 ? 0x256e : 0x2510;
  uint32_t bl = b->cornerRadius.bottomLeft > 0 ? 0x2570 : 0x2514;
  uint32_t br = b->cornerRadius.bottomRight > 0 ? 0x256f : 0x2518;

  if (top && left)
    setcell(ct, x0, y0, tl, fg, bg);
  if (top && right)
    setcell(ct, x1 - 1, y0, tr, fg, bg);
  if (bot && left)
    setcell(ct, x0, y1 - 1, bl, fg, bg);
  if (bot && right)
    setcell(ct, x1 - 1, y1 - 1, br, fg, bg);

  /* horizontal edges */
  if (top)
    for (int x = x0 + left; x < x1 - right; x++)
      setcell(ct, x, y0, 0x2500, fg, bg);
  if (bot)
    for (int x = x0 + left; x < x1 - right; x++)
      setcell(ct, x, y1 - 1, 0x2500, fg, bg);

  /* vertical edges */
  if (left)
    for (int y = y0 + top; y < y1 - bot; y++)
      setcell(ct, x0, y, 0x2502, fg, bg);
  if (right)
    for (int y = y0 + top; y < y1 - bot; y++)
      setcell(ct, x1 - 1, y, 0x2502, fg, bg);
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

void reduce(struct Clayterm *ct, uint32_t *buf, int len, int mode, int row) {
  int i = 0;
  ct->error_count = 0;
  ct->scroll_delta_count = 0;

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
        decl.border.color = unpack_color(rd(buf, len, &i));

        uint32_t bw = rd(buf, len, &i);
        decl.border.width.left = bw & 0xff;
        decl.border.width.right = (bw >> 8) & 0xff;
        decl.border.width.top = (bw >> 16) & 0xff;
        decl.border.width.bottom = (bw >> 24) & 0xff;
      }

      int clip_xmode = 0, clip_ymode = 0;
      float clip_mx = 0, clip_my = 0;
      if (mask & PROP_CLIP) {
        uint32_t cl = rd(buf, len, &i);
        clip_xmode = cl & 0xff;
        clip_ymode = (cl >> 8) & 0xff;
        decl.clip.horizontal = (clip_xmode != 0);
        decl.clip.vertical = (clip_ymode != 0);
        if (clip_xmode)
          clip_mx = rdf(buf, len, &i);
        if (clip_ymode)
          clip_my = rdf(buf, len, &i);
        decl.clip.childOffset.x = clip_mx;
        decl.clip.childOffset.y = clip_my;
      }

      if (mask & PROP_FLOATING) {
        decl.floating.offset.x = rdf(buf, len, &i);
        decl.floating.offset.y = rdf(buf, len, &i);
        decl.floating.parentId = rd(buf, len, &i);

        uint32_t fc = rd(buf, len, &i);
        decl.floating.attachTo = fc & 0xff;
        decl.floating.attachPoints.element = (fc >> 8) & 0xff;
        decl.floating.attachPoints.parent = (fc >> 16) & 0xff;
        decl.floating.zIndex = (int16_t)((fc >> 24) & 0xff);
      }

      Clay__ConfigureOpenElement(decl);

      if ((clip_xmode || clip_ymode) && id_len > 0) {
        Clay_String str = {.length = (int32_t)id_len, .chars = id_chars};
        Clay_ElementId eid2 = Clay__HashString(str, 0);
        Clay_ScrollContainerData sc = Clay_GetScrollContainerData(eid2);
        if (sc.found && sc.scrollPosition) {
          float dx = sc.scrollPosition->x - clip_mx;
          float dy = sc.scrollPosition->y - clip_my;
          if ((dx != 0 || dy != 0) &&
              ct->scroll_delta_count < MAX_SCROLL_DELTAS) {
            ct->scroll_deltas[ct->scroll_delta_count++] =
                (struct ScrollDelta){.id = eid2.id, .dx = dx, .dy = dy};
          }
          if (clip_xmode)
            sc.scrollPosition->x = clip_mx;
          if (clip_ymode)
            sc.scrollPosition->y = clip_my;
        }
      }
      break;
    }

    case OP_TEXT: {
      uint32_t col = rd(buf, len, &i);
      uint32_t cfg = rd(buf, len, &i);
      uint32_t str_len = rd(buf, len, &i);
      int str_words = (str_len + 3) / 4;
      char *str_chars = (char *)&buf[i];
      i += str_words;

      Clay_String text = {.length = (int32_t)str_len, .chars = str_chars};

      Clay_TextElementConfig config = {0};
      config.textColor = unpack_color(col);
      config.fontSize = cfg & 0xff;
      config.fontId = (cfg >> 8) & 0xff;
      config.wrapMode = (cfg >> 16) & 0xff;
      /* attrs byte -> alpha channel for render_text to extract */
      config.textColor.a = (float)((cfg >> 24) & 0xff);

      Clay__OpenTextElement(text, Clay__StoreTextElementConfig(config));
      break;
    }

    case OP_CLOSE_ELEMENT:
      Clay__CloseElement();
      break;

    default:
      break;
    }
  }

  Clay_RenderCommandArray cmds = Clay_EndLayout();

  /* reset output state */
  ct->out.length = 0;
  ct->lastfg = ct->lastbg = 0xffffffff;
  ct->lastx = ct->lasty = -1;

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
      render_text(ct, x0, y0, &cmd->renderData.text);
      break;
    case CLAY_RENDER_COMMAND_TYPE_BORDER:
      render_border(ct, x0, y0, x1, y1, &cmd->renderData.border);
      break;
    case CLAY_RENDER_COMMAND_TYPE_SCISSOR_START:
      ct->clipping = 1;
      ct->clipx = x0;
      ct->clipy = y0;
      ct->clipw = x1 - x0;
      ct->cliph = y1 - y0;
      break;
    case CLAY_RENDER_COMMAND_TYPE_SCISSOR_END:
      ct->clipping = 0;
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
}

char *output(struct Clayterm *ct) { return ct->out.data; }

int length(struct Clayterm *ct) { return ct->out.length; }

int get_scroll_delta(struct Clayterm *ct, const char *name, int name_len,
                     float *out) {
  Clay_String str = {.length = name_len, .chars = name};
  Clay_ElementId eid = Clay__HashString(str, 0);
  for (int j = 0; j < ct->scroll_delta_count; j++) {
    if (ct->scroll_deltas[j].id == eid.id) {
      out[0] = ct->scroll_deltas[j].dx;
      out[1] = ct->scroll_deltas[j].dy;
      return 1;
    }
  }
  out[0] = 0;
  out[1] = 0;
  return 0;
}

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
