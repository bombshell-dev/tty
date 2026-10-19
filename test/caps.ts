import { type DetectOptions, detectTerminal } from "../terminfo.ts";

export function offlineDetect(options: Partial<DetectOptions> = {}) {
  return detectTerminal({ env: {}, ...options });
}

/** A TerminalInfo with truecolor granted via COLORTERM evidence. */
export function trueColorDetect() {
  return offlineDetect({ env: { COLORTERM: "truecolor" } });
}
