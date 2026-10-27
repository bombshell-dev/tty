/* frame.h — retained render frame state and storage */

#ifndef FRAME_H
#define FRAME_H

#include <stdbool.h>
#include <stdint.h>

#include "../clay/clay.h"
#include "buffer.h"
#include "cell.h"

#define FRAME_ELEMENT_CAPACITY 8192
#define FRAME_MAX_ERRORS 32

/* Clip nesting beyond this clamps to the deepest tracked rectangle. */
#define FRAME_CLIP_STACK_MAX 16

typedef struct {
  int x, y, w, h;
} ClipRect;

typedef struct FrameContext FrameContext;

/* A named element's identity and packed subtree range within its frame.
 * Duplicate IDs keep the first declaration's entry, matching Clay's lookup.
 */
typedef struct {
  /* Clay's hashed ID; stringId borrows the name bytes Frame.runlist. */
  Clay_ElementId id;

  /* Byte offset from the start of the runlist to this element's open. */
  uint32_t offset;

  /* Byte length from open through its matching close, including children. */
  uint32_t length;

  /* Next element in this hash bucket: index + 1, or 0 to end the chain. */
  uint32_t next;
} ElementInfo;

/**
 * What we know about the caret in this frame
 */
typedef struct {
  /**
   *  Did a text directive declared a caret in this frame
   */
  bool declared;

  /**
   *
   * Was a specific cell found for the caret.
   */
  int placed;

  /**
   * The run of text that contains the caret
   */
  Clay_String text;

  /**
   * Caret position is specified in Unicode code points. For example, to place
   * the caret before the letter "B" in "A中B", you would would place it at `2`:
   *
   *  text("A中B", { caret: 2 })
   *
   * "A" occupies 1 byte and "中" occupies 3 bytes, so the caret’s byte offset
   * is 4.
   */
  uint32_t byte_offset;

  /* Whether tail_x and tail_y hold an end-of-content fallback cell. */
  int tail_valid;

  /* Column after the last walked caret text slice; -1 until recorded. */
  int tail_x;

  /* Row of the last walked caret text slice; -1 until recorded. */
  int tail_y;

  /* Resolved zero-based column; -1 until placed. */
  int x;

  /* Resolved zero-based row; -1 until placed. */
  int y;
} CaretState;

/**
 * Data and working state for one render. The context alternates two frames:
 * current receives directives, metadata, and rasterized cells, then becomes
 * previous after presentation. previous supplies the diff baseline and
 * metadata such as element bounds, pointer hits, and errors encountered.
 */
typedef struct {
  /* Owner of this frame, its sibling, and their shared storage. */
  FrameContext *context;

  /**
   * Pointer to the list of directives that run when rendering this frame.
   * OPEN/CLOSE/TEXT, etc..
   *
   * Storage and directives are aligned for 32-bit reads.
   */
  uint32_t *runlist;

  /* Number of populated uint32_t words in runlist. */
  uint32_t runlist_length;

  /* Named element entries in opening order; capacity FRAME_ELEMENT_CAPACITY. */
  ElementInfo *elements;

  /* Hash bucket heads, indexed by id.id % FRAME_ELEMENT_CAPACITY. Each head
   * stores an element index + 1; 0 means empty. Chains follow ElementInfo.next.
   */
  uint32_t *element_buckets;

  /* Number of populated entries in elements. */
  uint32_t element_count;

  /* Number of populated entries in context->open_elements. */
  uint32_t open_depth;

  /* Untracked opens beyond the stack capacity, balanced by later closes. */
  uint32_t open_overflow;

  /* Set after layout completes without element overflow; cleared on reuse or
   * resize. Allows lazy bounds queries while this frame is previous, when
   * the shared Clay context still holds its layout. */
  bool layout_valid;

  /* Named IDs under the pointer, in Clay hit-test order; capacity
   * FRAME_ELEMENT_CAPACITY. String bytes borrow runlist storage or static
   * Clay strings, including Clay's internal root ID. */
  Clay_String *pointer_ids;

  /* Number of populated pointer_ids; 0 when no pointer hit test was run. */
  uint32_t pointer_count;

  /* Row-major viewport cells. Presentation adds wide-character continuation
   * markers so this buffer can serve as the next render's diff baseline. */
  Cell *cells;

  /* Clay and renderer errors collected during this render. */
  Clay_ErrorData errors[FRAME_MAX_ERRORS];

  /* Number of populated errors, capped at FRAME_MAX_ERRORS. */
  uint8_t error_count;

  /* Whether element-index capacity overflow has been reported this render. */
  bool metadata_exceeded;

  /* Whether clip-stack overflow has been reported this render. */
  bool clip_depth_exceeded;

  /* Whether combining-mark overflow has been reported this render. */
  bool combining_exceeded;

  /* Number of transition callbacks that reported unfinished work this render.
   * A nonzero count sets the host's animating result. */
  uint32_t animating_count;

  /* Shape resolved by this frame's hit test; 0 is "default". */
  uint8_t hover_shape;

  /* Last emitted pointer shape's index in POINTER_SHAPES, initialized to 0
   * (default). Inherited from previous until a shape change is emitted. */
  uint8_t pointer_shape;

  /* Caret declaration and placement state, reset on frame reuse or resize. */
  CaretState caret;

  /* Whether the renderer has shown a caret cursor without later hiding it.
   * Initially 0; inherited when no cursor control is emitted. This tracks
   * renderer output, not the terminal's initial cursor visibility. */
  bool cursor_visible;

  /* Clipping state while walking this frame's drawing commands. */
  struct {
    /* Current intersection, consulted only while enabled. */
    ClipRect active;

    /* Intersected rectangles restored as nested clips close. */
    ClipRect stack[FRAME_CLIP_STACK_MAX];

    /* Number of populated rectangles in stack. */
    uint32_t depth;

    /* Untracked clip levels, popped without disturbing stack. */
    uint32_t overflow;

    /* Whether active restricts drawing. */
    bool enabled;
  } clip;

  /* Bookkeeping within this frame's output stream, reset on every render. */
  struct {
    /* Last emitted attributes; 0xffffffff forces the initial SGR. */
    uint32_t lastfg, lastbg;

    /* Last character position used to elide CUP; -1 forces positioning. */
    int lastx, lasty;
  } emission;
} Frame;

/* Owns the frame pair, their render roles, and shared scratch storage.
 * Initialize in place: both frames point back to this context. */
struct FrameContext {
  /* Stable frame storage; swapping changes roles without copying frames. */
  Frame frames[2];

  /* Frame being prepared for the next completed render. */
  Frame *current;

  /* Most recently completed frame, used for diffing and metadata queries. */
  Frame *previous;

  /* Metadata entry for each open element; -1 when there is no entry.
   * Reused by current; contents are not retained for previous. */
  int open_elements[FRAME_ELEMENT_CAPACITY];

  /* Shared terminal bytes from the latest render; replaced by the next render.
   * Resize rebinds this buffer to the dimension-dependent storage. */
  Buffer output;
};

/* Initialize both frames and shared scratch in place. base provides two
 * frame_storage_size() regions; resize binds cells and output afterward. */
void frame_context_init(FrameContext *context, char *base,
                        uint32_t runlist_capacity);

/* Make the completed current frame previous, recycling the old previous. */
void frame_context_swap_frames(FrameContext *context);

/* Bytes for the runlist, element index, and pointer IDs; excludes cells. */
uint32_t frame_storage_size(uint32_t runlist_capacity);

/* Bind a zero-initialized frame to its retained storage and owning context. */
void frame_init(Frame *frame, char *base, uint32_t runlist_capacity,
                FrameContext *context);

/* Prepare for a new render by clearing out state that will be built up over
 * the course of the render.
 *
 * Resets the shared output length; call after assembling a valid runlist.
 * Clears runlist_length but preserves the assembled bytes.
 * Inherits emitted pointer shape and cursor visibility from previous_frame. */
void frame_render_init(Frame *frame, const Frame *previous_frame);

/* Clear caret placement state while preserving emitted cursor visibility. */
void frame_reset_caret(Frame *frame);

/* Return the element's index, or -1 if the ID is absent from the frame. */
int frame_element_index(Frame *frame, uint32_t id);

#endif
