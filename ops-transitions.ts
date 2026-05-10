export type TransitionProperty =
  | "x"
  | "y"
  | "position"
  | "width"
  | "height"
  | "size"
  | "bg"
  | "overlay"
  | "borderColor"
  | "borderWidth"
  | "all";

export const TP_X = 1;
export const TP_Y = 2;
export const TP_WIDTH = 4;
export const TP_HEIGHT = 8;
export const TP_BG = 16;
export const TP_OVERLAY = 32;
export const TP_BORDER_COLOR = 128;
export const TP_BORDER_WIDTH = 256;

export const TP_POSITION = TP_X | TP_Y;
export const TP_SIZE = TP_WIDTH | TP_HEIGHT;
export const TP_ALL = TP_X | TP_Y | TP_WIDTH | TP_HEIGHT |
  TP_BG | TP_OVERLAY | TP_BORDER_COLOR | TP_BORDER_WIDTH;

export function propertyMask(name: TransitionProperty): number {
  switch (name) {
    case "x":
      return TP_X;
    case "y":
      return TP_Y;
    case "position":
      return TP_POSITION;
    case "width":
      return TP_WIDTH;
    case "height":
      return TP_HEIGHT;
    case "size":
      return TP_SIZE;
    case "bg":
      return TP_BG;
    case "overlay":
      return TP_OVERLAY;
    case "borderColor":
      return TP_BORDER_COLOR;
    case "borderWidth":
      return TP_BORDER_WIDTH;
    case "all":
      return TP_ALL;
  }
}

export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut";

export const EASING_LINEAR = 0;
export const EASING_EASE_IN = 1;
export const EASING_EASE_OUT = 2;
export const EASING_EASE_IN_OUT = 3;

export function easingByte(easing: Easing): number {
  switch (easing) {
    case "linear":
      return EASING_LINEAR;
    case "easeIn":
      return EASING_EASE_IN;
    case "easeOut":
      return EASING_EASE_OUT;
    case "easeInOut":
      return EASING_EASE_IN_OUT;
  }
}

export interface Transition {
  duration: number;
  easing?: Easing;
  properties: TransitionProperty[];
  interactive?: boolean;
}
