/**
 * focus — a minimal keyboard focus manager.
 *
 * tty deliberately has no focus system (the input spec excludes focus, tab
 * order, and keybindings). But a button is not really a button until you can
 * Tab to it and press it with the keyboard, so we add the smallest thing that
 * closes that gap at the app layer.
 *
 * A `FocusRing` is just an ordered list of element ids plus the index of the
 * focused one. Focus owns tab order and "who is focused"; what Enter/Space
 * means is up to the focused component (the app routes activation to
 * `focusedId(ring)`).
 */

import type { KeyEvent } from "../../../mod.ts";

export interface FocusRing {
  items: string[];
  index: number;
}

export function focusRing(items: string[], index = 0): FocusRing {
  return { items, index: items.length === 0 ? 0 : clamp(index, items.length) };
}

export function focusedId(ring: FocusRing): string | undefined {
  return ring.items[ring.index];
}

export function focusBy(ring: FocusRing, delta: number): FocusRing {
  if (ring.items.length === 0) return ring;
  let index = (ring.index + delta + ring.items.length) % ring.items.length;
  return { ...ring, index };
}

export function focusTo(ring: FocusRing, id: string): FocusRing {
  let index = ring.items.indexOf(id);
  return index === -1 ? ring : { ...ring, index };
}

/**
 * Tab navigation intent for a key event, or `null` if it is not a Tab.
 * Returns +1 for forward (Tab) and -1 for backward (Shift+Tab / Backtab).
 */
export function tabDirection(e: KeyEvent): 1 | -1 | null {
  if (e.type !== "keydown") return null;
  if (e.code === "Backtab" || e.key === "Backtab") return -1;
  if (e.code === "Tab" || e.key === "Tab") return e.shift ? -1 : 1;
  return null;
}

/** Whether a key event should activate the focused control. */
export function isActivate(e: KeyEvent): boolean {
  if (e.type !== "keydown") return false;
  return e.key === "Enter" || e.key === " " || e.code === "NumpadEnter" ||
    e.key === "NumpadEnter";
}

function clamp(index: number, length: number): number {
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}
