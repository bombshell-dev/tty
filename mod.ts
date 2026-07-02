export * from "./ops.ts";
export * from "./term.ts";
export * from "./input.ts";
export * from "./settings.ts";
export * from "./termcodes.ts";
// terminfo.ts also exports internals(), the attachment surface for
// createTerm/createInput — deliberately not re-exported here.
export {
  type Capabilities,
  MAX_TERMINFO,
  type ProbeInput,
  type ProbeOutput,
  queryTermInfo,
  type QueryTermInfoOptions,
  type Rgb,
  type TermInfo,
} from "./terminfo.ts";
