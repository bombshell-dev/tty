/* Node-API adapter. The engine stays synchronous and performs no terminal IO.
 */
#include <limits.h>
#include <math.h>
#include <node_api.h>
#include <stdlib.h>

#include "module.c"

static const napi_type_tag NODE_STATE_TAG = {0x96ff9182c1a7bd30,
                                             0x3745288fba210c46};

#define TRANSFER_BYTES (1024 * 1024 + 8192 * 120)

/* The JavaScript ArrayBuffer owns the arena. A handle retains its current
 * buffer; output views retain older buffers across resize and handle GC. */
typedef struct {
  int kind;
  char *arena;
  size_t capacity;
  int transfer;
  struct Clayterm *term;
  struct InputState *input;
  napi_ref buffer;
} NodeState;

#define CHECK(call)                                                            \
  do {                                                                         \
    if ((call) != napi_ok) {                                                   \
      bool pending = false;                                                    \
      napi_is_exception_pending(env, &pending);                                \
      if (!pending)                                                            \
        napi_throw_error(env, NULL, "Node-API operation failed: " #call);      \
      return NULL;                                                             \
    }                                                                          \
  } while (0)

static napi_value number(napi_env env, double n) {
  napi_value value;
  CHECK(napi_create_double(env, n, &value));
  return value;
}

static void finalize_state(napi_env env, void *data, void *hint) {
  (void)hint;
  NodeState *state = data;
  if (state->buffer)
    napi_delete_reference(env, state->buffer);
  free(state);
}

static napi_value allocate(napi_env env, napi_value object, NodeState *state,
                           size_t capacity) {
  napi_value buffer;
  void *arena;
  CHECK(napi_create_arraybuffer(env, capacity, &arena, &buffer));
  napi_ref reference;
  CHECK(napi_create_reference(env, buffer, 1, &reference));
  CHECK(napi_set_named_property(env, object, "buffer", buffer));
  if (state->buffer)
    CHECK(napi_delete_reference(env, state->buffer));
  state->buffer = reference;
  state->arena = arena;
  state->capacity = capacity;
  return buffer;
}

static napi_value resize(napi_env env, napi_value object, NodeState *state,
                         double width, double height) {
  /* Keep all engine int-sized arithmetic representable before calling C. */
  if (!isfinite(width) || !isfinite(height) || width < 1 || height < 1 ||
      width != floor(width) || height != floor(height) ||
      width * height > (INT_MAX - 128 * 1024 * 1024) /
                           (2 * sizeof(Cell) + OUT_BYTES_PER_CELL)) {
    napi_throw_range_error(env, NULL,
                           "terminal dimensions exceed native capacity");
    return NULL;
  }
  uint32_t caps = state->term ? state->term->caps : 0;
  int shape = state->term ? pointer_shape(state->term) : 0;
  /* Do not let sizing or initialization inherit another Term's context. */
  Clay_SetCurrentContext(NULL);
  int size = clayterm_size((int)width, (int)height);
  int transfer = align8(size);
  size_t capacity = (size_t)transfer + TRANSFER_BYTES;
  if (capacity > state->capacity) {
    if (!allocate(env, object, state, capacity))
      return NULL;
  }
  state->term = init(state->arena, (int)width, (int)height);
  state->transfer = transfer;
  Clay_SetMeasureTextFunction(measure_text, state->term);
  set_capabilities(state->term, caps);
  set_pointer_shape(state->term, shape);
  Clay_SetCurrentContext(NULL);
  CHECK(
      napi_set_named_property(env, object, "transfer", number(env, transfer)));
  return object;
}

static napi_value create(napi_env env, napi_callback_info info) {
  napi_value args[4];
  size_t argc = 4;
  void *kind;
  CHECK(napi_get_cb_info(env, info, &argc, args, NULL, &kind));
  double a, b;
  if (argc < 2) {
    napi_throw_type_error(env, NULL, "native creation requires arguments");
    return NULL;
  }
  CHECK(napi_get_value_double(env, args[0], &a));
  CHECK(napi_get_value_double(env, args[1], &b));
  NodeState *state = calloc(1, sizeof(NodeState));
  if (!state) {
    napi_throw_error(env, NULL, "native state allocation failed");
    return NULL;
  }
  state->kind = (int)(uintptr_t)kind;
  napi_value object;
  napi_status status = napi_create_object(env, &object);
  if (status != napi_ok) {
    free(state);
    CHECK(status);
  }
  status = napi_wrap(env, object, state, finalize_state, NULL, NULL);
  if (status != napi_ok) {
    free(state);
    CHECK(status);
  }
  CHECK(napi_type_tag_object(env, object, &NODE_STATE_TAG));
  if (state->kind == 1)
    return resize(env, object, state, a, b);

  if (argc != 3 || !isfinite(a) || a < 0 || a > INT_MAX || !isfinite(b) ||
      b < 0 || b > INT_MAX) {
    napi_throw_range_error(env, NULL, "invalid native input configuration");
    return NULL;
  }
  napi_typedarray_type type;
  size_t key_len, offset;
  void *keys;
  napi_value buffer;
  CHECK(napi_get_typedarray_info(env, args[2], &type, &key_len, &keys, &buffer,
                                 &offset));
  if (type != napi_uint8_array || key_len > INT_MAX) {
    napi_throw_range_error(env, NULL, "invalid terminfo key table");
    return NULL;
  }
  int transfer = 16 + input_size();
  if (!allocate(env, object, state, (size_t)transfer + SCAN_BUFFER_SIZE))
    return NULL;
  state->input =
      input_init(state->arena + 16, (int)a, keys, (int)key_len, (int)b);
  state->transfer = transfer;
  CHECK(
      napi_set_named_property(env, object, "transfer", number(env, transfer)));
  CHECK(napi_set_named_property(env, object, "eventSize",
                                number(env, sizeof(struct InputEvent))));
  return object;
}

enum {
  RESIZE,
  REDUCE,
  OUTPUT,
  LENGTH,
  ANIMATING,
  ERROR_COUNT,
  ERROR_TYPE,
  ERROR_MESSAGE,
  POINTER_IDS,
  BOUNDS,
  CAPS,
  SCAN,
  COUNT,
  EVENT,
  DELAY
};

static napi_value call(napi_env env, napi_callback_info info) {
  napi_value args[8];
  size_t argc = 8;
  void *operation;
  CHECK(napi_get_cb_info(env, info, &argc, args, NULL, &operation));
  if (!argc) {
    napi_throw_type_error(env, NULL, "native call requires a handle");
    return NULL;
  }
  bool tagged;
  CHECK(napi_check_object_type_tag(env, args[0], &NODE_STATE_TAG, &tagged));
  if (!tagged) {
    napi_throw_type_error(env, NULL, "invalid native handle");
    return NULL;
  }
  NodeState *state;
  CHECK(napi_unwrap(env, args[0], (void **)&state));
  /* Public output exposes the backing ArrayBuffer. Unlike Wasm memory, a
   * regular ArrayBuffer can be detached or transferred by JavaScript. Never
   * dereference arena pointers after that happens, even through an old info
   * object or a resize call. No user code runs during an engine transaction. */
  napi_value buffer;
  void *arena;
  size_t capacity;
  CHECK(napi_get_reference_value(env, state->buffer, &buffer));
  CHECK(napi_get_arraybuffer_info(env, buffer, &arena, &capacity));
  if (arena != state->arena || capacity != state->capacity) {
    napi_throw_error(env, NULL, "native memory buffer was detached");
    return NULL;
  }
  int op = (int)(uintptr_t)operation;
  if ((op >= SCAN ? 2 : 1) != state->kind) {
    napi_throw_type_error(env, NULL, "incorrect native handle kind");
    return NULL;
  }
  if (op == RESIZE) {
    double w, h;
    if (argc != 3) {
      napi_throw_type_error(env, NULL, "resize requires dimensions");
      return NULL;
    }
    CHECK(napi_get_value_double(env, args[1], &w));
    CHECK(napi_get_value_double(env, args[2], &h));
    return resize(env, args[0], state, w, h);
  }
  size_t expected = (op == REDUCE) ? 8
                    : (op == SCAN) ? 3
                    : (op == BOUNDS || op == CAPS || op == ERROR_TYPE ||
                       op == ERROR_MESSAGE || op == EVENT)
                        ? 2
                        : 1;
  if (argc != expected) {
    napi_throw_type_error(env, NULL, "incorrect native argument count");
    return NULL;
  }
  /* All layout operations restore and clear the upstream current context.
   * Clay's native routing state is thread-local, so workers cannot race. */
  if (state->term)
    Clay_SetCurrentContext(state->term->context);
  napi_value result;
  double n[7] = {0};
  if (op != BOUNDS) {
    for (size_t i = 1; i < argc; i++) {
      CHECK(napi_get_value_double(env, args[i], &n[i - 1]));
      if (!isfinite(n[i - 1])) {
        napi_throw_range_error(env, NULL, "native argument must be finite");
        return NULL;
      }
    }
  }
  switch (op) {
  case REDUCE:
    if (argc != 8 || n[0] < 0 || n[0] > TRANSFER_BYTES / 4 ||
        n[0] != floor(n[0])) {
      napi_throw_range_error(env, NULL, "invalid packed frame length");
      return NULL;
    }
    reduce(state->term, (uint32_t *)(state->arena + state->transfer), (int)n[0],
           (int)n[1], (int)n[2], (float)n[3], (float)n[4], (float)n[5],
           (int)n[6]);
    CHECK(napi_get_undefined(env, &result));
    break;
  case OUTPUT:
    result = number(env, output(state->term) - state->arena);
    break;
  case LENGTH:
    result = number(env, length(state->term));
    break;
  case ANIMATING:
    result = number(env, animating(state->term));
    break;
  case ERROR_COUNT:
    result = number(env, error_count(state->term));
    break;
  case ERROR_TYPE:
    result = number(env, error_type(state->term, (int)n[0]));
    break;
  case ERROR_MESSAGE: {
    const char *message = error_message_ptr(state->term, (int)n[0]);
    CHECK(napi_create_string_utf8(env, message ? message : "",
                                  error_message_length(state->term, (int)n[0]),
                                  &result));
    break;
  }
  case CAPS:
    result = number(env, set_capabilities(state->term, (uint32_t)n[0]));
    break;
  case POINTER_IDS: {
    int count = pointer_over_count();
    CHECK(napi_create_array(env, &result));
    uint32_t index = 0;
    for (int i = 0; i < count; i++) {
      int len = pointer_over_id_string_length(i);
      if (!len)
        continue;
      napi_value id;
      CHECK(napi_create_string_utf8(env, pointer_over_id_string_ptr(i), len,
                                    &id));
      CHECK(napi_set_element(env, result, index++, id));
    }
    break;
  }
  case BOUNDS: {
    size_t len;
    CHECK(napi_get_value_string_utf8(env, args[1], NULL, 0, &len));
    if (len > TRANSFER_BYTES - 1) {
      napi_throw_range_error(env, NULL, "element id exceeds native capacity");
      return NULL;
    }
    char *name = state->arena + state->transfer;
    CHECK(napi_get_value_string_utf8(env, args[1], name, len + 1, &len));
    float box[4];
    if (!get_element_bounds(name, (int)len, box)) {
      CHECK(napi_get_undefined(env, &result));
      break;
    }
    CHECK(napi_create_object(env, &result));
    const char *names[] = {"x", "y", "width", "height"};
    for (int i = 0; i < 4; i++)
      CHECK(
          napi_set_named_property(env, result, names[i], number(env, box[i])));
    break;
  }
  case SCAN:
    if (argc != 3 || n[0] < 0 || n[0] > SCAN_BUFFER_SIZE ||
        n[0] != floor(n[0])) {
      napi_throw_range_error(env, NULL, "invalid native scan length");
      return NULL;
    }
    int accepted = input_scan(state->input, state->arena + state->transfer,
                              (int)n[0], n[1]);
    int32_t *metadata = (int32_t *)state->arena;
    metadata[0] = input_count(state->input);
    struct InputEvent *first = input_event(state->input, 0);
    metadata[1] = first ? (int)((char *)first - state->arena) : 0;
    metadata[2] = input_delay(state->input);
    result = number(env, accepted);
    break;
  case COUNT:
    result = number(env, input_count(state->input));
    break;
  case EVENT: {
    struct InputEvent *event = input_event(state->input, (int)n[0]);
    result = number(env, event ? (char *)event - state->arena : 0);
    break;
  }
  case DELAY:
    result = number(env, input_delay(state->input));
    break;
  default:
    napi_throw_error(env, NULL, "unknown native operation");
    return NULL;
  }
  if (state->term)
    Clay_SetCurrentContext(NULL);
  return result;
}

static napi_value parse_terminfo(napi_env env, napi_callback_info info) {
  napi_value arg;
  size_t argc = 1;
  CHECK(napi_get_cb_info(env, info, &argc, &arg, NULL, NULL));
  napi_typedarray_type type;
  size_t len, offset;
  void *bytes;
  napi_value buffer;
  CHECK(napi_get_typedarray_info(env, arg, &type, &len, &bytes, &buffer,
                                 &offset));
  if (type != napi_uint8_array || len > 32768) {
    napi_throw_range_error(env, NULL, "terminfo entry exceeds native capacity");
    return NULL;
  }
  struct TermInfo ti;
  terminfo_init(&ti);
  int status = len ? terminfo_parse(bytes, (int)len, &ti) : 1;
  napi_value result;
  CHECK(napi_create_array_with_length(env, 3, &result));
  CHECK(napi_set_element(env, result, 0, number(env, status)));
  CHECK(napi_set_element(env, result, 1, number(env, ti.colors)));
  CHECK(napi_set_element(env, result, 2, number(env, ti.flags)));
  return result;
}

NAPI_MODULE_INIT() {
#define METHOD(name, fn, op)                                                   \
  {                                                                            \
    name, NULL, fn, NULL, NULL, NULL, napi_default, (void *)(uintptr_t)(op)    \
  }
  const napi_property_descriptor methods[] = {
      METHOD("createTerm", create, 1),
      METHOD("createInput", create, 2),
      METHOD("resize", call, RESIZE),
      METHOD("reduce", call, REDUCE),
      METHOD("output", call, OUTPUT),
      METHOD("length", call, LENGTH),
      METHOD("animating", call, ANIMATING),
      METHOD("errorCount", call, ERROR_COUNT),
      METHOD("errorType", call, ERROR_TYPE),
      METHOD("errorMessage", call, ERROR_MESSAGE),
      METHOD("pointerIds", call, POINTER_IDS),
      METHOD("bounds", call, BOUNDS),
      METHOD("caps", call, CAPS),
      METHOD("scan", call, SCAN),
      METHOD("count", call, COUNT),
      METHOD("event", call, EVENT),
      METHOD("delay", call, DELAY),
      METHOD("terminfo", parse_terminfo, 0),
  };
  CHECK(napi_define_properties(env, exports,
                               sizeof(methods) / sizeof(methods[0]), methods));
  return exports;
}
