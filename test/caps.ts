/**
 * Test helpers for building TermInfo handles without a filesystem or a
 * TTY: streams are non-TTY mocks so queryTermInfo never probes.
 */

import { queryTermInfo, type QueryTermInfoOptions } from "../terminfo.ts";

export function offlineTermInfo(options: Partial<QueryTermInfoOptions> = {}) {
  return queryTermInfo({
    env: {},
    input: { isTTY: false, on() {}, off() {} },
    output: { isTTY: false, write() {} },
    ...options,
  });
}

/** A handle with truecolor granted via COLORTERM evidence. */
export function trueColorTermInfo() {
  return offlineTermInfo({ env: { COLORTERM: "truecolor" } });
}
