import {
  type DetectOptions,
  detectTerminal,
  type TerminalInfo,
} from "../terminfo.ts";

export function offlineDetect(options: Partial<DetectOptions> = {}) {
  return detectTerminal({ env: {}, ...options });
}

/** A TerminalInfo with truecolor granted via COLORTERM evidence. */
export function trueColorDetect() {
  return offlineDetect({ env: { COLORTERM: "truecolor" } });
}

/** Static truecolor evidence with no probe or key payload. Tests that pin
 * truecolor byte sequences pass this at createTerm to select the truecolor
 * tier (color-encoding-spec §8): without evidence the renderer resolves the
 * 256-color baseline tier. */
export const TRUECOLOR_INFO: TerminalInfo = Object.freeze({
  capabilities: Object.freeze({
    colors: 256,
    trueColor: true,
    bce: true,
    autoMargin: true,
    xenl: true,
    altScreen: true,
    styledUnderline: false,
  }),
  probe: new Uint8Array(0),
  keys: new Uint8Array(0),
});
