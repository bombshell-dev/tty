/* graphics.h — pixel-surface registry and tier engine
 *
 * Implements the Graphics Specification: a per-Term registry of caller-owned
 * decoded RGBA pixel surfaces, plus the engine that downsamples a surface
 * onto the terminal through a fidelity ladder (kitty graphics protocol,
 * shape-aware ASCII character art, alt text).
 *
 * Memory: the registry, pixel pool, and double-buffered placements tables
 * live in their own dimension-independent carve (§5.1) — they survive resize
 * unchanged. No heap: fixed capacities, compaction-only reclamation, closed
 * failure codes.
 */

#ifndef GRAPHICS_H
#define GRAPHICS_H

#include <stdint.h>

struct Clayterm;
struct Buffer;

/* ── Capacities (Graphics Specification §5.3/§5.4, closed) ────────── */

#define IMAGE_ENTRY_CAP 256
#define PLACEMENT_CAP 64
/* base64 chars per non-final chunk; 4096 % 4 == 0 as the protocol requires */
#define IMG_CHUNK_CHARS 4096
/* source bytes per maximum chunk: 4096 base64 chars = 3072 raw bytes */
#define IMG_CHUNK_SRC 3072

/* ── Tiers ────────────────────────────────────────────────────────── */

enum img_tier {
  IMG_TIER_KITTY = 1,
  IMG_TIER_ASCII = 2,
  IMG_TIER_ALT = 3,
};

/* variant property values on the wire (Graphics Specification §7.1) */
enum img_variant {
  IMG_VARIANT_AUTO = 0,
  IMG_VARIANT_KITTY = 1,
  IMG_VARIANT_ASCII = 2,
  IMG_VARIANT_ALT = 3,
};

/* ── Registry entries (§5.3) ──────────────────────────────────────── */

struct ImageEntry {
  uint32_t id;
  uint32_t width, height;
  uint32_t pool_offset; /* pool-relative; stable until compaction */
  uint32_t byte_len;
  uint32_t data_version;        /* bumped on every successful setImage */
  uint32_t transmitted_version; /* 0 = never sent (last version streamed) */
  uint8_t live;
};

/* ── Placements (double-buffered record; §5.4) ────────────────────── */

struct ImagePlacement {
  uint32_t registry_id;
  uint32_t placement_id;
  uint32_t data_version;
  int x, y, w, h;    /* painted footprint, terminal cells */
  uint32_t blank_bg; /* blank-state background: ATTR_DEFAULT sentinel or ARGB */
  uint8_t tier;      /* enum img_tier; only IMG_TIER_KITTY entries are placed */
  uint8_t used;
  uint8_t repair; /* cells in the footprint changed this frame (§10.2) */
};

/* ── Error codes returned by the native surface ───────────────────── */

enum img_err {
  IMG_OK = 0,
  IMG_ERR_ID = 1,      /* id outside [1, 4294967295] */
  IMG_ERR_DIMS = 2,    /* width/height not positive */
  IMG_ERR_LEN = 3,     /* byte length != w*h*4 */
  IMG_ERR_TABLE = 4,   /* entry table full */
  IMG_ERR_POOL = 5,    /* pool cannot hold payload even after compaction */
  IMG_ERR_UNKNOWN = 6, /* commit/remove on unknown or dead id */
};

struct Graphics {
  /* capability mirror (terminfo-spec §4.2: the renderer's private
   * capability state; folded in through the update path) */
  uint8_t kitty_graphics;
  /* pixel pool: carved once, never grown or moved at runtime (§5.3) */
  char *pool;
  uint32_t pool_bytes;
  uint32_t pool_bump; /* high-water bump offset; dead extents below it */
  struct ImageEntry entries[IMAGE_ENTRY_CAP];
  struct ImagePlacement *placements_front; /* previous frame's placements */
  struct ImagePlacement *placements_back;  /* frame being built */
  int placement_count;                     /* used slots in the back table */
  /* set during reduce(): the placements phase emitted at least one CUP */
  int emitted_placements;
};

/* ── Carve ────────────────────────────────────────────────────────── */

int graphics_size(int pool_bytes);
struct Graphics *graphics_init(void *mem, int pool_bytes);

/* ── Registry surface (native, called outside render transactions) ── */

/* Reserve and validate. Returns the pool offset to write pixels at, or a
 * negative `enum img_err` code. Updates the entry's dimensions and extent;
 * the caller copies `w*h*4` bytes to [pool + offset] before commit. */
int image_begin(struct Clayterm *ct, uint32_t id, uint32_t w, uint32_t h);

/* Finalize a begun image: bumps the data version (Graphics Specification
 * §4.3). Returns 0 or a negative `enum img_err` code. */
int image_commit(struct Clayterm *ct, uint32_t id);

/* Remove a surface: emits the data-freeing deletion block (§7.2) into the
 * Term's output buffer (reset first), reconciles covered cells to their
 * blank state, and frees the entry. Returns the byte length written (0 when
 * nothing was emitted), or a negative `enum img_err` code. */
int image_remove(struct Clayterm *ct, uint32_t id);

/* Capability mirror (terminfo-spec §4.2). A true→false transition is a
 * capability denial (§11.2): emits deletion bytes for every image with live
 * placements into the output buffer (reset first), resets transmission
 * state, clears the placements tables, and reconciles covered cells. */
void graphics_capability(struct Clayterm *ct, int kitty_graphics);

/* Resize (§10.5): before the dimension-dependent state is discarded, emit
 * one data-freeing deletion per image with live placements into the output
 * buffer (reset first), reset transmission state, and clear the placements
 * tables. Returns the byte length written. */
int graphics_resize_prepare(struct Clayterm *ct);

/* ── Frame hooks (called from reduce()) ───────────────────────────── */

void graphics_frame_begin(struct Graphics *g);
void graphics_frame_end(struct Graphics *g); /* swaps the tables */

/* ── Tier engine (called from clayterm.c's reduce()) ──────────────── */

/* Registry lookup; NULL when unknown or dead. */
struct ImageEntry *graphics_entry(struct Graphics *g, uint32_t id);

/* Pre-layout tier resolution (§9.1): variant/omission/liveness/evidence +
 * the line-mode cap. The containment/overlap/capacity/collision demotions
 * of §8.5/§10.3 happen later, at the render-command walk, and only lower
 * kitty→ascii with the same footprint. */
uint8_t graphics_resolve_tier(struct Clayterm *ct, uint32_t registry_id,
                              uint8_t variant, int mode);

/* Contain-fit painted footprint (§8.2) inside the box, for a W×H source. */
struct ImagePlacement graphics_contain_fit(int boxX, int boxY, int boxW,
                                           int boxH, uint32_t W, uint32_t H);

/* Pinned placement-id derivation (§9.2.1/§15). */
uint32_t graphics_placement_id(const char *id_chars, uint32_t id_len,
                               uint32_t registry_id);

/* Add a kitty placement record to the back table; NULL at capacity
 * (caller demotes to ascii and reports IMAGE_PLACEMENTS_EXCEEDED, §5.4). */
struct ImagePlacement *graphics_add_placement(struct Clayterm *ct,
                                              uint32_t registry_id,
                                              uint32_t placement_id,
                                              uint32_t data_version);

/* Same-frame placement-id collision check (§9.2.1/§13). */
int graphics_placement_collision(struct Clayterm *ct, uint32_t placement_id);

/* Paint a footprint as ascii character art (§9.3). */
void graphics_paint_ascii(struct Clayterm *ct, const struct ImageEntry *e,
                          const struct ImagePlacement *fp);

/* Frame phases in §9.2.6 order: the coverage pass (after the render-command
 * walk), the pre-cell phases (stale deletions + transmissions; skipped in
 * line mode by the caller), and the placements phase (after cell writes). */
void graphics_cover(struct Clayterm *ct);
void graphics_emit_before_cells(struct Clayterm *ct);
void graphics_emit_placements(struct Clayterm *ct, int row);

#endif
