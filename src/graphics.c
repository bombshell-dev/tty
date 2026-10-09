/* graphics.c — pixel-surface registry and tier engine
 *
 * Implements the Graphics Specification's substrate: the surface registry
 * (§5.3), the tier engine (§9), and the cell-buffer integration phases
 * (§10). Included AFTER clayterm.c in module.c so the Clayterm struct
 * definition is visible.
 *
 * No heap: every structure is fixed-capacity, carved once at Term creation
 * and never grown, moved, or freed at runtime (§5.1). Reclamation of pixel
 * bytes happens only by compaction of the pool.
 */

#include "graphics.h"

#include "buffer.h"
#include "cell.h"
#include "mem.h"
#include "shape_vectors.h"

#include "../clay/clay.h"

/* Contrast exponents (§9.3.4): baked calibration constants, pinned as
 * integer powers of two so the enhancement is exact repeated squaring —
 * bit-identical on every host, with no floating-point library. */
#define GAMMA_D 4.0f
#define GAMMA_G 2.0f

/* ── Wire helpers ─────────────────────────────────────────────────── */

static void buf_u32(Buffer *b, uint32_t v) {
  char tmp[10];
  int n = 0;
  do {
    tmp[n++] = (char)('0' + (v % 10));
    v /= 10;
  } while (v > 0);
  char out[10];
  for (int i = 0; i < n; i++) {
    out[i] = tmp[n - 1 - i];
  }
  buf_put(b, out, n);
}

static const char B64_ALPHABET[64] = {
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '/',
};

/* Encode src[0..len) as base64 into dst; returns the character count
 * (ceil(len/3)*4, '=' padded — RFC 4648). dst needs that much room. */
static uint32_t b64_encode(const char *src, uint32_t len, char *dst) {
  uint32_t o = 0;
  uint32_t i = 0;
  while (i + 3 <= len) {
    uint32_t v = ((uint8_t)src[i] << 16) | ((uint8_t)src[i + 1] << 8) |
                 (uint8_t)src[i + 2];
    dst[o++] = B64_ALPHABET[(v >> 18) & 63];
    dst[o++] = B64_ALPHABET[(v >> 12) & 63];
    dst[o++] = B64_ALPHABET[(v >> 6) & 63];
    dst[o++] = B64_ALPHABET[v & 63];
    i += 3;
  }
  uint32_t rem = len - i;
  if (rem == 1) {
    uint32_t v = (uint8_t)src[i] << 16;
    dst[o++] = B64_ALPHABET[(v >> 18) & 63];
    dst[o++] = B64_ALPHABET[(v >> 12) & 63];
    dst[o++] = '=';
    dst[o++] = '=';
  } else if (rem == 2) {
    uint32_t v = ((uint8_t)src[i] << 16) | ((uint8_t)src[i + 1] << 8);
    dst[o++] = B64_ALPHABET[(v >> 18) & 63];
    dst[o++] = B64_ALPHABET[(v >> 12) & 63];
    dst[o++] = B64_ALPHABET[(v >> 6) & 63];
    dst[o++] = '=';
  }
  return o;
}

/* ── Kitty control-block emission (§9.2) ──────────────────────────── */

/* Every emitted control block sets q=2 (INV-I5): no acknowledgment and no
 * failure response can reach the input parser. */

static void kitty_delete_image(struct Clayterm *ct, uint32_t wire_id) {
  /* data-freeing form: deletes the image, all its placements, and the
   * terminal's stored copy (Graphics Specification §7.2) */
  buf_str(&ct->out, "\x1b_Ga=d,d=I,i=");
  buf_u32(&ct->out, wire_id);
  buf_str(&ct->out, ",q=2\x1b\\");
}

static void kitty_delete_placement(struct Clayterm *ct, uint32_t wire_id,
                                   uint32_t placement_id) {
  /* scoped lowercase form: deletes one placement, retains stored data
   * (Graphics Specification §9.2.5) */
  buf_str(&ct->out, "\x1b_Ga=d,d=i,i=");
  buf_u32(&ct->out, wire_id);
  buf_str(&ct->out, ",p=");
  buf_u32(&ct->out, placement_id);
  buf_str(&ct->out, ",q=2\x1b\\");
}

static void kitty_place(struct Clayterm *ct, uint32_t wire_id,
                        uint32_t placement_id, int cols, int rows) {
  buf_str(&ct->out, "\x1b_Ga=p,i=");
  buf_u32(&ct->out, wire_id);
  buf_str(&ct->out, ",p=");
  buf_u32(&ct->out, placement_id);
  buf_str(&ct->out, ",c=");
  buf_u32(&ct->out, (uint32_t)cols);
  buf_str(&ct->out, ",r=");
  buf_u32(&ct->out, (uint32_t)rows);
  buf_str(&ct->out, ",C=1,q=2\x1b\\");
}

/* Transmit a surface's pixels: lazy (first placement), chunked per the
 * protocol, delete-before-re-transmit (§9.2.2). */
static void kitty_transmit(struct Clayterm *ct, struct ImageEntry *e) {
  if (e->transmitted_version != 0) {
    /* the image exists terminal-side: the protocol requires the existing
     * image and all its placements to be deleted before re-transmission */
    kitty_delete_image(ct, e->id);
  }
  const char *src = ct->gfx->pool + e->pool_offset;
  uint32_t len = e->byte_len;
  char chunk[IMG_CHUNK_CHARS];
  uint32_t off = 0;
  while (off < len) {
    uint32_t take = len - off;
    if (take > IMG_CHUNK_SRC) {
      take = IMG_CHUNK_SRC;
    }
    uint32_t chars = b64_encode(src + off, take, chunk);
    int last = (off + take >= len);
    buf_str(&ct->out, "\x1b_G");
    if (off == 0) {
      buf_str(&ct->out, "a=t,t=d,f=32,i=");
      buf_u32(&ct->out, e->id);
      buf_str(&ct->out, ",s=");
      buf_u32(&ct->out, e->width);
      buf_str(&ct->out, ",v=");
      buf_u32(&ct->out, e->height);
    }
    buf_str(&ct->out, last ? ",m=0,q=2;" : ",m=1,q=2;");
    buf_put(&ct->out, chunk, (int)chars);
    buf_str(&ct->out, "\x1b\\");
    off += take;
  }
  e->transmitted_version = e->data_version;
}

/* ── Placement-id derivation (§9.2.1/§15; pinned, golden-locked) ──── */

uint32_t graphics_placement_id(const char *id_chars, uint32_t id_len,
                               uint32_t registry_id) {
  uint32_t h = 2166136261u;
  for (uint32_t i = 0; i < id_len; i++) {
    h ^= (uint8_t)id_chars[i];
    h *= 16777619u;
  }
  h ^= 0x3A; /* ':' separator */
  h *= 16777619u;
  char dec[10];
  int n = 0;
  uint32_t v = registry_id;
  do {
    dec[n++] = (char)('0' + (v % 10));
    v /= 10;
  } while (v > 0);
  for (int i = 0; i < n; i++) {
    h ^= (uint8_t)dec[n - 1 - i];
    h *= 16777619u;
  }
  return h == 0 ? 1u : h;
}

/* ── Footprint math (§8.2) ────────────────────────────────────────── */

static int round_pos(float f) { return (int)(f + 0.5f); }

/* Freestanding floor/ceil (no libm): exact for the small magnitudes the
 * sampling math produces. */
static int ifloor(float f) {
  int i = (int)f;
  return i > f ? i - 1 : i;
}

static int iceil(float f) {
  int i = (int)f;
  return i < f ? i + 1 : i;
}

/* Contain-fit region of a W×H source inside a boxW×boxH cell box under the
 * half-row pixel convention (A = 2), centered both axes. Empty when the
 * constrained solve rounds either dimension to zero. */
struct ImagePlacement graphics_contain_fit(int boxX, int boxY, int boxW,
                                           int boxH, uint32_t W, uint32_t H) {
  struct ImagePlacement fp = {0};
  if (boxW <= 0 || boxH <= 0 || W == 0 || H == 0) {
    return fp;
  }
  int64_t cols = (int64_t)boxH * 2 * (int64_t)W / (int64_t)H;
  if (cols > boxW) {
    cols = boxW;
  }
  if (cols < 0) {
    cols = 0;
  }
  int64_t rows = ((int64_t)cols * (int64_t)H + (int64_t)W) / ((int64_t)2 * W);
  if (rows > boxH) {
    rows = boxH;
  }
  if (cols <= 0 || rows <= 0) {
    return fp; /* empty footprint paints nothing (§8.2) */
  }
  fp.x = boxX + (boxW - (int)cols) / 2;
  fp.y = boxY + (boxH - (int)rows) / 2;
  fp.w = (int)cols;
  fp.h = (int)rows;
  return fp;
}

/* ── Carve (§5.2) ─────────────────────────────────────────────────── */

int graphics_size(int pool_bytes) {
  if (pool_bytes <= 0) {
    pool_bytes = 4194304;
  }
  int tables = 2 * PLACEMENT_CAP * (int)sizeof(struct ImagePlacement);
  return align64((int)sizeof(struct Graphics)) + align64(pool_bytes) +
         align8(tables);
}

struct Graphics *graphics_init(void *mem, int pool_bytes) {
  if (pool_bytes <= 0) {
    pool_bytes = 4194304;
  }
  struct Graphics *g = (struct Graphics *)mem;
  char *base = (char *)mem + align64((int)sizeof(struct Graphics));
  int table_bytes = PLACEMENT_CAP * (int)sizeof(struct ImagePlacement);
  *g = (struct Graphics){
      .pool = base,
      .pool_bytes = (uint32_t)pool_bytes,
      .pool_bump = 0,
      .placements_front = (struct ImagePlacement *)(base + align64(pool_bytes)),
      .placements_back =
          (struct ImagePlacement *)(base + align64(pool_bytes) + table_bytes),
  };
  return g;
}

/* ── Registry (§5.3) ──────────────────────────────────────────────── */

struct ImageEntry *graphics_entry(struct Graphics *g, uint32_t id) {
  for (int i = 0; i < IMAGE_ENTRY_CAP; i++) {
    struct ImageEntry *e = &g->entries[i];
    if (e->live && e->id == id) {
      return e;
    }
  }
  return NULL;
}

static struct ImageEntry *entry_free_slot(struct Graphics *g) {
  for (int i = 0; i < IMAGE_ENTRY_CAP; i++) {
    if (!g->entries[i].live && g->entries[i].id == 0) {
      return &g->entries[i];
    }
  }
  return NULL;
}

/* Compact the pool: copy live payloads to the pool start in offset order,
 * rewrite the entries' offsets, reset the bump pointer (§5.3). */
static void pool_compact(struct Graphics *g) {
  uint32_t o = 0;
  for (int i = 0; i < IMAGE_ENTRY_CAP; i++) {
    struct ImageEntry *e = &g->entries[i];
    if (!e->live) {
      continue;
    }
    if (e->pool_offset != o) {
      memmove(g->pool + o, g->pool + e->pool_offset, e->byte_len);
      e->pool_offset = o;
    }
    o += e->byte_len;
  }
  g->pool_bump = o;
}

/* Reserve extent for a (re)set; dead extents from replaced entries are
 * reclaimed only by compaction (§5.3). Returns the offset, or a negative
 * enum img_err code. */
static int32_t pool_reserve(struct Graphics *g, uint32_t needed) {
  if ((uint64_t)g->pool_bump + needed <= g->pool_bytes) {
    int32_t off = (int32_t)g->pool_bump;
    g->pool_bump += needed;
    return off;
  }
  pool_compact(g);
  if ((uint64_t)g->pool_bump + needed > g->pool_bytes) {
    return -IMG_ERR_POOL;
  }
  int32_t off = (int32_t)g->pool_bump;
  g->pool_bump += needed;
  return off;
}

int image_begin(struct Clayterm *ct, uint32_t id, uint32_t w, uint32_t h) {
  struct Graphics *g = ct->gfx;
  if (id == 0) {
    return -IMG_ERR_ID; /* the protocol forbids zero image ids (§6.2) */
  }
  if (w == 0 || h == 0) {
    return -IMG_ERR_DIMS;
  }
  uint64_t needed = (uint64_t)w * h * 4;
  if (needed > (uint64_t)g->pool_bytes) {
    return -IMG_ERR_POOL;
  }
  struct ImageEntry *e = graphics_entry(g, id);
  if (e == NULL) {
    e = entry_free_slot(g);
    if (e == NULL) {
      return -IMG_ERR_TABLE;
    }
    e->id = id;
  }
  uint32_t rel;
  if (e->live && needed <= e->byte_len) {
    /* same-size (or shrinking) replace writes in place: the old data is
     * being overwritten atomically with the caller's copy — no observer
     * can run between begin and commit (single transaction, single
     * thread). Video's same-size-per-frame path allocates nothing. */
    e->width = w;
    e->height = h;
    e->byte_len = (uint32_t)needed;
    rel = e->pool_offset;
  } else {
    int32_t off = pool_reserve(g, (uint32_t)needed);
    if (off < 0) {
      return off;
    }
    e->width = w;
    e->height = h;
    e->byte_len = (uint32_t)needed;
    e->pool_offset = (uint32_t)off;
    e->live = 1;
    rel = (uint32_t)off;
  }
  /* the host writes pixels directly: return the absolute address of the
   * reserved extent (pool-relative offsets are a C-side detail) */
  return (int32_t)(int32_t *)(uintptr_t)(g->pool + rel);
}

int image_commit(struct Clayterm *ct, uint32_t id) {
  struct ImageEntry *e = graphics_entry(ct->gfx, id);
  if (e == NULL || !e->live) {
    return -IMG_ERR_UNKNOWN;
  }
  e->data_version++;
  return IMG_OK;
}

/* ── Blank-state reconciliation (§7.2/§10.1/§11.2) ────────────────── */

/* Rewrite a front-table record's cells to their covered-cell value: the
 * state the terminal shows once the pixels are gone (the blank bytes
 * written when coverage appeared). Whole-struct writes so stale combining
 * marks cannot survive (#114's Cell carries them). */
static void reconcile_blank(struct Clayterm *ct, struct ImagePlacement *p) {
  for (int y = p->y; y < p->y + p->h; y++) {
    for (int x = p->x; x < p->x + p->w; x++) {
      if (x < 0 || x >= ct->w || y < 0 || y >= ct->h) {
        continue;
      }
      Cell *c = cell_at(ct, ct->front, x, y);
      /* the ATTR_DEFAULT sentinel keeps the cell's existing background —
       * the blank write that appeared under the graphic omitted bg, so
       * the pre-coverage background is the blank state (§10.1) */
      uint32_t bg =
          (p->blank_bg & ATTR_DEFAULT) ? c->bg : (p->blank_bg & COLOR_MASK);
      *c = (Cell){.ch = ' ', .fg = ATTR_DEFAULT, .bg = bg};
    }
  }
}

/* Dirty-mark a region: force the next diff to emit it (§10.4). */
static void dirty_mark(struct Clayterm *ct, int x, int y, int w, int h) {
  for (int yy = y; yy < y + h; yy++) {
    for (int xx = x; xx < x + w; xx++) {
      if (xx < 0 || xx >= ct->w || yy < 0 || yy >= ct->h) {
        continue;
      }
      *cell_at(ct, ct->front, xx, yy) = (Cell){0};
    }
  }
}

/* ── Removal, denial, resize (§7.2/§11.2/§10.5) ───────────────────── */

/* Deletion bytes for every image with live front placements (one d=I per
 * registry id, deduplicated), transmission-state reset, table clear, and
 * cell reconciliation. Shared by removeImage (scoped to one id), denial,
 * and resize (all images). Returns bytes written. */
static int emit_deletions_and_clear(struct Clayterm *ct, uint32_t only_id) {
  struct Graphics *g = ct->gfx;
  int wrote = 0;
  int seen[IMAGE_ENTRY_CAP];
  int seen_count = 0;
  for (int i = 0; i < PLACEMENT_CAP; i++) {
    struct ImagePlacement *p = &g->placements_front[i];
    if (!p->used) {
      continue;
    }
    if (only_id != 0 && p->registry_id != only_id) {
      continue;
    }
    int seen_already = 0;
    for (int k = 0; k < seen_count; k++) {
      if (seen[k] == (int)p->registry_id) {
        seen_already = 1;
        break;
      }
    }
    if (seen_already) {
      continue;
    }
    if (seen_count < IMAGE_ENTRY_CAP) {
      seen[seen_count++] = (int)p->registry_id;
    }
    kitty_delete_image(ct, p->registry_id);
    struct ImageEntry *e = graphics_entry(g, p->registry_id);
    if (e != NULL) {
      e->transmitted_version = 0; /* never trust persisted data (§9.2.2) */
    }
    wrote = 1;
  }
  /* reconcile + clear: both tables die with their placements */
  for (int i = 0; i < PLACEMENT_CAP; i++) {
    struct ImagePlacement *p = &g->placements_front[i];
    if (p->used && (only_id == 0 || p->registry_id == only_id)) {
      reconcile_blank(ct, p);
      p->used = 0;
    }
    g->placements_back[i].used = 0;
  }
  g->placement_count = 0;
  return wrote;
}

int image_remove(struct Clayterm *ct, uint32_t id) {
  struct Graphics *g = ct->gfx;
  struct ImageEntry *e = graphics_entry(g, id);
  if (e == NULL || !e->live) {
    return -IMG_ERR_UNKNOWN;
  }
  /* bytes whenever the id was live (§7.2), regardless of evidence */
  ct->out.length = 0;
  emit_deletions_and_clear(ct, id);
  e->live = 0;
  e->id = 0; /* frees the slot for entry_free_slot */
  return ct->out.length;
}

void graphics_capability(struct Clayterm *ct, int kitty_graphics) {
  struct Graphics *g = ct->gfx;
  int was = g->kitty_graphics;
  g->kitty_graphics = (uint8_t)(kitty_graphics != 0);
  if (was && !g->kitty_graphics) {
    /* denial (§11.2): immediate deletion bytes (TINV-5) */
    ct->out.length = 0;
    emit_deletions_and_clear(ct, 0);
  }
}

int graphics_resize_prepare(struct Clayterm *ct) {
  ct->out.length = 0;
  emit_deletions_and_clear(ct, 0);
  return ct->out.length;
}

/* ── Frame hooks (§5.4) ───────────────────────────────────────────── */

void graphics_frame_begin(struct Graphics *g) {
  for (int i = 0; i < PLACEMENT_CAP; i++) {
    g->placements_back[i].used = 0;
  }
  g->placement_count = 0;
}

void graphics_frame_end(struct Graphics *g) {
  struct ImagePlacement *tmp = g->placements_front;
  g->placements_front = g->placements_back;
  g->placements_back = tmp;
}

/* ── Tier resolution (§9.1) ───────────────────────────────────────── */

/* Pre-layout resolution: everything it reads is stable within a frame.
 * The containment/overlap/capacity demotions of §8.5/§10.3 happen later,
 * at the render-command walk, and can only lower kitty→ascii — the same
 * painted footprint — so the sizing decision made here stays valid. */
uint8_t graphics_resolve_tier(struct Clayterm *ct, uint32_t registry_id,
                              uint8_t variant, int mode) {
  if (registry_id == 0 || variant == IMG_VARIANT_ALT) {
    return IMG_TIER_ALT;
  }
  struct ImageEntry *e = graphics_entry(ct->gfx, registry_id);
  if (e == NULL || !e->live) {
    return IMG_TIER_ALT; /* IMAGE_NOT_FOUND surfaced by the caller (§13) */
  }
  if (variant == IMG_VARIANT_ASCII) {
    return IMG_TIER_ASCII;
  }
  int kitty_ok = ct->gfx->kitty_graphics && mode == 0;
  if (variant == IMG_VARIANT_AUTO || variant == IMG_VARIANT_KITTY) {
    if (kitty_ok) {
      return IMG_TIER_KITTY;
    }
  }
  return IMG_TIER_ASCII;
}

/* ── ASCII tier (§9.3) ────────────────────────────────────────────── */

/* Sampling-circle geometry: cell-relative fractions; calibration constants
 * locked by golden tests (§9.3.2). Six internal circles in two staggered
 * columns (left lowered, right raised, radii enlarged); ten external
 * circles reaching into neighboring cells. The ordering must match
 * tasks/gen-shape-vectors.ts and the §9.3.4 affecting table. */
static const float CIRCLE_R = 0.34f;
static const float INTERNAL[6][2] = {
    {0.30f, 0.24f}, {0.70f, 0.12f}, /* top pair    */
    {0.30f, 0.56f}, {0.70f, 0.44f}, /* middle pair */
    {0.30f, 0.88f}, {0.70f, 0.76f}, /* bottom pair */
};
static const float EXTERNAL[10][2] = {
    {0.40f, -0.28f}, {0.85f, -0.12f}, /* above       */
    {-0.10f, 0.30f}, {1.10f, 0.18f},  /* upper sides */
    {-0.12f, 0.62f}, {1.12f, 0.50f},  /* lower sides */
    {-0.08f, 0.88f}, {1.08f, 0.80f},  /* bottom sides */
    {0.40f, 1.28f},  {0.85f, 1.16f},  /* below       */
};
/* internal k ← externals (§9.3.4, closed) */
static const uint8_t AFFECTING[6] = {4, 4, 3, 3, 4, 4};
static const uint8_t AFFECTING_SET[6][4] = {
    {0, 1, 2, 4}, {0, 1, 3, 5}, {2, 4, 6},
    {3, 5, 7},    {4, 6, 8, 9}, {5, 7, 8, 9},
};

/* Luma of one pixel, [0,1]. */
static float luma_px(const char *px) {
  return (0.2126f * (uint8_t)px[0] + 0.7152f * (uint8_t)px[1] +
          0.0722f * (uint8_t)px[2]) /
         255.0f;
}

/* Mean luma of the source pixels whose cell-space (u,v) falls inside the
 * circle at (cu, cv). Pixels outside the source image are excluded. When
 * no pixel center falls inside, the rectangle's mean lightness is the
 * component (degenerate footprints; §9.3.1). */
static float circle_luma(const struct Clayterm *ct, const struct ImageEntry *e,
                         int x0, int y0, int x1, int y1, float cu, float cv) {
  float rw = (float)(x1 - x0);
  float rh = (float)(y1 - y0);
  float sum = 0.0f;
  int count = 0;
  float rect_sum = 0.0f;
  int rect_count = 0;
  /* iterate the circle's source-plane bounding box, clamped to the image */
  int lox = x0 + ifloor((cu - CIRCLE_R) * rw);
  int hix = x0 + iceil((cu + CIRCLE_R) * rw);
  int loy = y0 + ifloor((cv - CIRCLE_R) * rh);
  int hiy = y0 + iceil((cv + CIRCLE_R) * rh);
  if (lox < 0) {
    lox = 0;
  }
  if (loy < 0) {
    loy = 0;
  }
  if (hix > (int)e->width) {
    hix = (int)e->width;
  }
  if (hiy > (int)e->height) {
    hiy = (int)e->height;
  }
  const char *base = ct->gfx->pool + e->pool_offset;
  for (int py = loy; py < hiy; py++) {
    for (int px = lox; px < hix; px++) {
      float u = (rw > 0) ? ((float)px + 0.5f - (float)x0) / rw : 0.5f;
      float v = (rh > 0) ? ((float)py + 0.5f - (float)y0) / rh : 0.5f;
      float dx = u - cu;
      float dy = v - cv;
      float y = luma_px(base + ((uint32_t)py * e->width + px) * 4);
      rect_sum += y;
      rect_count++;
      if (dx * dx + dy * dy <= CIRCLE_R * CIRCLE_R) {
        sum += y;
        count++;
      }
    }
  }
  if (count > 0) {
    return sum / (float)count;
  }
  return rect_count > 0 ? rect_sum / (float)rect_count : 0.0f;
}

/* Contrast enhancement (§9.3.4): directional, then global. The exponents
 * are integer powers of two, so (x)^γ is exact repeated squaring — no
 * floating-point library, bit-identical everywhere. */
static void contrast_enhance(float *v, const float *ext) {
  for (int k = 0; k < 6; k++) {
    float m = v[k];
    for (int j = 0; j < AFFECTING[k]; j++) {
      if (ext[AFFECTING_SET[k][j]] > m) {
        m = ext[AFFECTING_SET[k][j]];
      }
    }
    if (m > 0) {
      float t = v[k] / m;
      t *= t; /* ^2 */
      t *= t; /* ^4 = GAMMA_D */
      v[k] = t * m;
    } else {
      v[k] = 0;
    }
  }
  float M = 0;
  for (int k = 0; k < 6; k++) {
    if (v[k] > M) {
      M = v[k];
    }
  }
  if (M > 0) {
    for (int k = 0; k < 6; k++) {
      float t = v[k] / M;
      t *= t; /* ^2 = GAMMA_G */
      v[k] = t * M;
    }
  } else {
    for (int k = 0; k < 6; k++) {
      v[k] = 0;
    }
  }
}

/* Paint the footprint's cells as character art (§9.3). Ordinary cells:
 * opaque cells carry the color sample as foreground and leave the
 * background untouched; transparent cells (alpha sample < 128) are blank
 * spaces keeping the background. */
void graphics_paint_ascii(struct Clayterm *ct, const struct ImageEntry *e,
                          const struct ImagePlacement *fp) {
  const char *base = ct->gfx->pool + e->pool_offset;
  uint32_t W = e->width;
  uint32_t H = e->height;
  for (int cy = 0; cy < fp->h; cy++) {
    for (int cx = 0; cx < fp->w; cx++) {
      int x0 = (int)(round_pos((float)cx * (float)W / (float)fp->w));
      int y0 = (int)(round_pos((float)cy * (float)H / (float)fp->h));
      int x1 = (int)(round_pos((float)(cx + 1) * (float)W / (float)fp->w));
      int y1 = (int)(round_pos((float)(cy + 1) * (float)H / (float)fp->h));
      if (x1 <= x0 || y1 <= y0) {
        /* empty rectangle: the single pixel at the start, clamped (§9.3.1) */
        x1 = x0 + 1;
        y1 = y0 + 1;
        if (x1 > (int)W) {
          x1 = (int)W;
        }
        if (y1 > (int)H) {
          y1 = (int)H;
        }
      }
      float v[6];
      float ext[10];
      for (int k = 0; k < 6; k++) {
        v[k] =
            circle_luma(ct, e, x0, y0, x1, y1, INTERNAL[k][0], INTERNAL[k][1]);
      }
      for (int k = 0; k < 10; k++) {
        ext[k] =
            circle_luma(ct, e, x0, y0, x1, y1, EXTERNAL[k][0], EXTERNAL[k][1]);
      }
      contrast_enhance(v, ext);

      /* color + alpha samples: per-channel means over the rectangle */
      float mr = 0, mg = 0, mb = 0, ma = 0;
      for (int py = y0; py < y1; py++) {
        for (int px = x0; px < x1; px++) {
          const char *px4 = base + ((uint32_t)py * W + px) * 4;
          mr += (uint8_t)px4[0];
          mg += (uint8_t)px4[1];
          mb += (uint8_t)px4[2];
          ma += (uint8_t)px4[3];
        }
      }
      int n = (x1 - x0) * (y1 - y0);
      mr /= n;
      mg /= n;
      mb /= n;
      ma /= n;

      if (ma < 128.0f) {
        setcell(ct, fp->x + cx, fp->y + cy, ' ', ATTR_DEFAULT, ATTR_DEFAULT);
        continue;
      }
      float sv[6] = {v[0], v[1], v[2], v[3], v[4], v[5]};
      int best = 0;
      float best_d = 1e30f;
      for (int k = 0; k < 95; k++) {
        float d = 0;
        for (int c = 0; c < 6; c++) {
          float diff = sv[c] - SHAPE_VECTORS[k][c];
          d += diff * diff;
        }
        if (d < best_d) {
          best_d = d;
          best = k;
        }
      }
      uint32_t fg = ((uint32_t)(uint8_t)mr << 16) |
                    ((uint32_t)(uint8_t)mg << 8) | (uint32_t)(uint8_t)mb;
      setcell(ct, fp->x + cx, fp->y + cy, (uint32_t)(0x20 + best), fg,
              ATTR_DEFAULT);
    }
  }
}

/* ── Frame phases (§9.2.6 ordering) ───────────────────────────────── */

/* Phase 0, before any emission: the repair precheck (§10.2) — a placement
 * whose covered cells will receive writes (front ≠ back anywhere in its
 * box) must be re-placed this frame; run before any dirty-marking mutates
 * the front buffer, and before the diff itself. */
static void graphics_precheck_repairs(struct Clayterm *ct) {
  struct Graphics *g = ct->gfx;
  for (int i = 0; i < g->placement_count; i++) {
    struct ImagePlacement *bp = &g->placements_back[i];
    if (!bp->used || bp->tier != IMG_TIER_KITTY) {
      continue;
    }
    for (int y = bp->y; y < bp->y + bp->h; y++) {
      for (int x = bp->x; x < bp->x + bp->w; x++) {
        if (x < 0 || x >= ct->w || y < 0 || y >= ct->h) {
          continue;
        }
        if (cell_cmp(cell_at(ct, ct->front, x, y),
                     cell_at(ct, ct->back, x, y))) {
          bp->repair = 1;
          return; /* one write is enough to heal the whole box */
        }
      }
    }
  }
}

/* The front-table record matching (registry_id, placement_id), or NULL. */
static struct ImagePlacement *front_match(struct Graphics *g, uint32_t rid,
                                          uint32_t pid) {
  for (int i = 0; i < PLACEMENT_CAP; i++) {
    struct ImagePlacement *fp = &g->placements_front[i];
    if (fp->used && fp->registry_id == rid && fp->placement_id == pid) {
      return fp;
    }
  }
  return NULL;
}

/* Phase 1+2, before cell writes: stale-placement deletions and
 * transmissions, in that order. */
void graphics_emit_before_cells(struct Clayterm *ct) {
  struct Graphics *g = ct->gfx;
  graphics_precheck_repairs(ct);
  /* stale placements: front entries this frame does not re-create, scoped
   * lowercase deletions (data retained; §9.2.5) */
  for (int i = 0; i < PLACEMENT_CAP; i++) {
    struct ImagePlacement *fp = &g->placements_front[i];
    if (!fp->used) {
      continue;
    }
    int re_created = 0;
    int version_changed = 0;
    for (int k = 0; k < g->placement_count; k++) {
      struct ImagePlacement *bp = &g->placements_back[k];
      if (!bp->used || bp->tier != IMG_TIER_KITTY) {
        continue;
      }
      if (bp->registry_id != fp->registry_id ||
          bp->placement_id != fp->placement_id) {
        continue;
      }
      re_created = 1;
      struct ImageEntry *e = graphics_entry(g, bp->registry_id);
      if (e != NULL && e->data_version != fp->data_version) {
        version_changed = 1;
      }
      break;
    }
    if (!re_created) {
      struct ImageEntry *e = graphics_entry(g, fp->registry_id);
      uint32_t current = e != NULL ? e->data_version : 0;
      if (current == fp->data_version) {
        /* no transmission will clean this image; delete the placement
         * here (§9.2.5) */
        kitty_delete_placement(ct, fp->registry_id, fp->placement_id);
      }
      /* the pixels are gone either way (scoped delete, or the
       * data-freeing delete of the transmission path) */
      dirty_mark(ct, fp->x, fp->y, fp->w, fp->h);
    }
  }
  /* unreferenced entries lose their transmission state (§9.2.2: never
   * trust persisted data after losing the last placement) */
  for (int i = 0; i < IMAGE_ENTRY_CAP; i++) {
    struct ImageEntry *e = &g->entries[i];
    if (!e->live || e->transmitted_version == 0) {
      continue;
    }
    int referenced = 0;
    for (int k = 0; k < g->placement_count; k++) {
      if (g->placements_back[k].used &&
          g->placements_back[k].registry_id == e->id) {
        referenced = 1;
        break;
      }
    }
    if (!referenced) {
      e->transmitted_version = 0;
    }
  }
  /* transmissions, in registry id order (§9.2.6) */
  for (int i = 0; i < IMAGE_ENTRY_CAP; i++) {
    struct ImageEntry *e = &g->entries[i];
    if (!e->live) {
      continue;
    }
    int referenced = 0;
    for (int k = 0; k < g->placement_count; k++) {
      if (g->placements_back[k].used &&
          g->placements_back[k].registry_id == e->id) {
        referenced = 1;
        break;
      }
    }
    if (!referenced) {
      continue;
    }
    if (e->transmitted_version != e->data_version) {
      kitty_transmit(ct, e);
    }
  }
}

/* Phase 4, after cell writes: the placements phase. A placement emits
 * only when it is new, moved (the front record's box differs), or repaired
 * (its covered cells receive writes, §10.2) — steady state is byte-silent
 * (§8.5). */
void graphics_emit_placements(struct Clayterm *ct, int row) {
  struct Graphics *g = ct->gfx;
  int emitted = 0;
  for (int i = 0; i < g->placement_count; i++) {
    struct ImagePlacement *p = &g->placements_back[i];
    if (!p->used || p->tier != IMG_TIER_KITTY) {
      continue;
    }
    struct ImagePlacement *fp = front_match(g, p->registry_id, p->placement_id);
    int moved = fp == NULL || fp->x != p->x || fp->y != p->y || fp->w != p->w ||
                fp->h != p->h;
    if (!moved && !p->repair) {
      continue;
    }
    emit_cursor(ct, p->x, p->y, row);
    kitty_place(ct, p->registry_id, p->placement_id, p->w, p->h);
    emitted = 1;
  }
  ct->gfx->emitted_placements = emitted;
}

/* Coverage pass (§10.3): after the render-command walk, pixel-tier coverage
 * asserts its blanks over the back buffer, in back-table order — the
 * later element wins shared cells. */
void graphics_cover(struct Clayterm *ct) {
  struct Graphics *g = ct->gfx;
  for (int i = 0; i < g->placement_count; i++) {
    struct ImagePlacement *p = &g->placements_back[i];
    if (!p->used || p->tier != IMG_TIER_KITTY) {
      continue;
    }
    for (int y = p->y; y < p->y + p->h; y++) {
      for (int x = p->x; x < p->x + p->w; x++) {
        setcell(ct, x, y, ' ', ATTR_DEFAULT, p->blank_bg);
      }
    }
  }
}

/* ── Back-table helpers used by the render-command walk ───────────── */

/* Add a kitty placement record; returns the slot, or NULL at capacity
 * (the caller demotes to ascii + error, §5.4). */
struct ImagePlacement *graphics_add_placement(struct Clayterm *ct,
                                              uint32_t registry_id,
                                              uint32_t placement_id,
                                              uint32_t data_version) {
  struct Graphics *g = ct->gfx;
  if (g->placement_count >= PLACEMENT_CAP) {
    return NULL;
  }
  struct ImagePlacement *p = &g->placements_back[g->placement_count++];
  *p = (struct ImagePlacement){
      .registry_id = registry_id,
      .placement_id = placement_id,
      .data_version = data_version,
      .tier = IMG_TIER_KITTY,
      .used = 1,
  };
  return p;
}

/* Same-frame placement-id collision check (§9.2.1/§13). */
int graphics_placement_collision(struct Clayterm *ct, uint32_t placement_id) {
  struct Graphics *g = ct->gfx;
  for (int i = 0; i < g->placement_count - 1; i++) {
    if (g->placements_back[i].used &&
        g->placements_back[i].placement_id == placement_id) {
      return 1;
    }
  }
  return 0;
}
