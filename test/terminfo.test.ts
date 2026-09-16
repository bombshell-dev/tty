/**
 * Tests for specs/terminfo-spec.md: capability struct, baseline and
 * evidence model, terminfo binary parsing, and the detectTerminal API.
 * Probe response recognition is tested in input.test.ts.
 * Renderer capability gating is tested in color.test.ts.
 */

import { detectTerminal } from "../terminfo.ts";
import {
  CLAYTERM_16,
  CLAYTERM_DIRECT,
  CLAYTERM_TC,
  XTERM_256COLOR,
} from "./fixtures.ts";
import { describe, expect, it } from "./suite.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

const BASELINE = {
  colors: 256,
  trueColor: false,
  bce: true,
  autoMargin: true,
  xenl: true,
  altScreen: true,
  styledUnderline: false,
};

describe("baseline", () => {
  it("initializes to the baseline with no evidence", async () => {
    let d = await detectTerminal({ env: {} });
    expect(d.capabilities).toEqual(BASELINE);
  });

  it("does not assume truecolor at baseline", async () => {
    let d = await detectTerminal({ env: {} });
    expect(d.capabilities.trueColor).toBe(false);
  });
});

describe("terminfo parsing", () => {
  it("parses a real xterm-256color entry (legacy format)", async () => {
    let d = await detectTerminal({ env: {}, terminfo: XTERM_256COLOR });
    let caps = d.capabilities;
    expect(caps.colors).toBe(256);
    expect(caps.trueColor).toBe(false);
    expect(caps.bce).toBe(true);
    expect(caps.autoMargin).toBe(true);
    expect(caps.altScreen).toBe(true);
  });

  it("reads Tc / Su / Smulx from the extended capability table", async () => {
    let d = await detectTerminal({ env: {}, terminfo: CLAYTERM_TC });
    let caps = d.capabilities;
    expect(caps.trueColor).toBe(true);
    expect(caps.styledUnderline).toBe(true);
    expect(caps.colors).toBe(256);
    expect(caps.bce).toBe(true);
  });

  it("parses the extended number format (magic 01036)", async () => {
    let d = await detectTerminal({ env: {}, terminfo: CLAYTERM_DIRECT });
    let caps = d.capabilities;
    expect(caps.colors).toBe(0x1000000);
    expect(caps.trueColor).toBe(true);
    expect(caps.altScreen).toBe(true);
    expect(caps.bce).toBe(false);
  });

  it("downgrades below baseline on terminfo evidence", async () => {
    let d = await detectTerminal({ env: {}, terminfo: CLAYTERM_16 });
    let caps = d.capabilities;
    expect(caps.colors).toBe(16);
    expect(caps.altScreen).toBe(false);
    expect(caps.bce).toBe(false);
    expect(caps.trueColor).toBe(false);
  });

  it("keeps the baseline untouched on truncated input", async () => {
    let d = await detectTerminal({
      env: {},
      terminfo: XTERM_256COLOR.slice(0, 30),
    });
    expect(d.capabilities).toEqual(BASELINE);
  });

  it("keeps the baseline untouched on garbage input", async () => {
    let d = await detectTerminal({ env: {}, terminfo: new Uint8Array(128) });
    expect(d.capabilities).toEqual(BASELINE);
  });

  it("rejects terminfo larger than 32768 bytes", async () => {
    await expect(
      detectTerminal({ env: {}, terminfo: new Uint8Array(32769) }),
    ).rejects.toThrow(RangeError);
  });
});

describe("environment evidence", () => {
  it("grants truecolor from COLORTERM=truecolor", async () => {
    let d = await detectTerminal({
      env: { COLORTERM: "truecolor" },
      terminfo: XTERM_256COLOR,
    });
    expect(d.capabilities.trueColor).toBe(true);
  });

  it("grants truecolor from COLORTERM=24bit", async () => {
    let d = await detectTerminal({ env: { COLORTERM: "24bit" } });
    expect(d.capabilities.trueColor).toBe(true);
  });

  it("ignores other COLORTERM values", async () => {
    let d = await detectTerminal({ env: { COLORTERM: "yes" } });
    expect(d.capabilities.trueColor).toBe(false);
  });
});

describe("filesystem lookup", () => {
  async function fixtureDb(layout: "hex" | "letter"): Promise<string> {
    let dir = await Deno.makeTempDir();
    let sub = layout === "hex" ? "63" : "c";
    await Deno.mkdir(`${dir}/${sub}`, { recursive: true });
    await Deno.writeFile(`${dir}/${sub}/clayterm-tc`, CLAYTERM_TC);
    return dir;
  }

  it("finds an entry under $TERMINFO (hex directory layout)", async () => {
    let db = await fixtureDb("hex");
    let d = await detectTerminal({
      env: { TERM: "clayterm-tc", TERMINFO: db },
    });
    expect(d.capabilities.trueColor).toBe(true);
  });

  it("finds an entry under $TERMINFO (first-letter layout)", async () => {
    let db = await fixtureDb("letter");
    let d = await detectTerminal({
      env: { TERM: "clayterm-tc", TERMINFO: db },
    });
    expect(d.capabilities.trueColor).toBe(true);
  });

  it("finds an entry under $HOME/.terminfo", async () => {
    let home = await Deno.makeTempDir();
    await Deno.mkdir(`${home}/.terminfo/63`, { recursive: true });
    await Deno.writeFile(`${home}/.terminfo/63/clayterm-tc`, CLAYTERM_TC);
    let d = await detectTerminal({ env: { TERM: "clayterm-tc", HOME: home } });
    expect(d.capabilities.trueColor).toBe(true);
  });

  it("resolves to the baseline when no entry is found", async () => {
    let db = await Deno.makeTempDir();
    let d = await detectTerminal({
      env: { TERM: "does-not-exist", TERMINFO: db },
    });
    expect(d.capabilities).toEqual(BASELINE);
  });

  it("rejects terminal names with path separators", async () => {
    let db = await Deno.makeTempDir();
    let d = await detectTerminal({
      env: { TERM: "../../etc/passwd", TERMINFO: db },
    });
    expect(d.capabilities).toEqual(BASELINE);
  });
});

const PROBE = "\x1b]10;?\x07" +
  "\x1b]11;?\x07" +
  "\x1b]12;?\x07" +
  "\x1b]21;foreground=?;background=?;cursor=?\x1b\\" +
  "\x1b]22;?__current__\x1b\\" +
  "\x1bP+q524742;5463\x1b\\" +
  "\x1b[?2026$p" +
  "\x1b[?u" +
  "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\" +
  "\x1b[c";

describe("probe", () => {
  it("returns the query batch fenced by DA1", async () => {
    let d = await detectTerminal({ env: {} });
    expect(decode(d.probe)).toBe(PROBE);
  });

  it("probe is a Uint8Array", async () => {
    let d = await detectTerminal({ env: {} });
    expect(d.probe).toBeInstanceOf(Uint8Array);
  });
});

describe("Detection shape", () => {
  it("is frozen", async () => {
    let d = await detectTerminal({ env: {} });
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.capabilities)).toBe(true);
  });

  it("keys is a Uint8Array (empty when no terminfo file found)", async () => {
    let d = await detectTerminal({ env: {} });
    expect(d.keys).toBeInstanceOf(Uint8Array);
  });

  it("keys holds the parsed terminfo bytes when an entry is found", async () => {
    let d = await detectTerminal({ env: {}, terminfo: CLAYTERM_TC });
    expect(d.keys.byteLength).toBe(CLAYTERM_TC.byteLength);
  });
});
