/**
 * Encode a plain escape sequence.
 *
 * Prepends `ESC` (`\x1b`) to the given string and returns the result as bytes.
 *
 * @see {@link https://www.ecma-international.org/publications-and-standards/standards/ecma-48/ | ECMA-48}
 */
export function ESC(str: string): Uint8Array {
  return encode(`\x1b${str}`);
}

/**
 * Encode a Control Sequence Introducer (CSI) command.
 *
 * Prepends `ESC[` to the given string and returns the result as bytes.
 *
 * @see {@link https://www.ecma-international.org/publications-and-standards/standards/ecma-48/ | ECMA-48}
 */
export function CSI(str: string): Uint8Array {
  return ESC(`[${str}`);
}

/**
 * Request the cursor position via Device Status Report (DSR).
 *
 * Sends `CSI 6n`. The terminal responds with a Cursor Position Report
 * (`CSI row ; column R`) where row and column are 1-based.
 *
 * @see {@link https://www.ecma-international.org/publications-and-standards/standards/ecma-48/ | ECMA-48}
 */
export function DSR(): Uint8Array {
  return CSI("6n");
}

/**
 * Show the cursor (DECTCEM set).
 *
 * DEC private mode 25. Not part of ECMA-48; originates from the VT220.
 *
 * @see {@link https://vt100.net/docs/vt510-rm/DECTCEM.html | VT510 DECTCEM}
 */
export function SHOWCURSOR(): Uint8Array {
  return CSI("?25h");
}

/**
 * Hide the cursor (DECTCEM reset).
 *
 * DEC private mode 25. Not part of ECMA-48; originates from the VT220.
 *
 * @see {@link https://vt100.net/docs/vt510-rm/DECTCEM.html | VT510 DECTCEM}
 */
export function HIDECURSOR(): Uint8Array {
  return CSI("?25l");
}

/**
 * Switch to the alternate screen buffer.
 *
 * Saves the cursor and switches to the alternate screen. When `clear` is
 * `true` (the default), the alternate buffer is cleared on entry. When
 * `false`, the existing contents are preserved.
 *
 * Use {@link MAINSCREEN} to switch back.
 *
 * @see {@link https://invisible-island.net/xterm/ctlseqs/ctlseqs.html | xterm control sequences}
 */
export function ALTSCREEN(options?: { clear?: boolean }): Uint8Array {
  let { clear = true } = options ?? {};
  if (clear) {
    return CSI("?1049h");
  } else {
    return CSI("?47h");
  }
}

/**
 * Switch back to the main screen buffer.
 *
 * Restores the cursor and returns to the main screen with scrollback intact.
 *
 * @see {@link https://invisible-island.net/xterm/ctlseqs/ctlseqs.html | xterm control sequences}
 */
export function MAINSCREEN(): Uint8Array {
  return CSI("?1049l");
}

/**
 * A mouse pointer shape, named with the CSS `cursor` keyword vocabulary.
 *
 * These are the values understood by terminals implementing the OSC 22
 * pointer-shape protocol (kitty, Ghostty). Terminals that do not recognize a
 * given shape ignore it.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/CSS/cursor | CSS cursor}
 * @see {@link https://sw.kovidgoyal.net/kitty/pointer-shapes/ | kitty pointer shapes}
 */
export type CursorShape =
  | "default"
  | "none"
  | "context-menu"
  | "help"
  | "pointer"
  | "progress"
  | "wait"
  | "cell"
  | "crosshair"
  | "text"
  | "vertical-text"
  | "alias"
  | "copy"
  | "move"
  | "no-drop"
  | "not-allowed"
  | "grab"
  | "grabbing"
  | "e-resize"
  | "n-resize"
  | "ne-resize"
  | "nw-resize"
  | "s-resize"
  | "se-resize"
  | "sw-resize"
  | "w-resize"
  | "ew-resize"
  | "ns-resize"
  | "nesw-resize"
  | "nwse-resize"
  | "col-resize"
  | "row-resize"
  | "all-scroll"
  | "zoom-in"
  | "zoom-out";

/**
 * Encode an Operating System Command (OSC).
 *
 * Wraps the given string as `ESC ] str ST`, where ST is the String Terminator
 * (`ESC \`).
 *
 * @see {@link https://www.ecma-international.org/publications-and-standards/standards/ecma-48/ | ECMA-48}
 */
export function OSC(str: string): Uint8Array {
  return encode(`\x1b]${str}\x1b\\`);
}

/**
 * Set the mouse pointer shape (OSC 22).
 *
 * Replaces the current pointer shape. Prefer {@link PUSHPOINTERSHAPE} /
 * {@link POPPOINTERSHAPE} when you want the terminal's prior shape restored.
 *
 * @see {@link https://sw.kovidgoyal.net/kitty/pointer-shapes/ | kitty pointer shapes}
 */
export function POINTERSHAPE(shape: CursorShape): Uint8Array {
  return OSC(`22;${shape}`);
}

/**
 * Push a mouse pointer shape onto the terminal's pointer-shape stack (OSC 22).
 *
 * The pushed shape becomes current; {@link POPPOINTERSHAPE} restores whatever
 * was current before. This is the kitty stack extension and is how shapes are
 * saved and restored without querying the terminal's prior shape.
 */
export function PUSHPOINTERSHAPE(shape: CursorShape): Uint8Array {
  return OSC(`22;>${shape}`);
}

/**
 * Pop the top mouse pointer shape off the stack (OSC 22), restoring the shape
 * that was current before the matching {@link PUSHPOINTERSHAPE}.
 */
export function POPPOINTERSHAPE(): Uint8Array {
  return OSC("22;<");
}

/**
 * Query the terminal's mouse pointer shape support (OSC 22).
 *
 * With no arguments, asks for the current shape (`?__current__`). With one or
 * more shape names, asks which are supported. The terminal replies on the
 * input stream; the reply is decoded as a `PointerShapeEvent` (see the input
 * parser). Terminals without query support never reply.
 */
export function QUERYPOINTERSHAPE(...shapes: CursorShape[]): Uint8Array {
  return OSC(`22;?${shapes.length > 0 ? shapes.join(",") : "__current__"}`);
}

const encoder = new TextEncoder();

function encode(str: string): Uint8Array {
  return encoder.encode(str);
}
