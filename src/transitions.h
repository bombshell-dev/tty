#ifndef CLAYTERM_TRANSITIONS_H
#define CLAYTERM_TRANSITIONS_H

#include <stdbool.h>
#include "../clay/clay.h"

#define CT_EASING_LINEAR 0
#define CT_EASING_EASE_IN 1
#define CT_EASING_EASE_OUT 2
#define CT_EASING_EASE_IN_OUT 3

bool ct_handler_linear(Clay_TransitionCallbackArguments args);
bool ct_handler_ease_in(Clay_TransitionCallbackArguments args);
bool ct_handler_ease_out(Clay_TransitionCallbackArguments args);
bool ct_handler_ease_in_out(Clay_TransitionCallbackArguments args);

bool (*ct_handler_for(int kind))(Clay_TransitionCallbackArguments);

#endif
