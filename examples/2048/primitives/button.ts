/**
 * button — the primitive this whole demo exists to prove out.
 *
 * `@bomb.sh/tty` has no button widget: callers hand-roll a styled `open()` plus
 * pointer bookkeeping, and there is no keyboard focus/activation at all. This
 * module packages the *visual + interaction contract* of a button as a plain
 * `Op[]`-returning function so it can be lifted into `bombshell-dev/ui`.
 *
 * Responsibilities split cleanly:
 *   - This file owns the *look*: how the four interaction states (hover, focus,
 *     press, disabled) map to background/border/text, with a transition so the
 *     feedback is smooth.
 *   - The caller owns *wiring*: pass `{ x, y, down }` into `term.render()` and
 *     route the resulting `pointerenter`/`pointerleave`/`pointerclick` events
 *     (keyed by the button `id`) back into `ButtonState`. Keyboard focus and
 *     Enter/Space activation are handled by the companion `focus.ts` helper,
 *     because tty has no focus system of its own.
 */

import {
  close,
  fixed,
  type Op,
  open,
  rgba,
  type SizingAxis,
  text,
} from "../../../mod.ts";

export interface ButtonState {
  hovered?: boolean;
  focused?: boolean;
  pressed?: boolean;
  disabled?: boolean;
}

export interface ButtonTheme {
  bg: number;
  bgHover: number;
  bgActive: number;
  bgDisabled: number;
  fg: number;
  fgDisabled: number;
  /** Border color when focused (the focus ring). */
  ring: number;
}

export const defaultTheme: ButtonTheme = {
  bg: rgba(58, 58, 78),
  bgHover: rgba(84, 84, 112),
  bgActive: rgba(110, 110, 150),
  bgDisabled: rgba(40, 40, 52),
  fg: rgba(236, 236, 244),
  fgDisabled: rgba(110, 110, 130),
  ring: rgba(255, 214, 110),
};

export interface ButtonOptions {
  width?: SizingAxis;
  height?: SizingAxis;
  theme?: Partial<ButtonTheme>;
}

function bgFor(s: ButtonState, t: ButtonTheme): number {
  if (s.disabled) return t.bgDisabled;
  if (s.pressed) return t.bgActive;
  if (s.hovered) return t.bgHover;
  return t.bg;
}

/**
 * Render a button. Returns a balanced `open()` … `close()` op sequence; the
 * element id is `id`, which is also the id the caller matches against pointer
 * events.
 */
export function button(
  id: string,
  label: string,
  state: ButtonState = {},
  options: ButtonOptions = {},
): Op[] {
  let theme = { ...defaultTheme, ...options.theme };
  let bg = bgFor(state, theme);
  // A border is always present so the box never changes size when focused; only
  // its color animates between the background tint and the focus ring.
  let ringColor = state.focused && !state.disabled ? theme.ring : bg;
  let fg = state.disabled ? theme.fgDisabled : theme.fg;

  return [
    open(id, {
      layout: {
        direction: "ltr",
        // Omitted width falls back to "fit" (size to content) in the packer.
        width: options.width,
        height: options.height ?? fixed(3),
        padding: { left: 2, right: 2 },
        alignX: "center",
        alignY: "center",
      },
      bg,
      border: { color: ringColor, left: 1, right: 1, top: 1, bottom: 1 },
      cornerRadius: { tl: 1, tr: 1, bl: 1, br: 1 },
      // No transition: the button never moves, so a color-only transition would
      // need Clay's `interactive` (transition-while-moving) machinery to be left
      // off. In this v1 build, configuring a transition on a bordered, focusable
      // element renders a stale duplicate of its border (an empty focus-ring box
      // below the button) when focus changes. Focus/hover feedback is instant
      // instead, which is crisp and correct. Revisit once transitions support
      // color-only animation without the position-interaction coupling.
    }),
    text(label, { color: fg }),
    close(),
  ];
}
