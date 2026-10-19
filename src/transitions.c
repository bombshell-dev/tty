#include "transitions.h"
#include "clayterm.h"

extern struct Clayterm *ct_active_context;

static float clampf(float v, float lo, float hi) {
  if (v < lo) {
    return lo;
  } else if (v > hi) {
    return hi;
  } else {
    return v;
  }
}

static float ease_in(float t) { return t * t; }

static float ease_out(float t) {
  float inv = 1.0f - t;
  return 1.0f - inv * inv;
}

static float ease_in_out(float t) {
  if (t < 0.5f) {
    return 2.0f * t * t;
  } else {
    float inv = 1.0f - t;
    return 1.0f - 2.0f * inv * inv;
  }
}

static float lerpf(float a, float b, float t) { return a + (b - a) * t; }

static Clay_Color lerp_color(Clay_Color a, Clay_Color b, float t) {
  Clay_Color out;
  out.r = lerpf(a.r, b.r, t);
  out.g = lerpf(a.g, b.g, t);
  out.b = lerpf(a.b, b.b, t);
  out.a = lerpf(a.a, b.a, t);
  return out;
}

static bool apply(Clay_TransitionCallbackArguments args, float eased,
                  bool done) {
  if (args.properties & CLAY_TRANSITION_PROPERTY_X) {
    args.current->boundingBox.x =
        lerpf(args.initial.boundingBox.x, args.target.boundingBox.x, eased);
  }
  if (args.properties & CLAY_TRANSITION_PROPERTY_Y) {
    args.current->boundingBox.y =
        lerpf(args.initial.boundingBox.y, args.target.boundingBox.y, eased);
  }
  if (args.properties & CLAY_TRANSITION_PROPERTY_WIDTH) {
    args.current->boundingBox.width = lerpf(
        args.initial.boundingBox.width, args.target.boundingBox.width, eased);
  }
  if (args.properties & CLAY_TRANSITION_PROPERTY_HEIGHT) {
    args.current->boundingBox.height = lerpf(
        args.initial.boundingBox.height, args.target.boundingBox.height, eased);
  }
  if (args.properties & CLAY_TRANSITION_PROPERTY_BACKGROUND_COLOR) {
    args.current->backgroundColor = lerp_color(
        args.initial.backgroundColor, args.target.backgroundColor, eased);
  }
  if (args.properties & CLAY_TRANSITION_PROPERTY_OVERLAY_COLOR) {
    args.current->overlayColor =
        lerp_color(args.initial.overlayColor, args.target.overlayColor, eased);
  }
  if (args.properties & CLAY_TRANSITION_PROPERTY_BORDER_COLOR) {
    args.current->borderColor =
        lerp_color(args.initial.borderColor, args.target.borderColor, eased);
  }
  if (args.properties & CLAY_TRANSITION_PROPERTY_BORDER_WIDTH) {
    args.current->borderWidth.left = (uint16_t)lerpf(
        args.initial.borderWidth.left, args.target.borderWidth.left, eased);
    args.current->borderWidth.right = (uint16_t)lerpf(
        args.initial.borderWidth.right, args.target.borderWidth.right, eased);
    args.current->borderWidth.top = (uint16_t)lerpf(
        args.initial.borderWidth.top, args.target.borderWidth.top, eased);
    args.current->borderWidth.bottom = (uint16_t)lerpf(
        args.initial.borderWidth.bottom, args.target.borderWidth.bottom, eased);
    args.current->borderWidth.betweenChildren =
        (uint16_t)lerpf(args.initial.borderWidth.betweenChildren,
                        args.target.borderWidth.betweenChildren, eased);
  }
  if (ct_active_context && !done) {
    ct_active_context->animating_count++;
  }
  return done;
}

static float progress(Clay_TransitionCallbackArguments args) {
  if (args.duration <= 0.0f) {
    return 1.0f;
  } else {
    return clampf(args.elapsedTime / args.duration, 0.0f, 1.0f);
  }
}

bool ct_handler_linear(Clay_TransitionCallbackArguments args) {
  float p = progress(args);
  return apply(args, p, p >= 1.0f);
}

bool ct_handler_ease_in(Clay_TransitionCallbackArguments args) {
  float p = progress(args);
  return apply(args, ease_in(p), p >= 1.0f);
}

bool ct_handler_ease_out(Clay_TransitionCallbackArguments args) {
  float p = progress(args);
  return apply(args, ease_out(p), p >= 1.0f);
}

bool ct_handler_ease_in_out(Clay_TransitionCallbackArguments args) {
  float p = progress(args);
  return apply(args, ease_in_out(p), p >= 1.0f);
}

bool (*ct_handler_for(int kind))(Clay_TransitionCallbackArguments) {
  switch (kind) {
  case CT_EASING_EASE_IN:
    return ct_handler_ease_in;
  case CT_EASING_EASE_OUT:
    return ct_handler_ease_out;
  case CT_EASING_EASE_IN_OUT:
    return ct_handler_ease_in_out;
  case CT_EASING_LINEAR:
  default:
    return ct_handler_linear;
  }
}
