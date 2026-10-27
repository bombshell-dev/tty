/* frame.c — retained render frame storage and lookup */

#include "frame.h"
#include "mem.h"

uint32_t frame_storage_size(uint32_t runlist_capacity) {
  return align8(runlist_capacity) +
         align8(FRAME_ELEMENT_CAPACITY * sizeof(ElementInfo)) +
         align8(FRAME_ELEMENT_CAPACITY * sizeof(uint32_t)) +
         align8(FRAME_ELEMENT_CAPACITY * sizeof(Clay_String));
}

void frame_init(Frame *frame, char *base, uint32_t runlist_capacity,
                FrameContext *context) {
  frame->context = context;
  frame->runlist = (uint32_t *)base;
  base += align8(runlist_capacity);
  frame->elements = (ElementInfo *)base;
  base += align8(FRAME_ELEMENT_CAPACITY * sizeof(*frame->elements));
  frame->element_buckets = (uint32_t *)base;
  base += align8(FRAME_ELEMENT_CAPACITY * sizeof(*frame->element_buckets));
  frame->pointer_ids = (Clay_String *)base;
  memset(frame->element_buckets, 0,
         FRAME_ELEMENT_CAPACITY * sizeof(*frame->element_buckets));
}

void frame_context_init(FrameContext *context, char *base,
                        uint32_t runlist_capacity) {
  *context = (FrameContext){0};
  context->previous = &context->frames[0];
  context->current = &context->frames[1];
  frame_init(context->previous, base, runlist_capacity, context);
  frame_init(context->current, base + frame_storage_size(runlist_capacity),
             runlist_capacity, context);
}

void frame_context_swap_frames(FrameContext *context) {
  Frame *completed = context->current;
  context->current = context->previous;
  context->previous = completed;
}

void frame_reset_caret(Frame *frame) {
  frame->caret = (CaretState){.tail_x = -1, .tail_y = -1, .x = -1, .y = -1};
}

void frame_render_init(Frame *frame, const Frame *previous_frame) {
  for (uint32_t i = 0; i < frame->element_count; i++) {
    uint32_t bucket = frame->elements[i].id.id % FRAME_ELEMENT_CAPACITY;
    frame->element_buckets[bucket] = 0;
  }
  frame->runlist_length = 0;
  frame->element_count = 0;
  frame->open_depth = 0;
  frame->open_overflow = 0;
  frame->layout_valid = false;
  frame->pointer_count = 0;
  frame->error_count = 0;
  frame->metadata_exceeded = false;
  frame->clip_depth_exceeded = false;
  frame->combining_exceeded = false;
  frame->animating_count = 0;
  frame->hover_shape = 0;
  frame->clip.depth = 0;
  frame->clip.overflow = 0;
  frame->clip.enabled = false;
  frame->emission.lastfg = frame->emission.lastbg = 0xffffffff;
  frame->emission.lastx = frame->emission.lasty = -1;
  frame->context->output.length = 0;
  frame_reset_caret(frame);
  frame->pointer_shape = previous_frame->pointer_shape;
  frame->cursor_visible = previous_frame->cursor_visible;
}

int frame_element_index(Frame *frame, uint32_t id) {
  uint32_t index = frame->element_buckets[id % FRAME_ELEMENT_CAPACITY];
  while (index) {
    ElementInfo *info = &frame->elements[index - 1];
    if (info->id.id == id)
      return (int)(index - 1);
    index = info->next;
  }
  return -1;
}
