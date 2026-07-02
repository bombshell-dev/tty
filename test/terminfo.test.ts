/**
 * Tests for specs/terminfo-spec.md: the capability struct, baseline and
 * evidence model, terminfo binary parsing, and the queryTermInfo API.
 * Probe response recognition is tested against the input spec
 * (input.test.ts) and renderer gating against the renderer spec
 * (term.test.ts / color.test.ts).
 */

import { queryTermInfo } from "../terminfo.ts";
import { createInput } from "../input.ts";
import { createTerm } from "../term.ts";
import {
  CLAYTERM_16,
  CLAYTERM_DIRECT,
  CLAYTERM_TC,
  XTERM_256COLOR,
} from "./fixtures.ts";
import { describe, expect, it } from "./suite.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

function mockOutput(tty = true) {
  let written: Uint8Array[] = [];
  return {
    written,
    stream: {
      isTTY: tty,
      write(bytes: Uint8Array) {
        written.push(bytes.slice());
        return true;
      },
    },
  };
}

function mockInput(tty = true) {
  let listeners = new Set<(chunk: Uint8Array) => void>();
  let rawCalls: boolean[] = [];
  return {
    rawCalls,
    feed(bytes: Uint8Array) {
      for (let cb of [...listeners]) cb(bytes);
    },
    stream: {
      isTTY: tty,
      isRaw: false,
      setRawMode(raw: boolean) {
        rawCalls.push(raw);
      },
      on(_event: "data", cb: (chunk: Uint8Array) => void) {
        listeners.add(cb);
      },
      off(_event: "data", cb: (chunk: Uint8Array) => void) {
        listeners.delete(cb);
      },
      resume() {},
      pause() {},
      isPaused: () => false,
    },
  };
}

/** queryTermInfo options that skip both the fs lookup and the probe. */
function offline(overrides: Record<string, unknown> = {}) {
  return {
    env: {},
    input: mockInput(false).stream,
    output: mockOutput(false).stream,
    ...overrides,
  };
}

const BASELINE = {
  generation: 1,
  colors: 256,
  trueColor: false,
  bce: true,
  autoMargin: true,
  altScreen: true,
  styledUnderline: false,
  syncOutput: false,
  kittyKeyboard: false,
  kittyGraphics: false,
  kittyColor: false,
  hyperlinks: false,
  pointerShape: false,
  theme: {},
};

describe("baseline", () => {
  it("initializes to the xterm-256color baseline with no evidence", async () => {
    let ti = await queryTermInfo(offline());
    expect(ti.capabilities).toEqual(BASELINE);
  });

  it("does not assume truecolor at baseline", async () => {
    let ti = await queryTermInfo(offline());
    expect(ti.capabilities.trueColor).toBe(false);
  });
});

describe("terminfo parsing", () => {
  it("parses a real xterm-256color entry (legacy format)", async () => {
    let ti = await queryTermInfo(offline({ terminfo: XTERM_256COLOR }));
    let caps = ti.capabilities;
    expect(caps.colors).toBe(256);
    expect(caps.trueColor).toBe(false);
    expect(caps.bce).toBe(true);
    expect(caps.autoMargin).toBe(true);
    expect(caps.altScreen).toBe(true);
    expect(caps.generation).toBeGreaterThan(1);
  });

  it("reads Tc / Su / Smulx from the extended capability table", async () => {
    let ti = await queryTermInfo(offline({ terminfo: CLAYTERM_TC }));
    let caps = ti.capabilities;
    expect(caps.trueColor).toBe(true);
    expect(caps.styledUnderline).toBe(true);
    expect(caps.colors).toBe(256);
    expect(caps.bce).toBe(true);
  });

  it("parses the extended number format (magic 01036)", async () => {
    let ti = await queryTermInfo(offline({ terminfo: CLAYTERM_DIRECT }));
    let caps = ti.capabilities;
    expect(caps.colors).toBe(0x1000000);
    expect(caps.trueColor).toBe(true);
    expect(caps.altScreen).toBe(true);
    expect(caps.bce).toBe(false);
  });

  it("downgrades below baseline on terminfo evidence", async () => {
    let ti = await queryTermInfo(offline({ terminfo: CLAYTERM_16 }));
    let caps = ti.capabilities;
    expect(caps.colors).toBe(16);
    expect(caps.altScreen).toBe(false);
    expect(caps.bce).toBe(false);
    expect(caps.trueColor).toBe(false);
  });

  it("keeps the baseline untouched on truncated input", async () => {
    let ti = await queryTermInfo(
      offline({ terminfo: XTERM_256COLOR.slice(0, 30) }),
    );
    expect(ti.capabilities).toEqual(BASELINE);
  });

  it("keeps the baseline untouched on garbage input", async () => {
    let ti = await queryTermInfo(offline({ terminfo: new Uint8Array(128) }));
    expect(ti.capabilities).toEqual(BASELINE);
  });

  it("rejects terminfo larger than 32768 bytes", async () => {
    await expect(
      queryTermInfo(offline({ terminfo: new Uint8Array(32769) })),
    ).rejects.toThrow(RangeError);
  });
});

describe("environment evidence", () => {
  it("grants truecolor from COLORTERM=truecolor", async () => {
    let ti = await queryTermInfo(offline({
      terminfo: XTERM_256COLOR,
      env: { COLORTERM: "truecolor" },
    }));
    expect(ti.capabilities.trueColor).toBe(true);
  });

  it("grants truecolor from COLORTERM=24bit", async () => {
    let ti = await queryTermInfo(offline({ env: { COLORTERM: "24bit" } }));
    expect(ti.capabilities.trueColor).toBe(true);
  });

  it("ignores other COLORTERM values", async () => {
    let ti = await queryTermInfo(offline({ env: { COLORTERM: "yes" } }));
    expect(ti.capabilities.trueColor).toBe(false);
  });

  it("bumps the generation when evidence changes capabilities", async () => {
    let ti = await queryTermInfo(offline({ env: { COLORTERM: "truecolor" } }));
    expect(ti.capabilities.generation).toBeGreaterThan(1);
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
    let ti = await queryTermInfo(offline({
      env: { TERM: "clayterm-tc", TERMINFO: db },
    }));
    expect(ti.capabilities.trueColor).toBe(true);
  });

  it("finds an entry under $TERMINFO (first-letter layout)", async () => {
    let db = await fixtureDb("letter");
    let ti = await queryTermInfo(offline({
      env: { TERM: "clayterm-tc", TERMINFO: db },
    }));
    expect(ti.capabilities.trueColor).toBe(true);
  });

  it("finds an entry under $HOME/.terminfo", async () => {
    let home = await Deno.makeTempDir();
    await Deno.mkdir(`${home}/.terminfo/63`, { recursive: true });
    await Deno.writeFile(`${home}/.terminfo/63/clayterm-tc`, CLAYTERM_TC);
    let ti = await queryTermInfo(offline({
      env: { TERM: "clayterm-tc", HOME: home },
    }));
    expect(ti.capabilities.trueColor).toBe(true);
  });

  it("resolves to the baseline when no entry is found", async () => {
    let db = await Deno.makeTempDir();
    let ti = await queryTermInfo(offline({
      env: { TERM: "does-not-exist", TERMINFO: db },
    }));
    expect(ti.capabilities).toEqual(BASELINE);
  });

  it("rejects terminal names with path separators", async () => {
    let db = await Deno.makeTempDir();
    let ti = await queryTermInfo(offline({
      env: { TERM: "../../etc/passwd", TERMINFO: db },
    }));
    expect(ti.capabilities).toEqual(BASELINE);
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
    let ti = await queryTermInfo(offline());
    expect(decode(ti.probe())).toBe(PROBE);
  });

  it("writes the probe batch once to a TTY output", async () => {
    let input = mockInput();
    let output = mockOutput();
    await queryTermInfo({
      env: {},
      input: input.stream,
      output: output.stream,
      timeout: 10,
    });
    expect(output.written.length).toBe(1);
    expect(decode(output.written[0])).toBe(PROBE);
  });

  it("does not write the probe to a non-TTY output", async () => {
    let input = mockInput(false);
    let output = mockOutput(false);
    await queryTermInfo({
      env: {},
      input: input.stream,
      output: output.stream,
      timeout: 10,
    });
    expect(output.written.length).toBe(0);
  });

  it("enables raw mode for the probe window and restores it", async () => {
    let input = mockInput();
    let output = mockOutput();
    await queryTermInfo({
      env: {},
      input: input.stream,
      output: output.stream,
      timeout: 10,
    });
    expect(input.rawCalls).toEqual([true, false]);
  });

  it("resolves without probing when the signal is already aborted", async () => {
    let input = mockInput();
    let output = mockOutput();
    let ti = await queryTermInfo({
      env: {},
      input: input.stream,
      output: output.stream,
      timeout: 1000,
      signal: AbortSignal.abort(),
    });
    expect(output.written.length).toBe(0);
    expect(ti.capabilities).toEqual(BASELINE);
  });

  it("resolves on timeout when the terminal never answers", async () => {
    let input = mockInput();
    let output = mockOutput();
    let before = Date.now();
    let ti = await queryTermInfo({
      env: {},
      input: input.stream,
      output: output.stream,
      timeout: 10,
    });
    expect(Date.now() - before).toBeLessThan(1000);
    expect(ti.capabilities).toEqual(BASELINE);
  });
});

describe("probe fence", () => {
  it("resolves on the DA1 fence and applies probe responses", async () => {
    let input = mockInput();
    let output = mockOutput();
    let promise = queryTermInfo({
      env: {},
      input: input.stream,
      output: output.stream,
      timeout: 5000,
    });

    // wait for the probe write, then answer like a capable terminal
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(output.written.length).toBe(1);
    let before = Date.now();
    input.feed(new TextEncoder().encode(
      "\x1b]11;rgb:1e1e/2a2a/3b3b\x1b\\" +
        "\x1bP1+r524742\x1b\\" +
        "\x1b[?2026;2$y" +
        "\x1b[?1u" +
        "\x1b_Gi=31;OK\x1b\\" +
        "\x1b[?65;1;9c",
    ));

    let ti = await promise;
    expect(Date.now() - before).toBeLessThan(1000);
    let caps = ti.capabilities;
    expect(caps.theme.background).toEqual({ r: 0x1e, g: 0x2a, b: 0x3b });
    expect(caps.trueColor).toBe(true);
    expect(caps.syncOutput).toBe(true);
    expect(caps.kittyKeyboard).toBe(true);
    expect(caps.kittyGraphics).toBe(true);
  });

  it("keeps unanswered capabilities at their static values", async () => {
    let input = mockInput();
    let output = mockOutput();
    let promise = queryTermInfo({
      env: {},
      input: input.stream,
      output: output.stream,
      timeout: 5000,
    });

    await new Promise((resolve) => setTimeout(resolve, 1));
    // a terminal that only answers DA1
    input.feed(new TextEncoder().encode("\x1b[?1;2c"));

    let ti = await promise;
    expect(ti.capabilities.trueColor).toBe(false);
    expect(ti.capabilities.syncOutput).toBe(false);
    expect(ti.capabilities.theme).toEqual({});
  });
});

describe("attachment", () => {
  it("allows at most one Input per handle", async () => {
    let ti = await queryTermInfo(offline());
    await createInput({ terminfo: ti });
    await expect(createInput({ terminfo: ti })).rejects.toThrow(
      "already attached",
    );
  });

  it("allows at most one Term per handle", async () => {
    let ti = await queryTermInfo(offline());
    await createTerm({ width: 4, height: 2, terminfo: ti });
    await expect(createTerm({ width: 4, height: 2, terminfo: ti }))
      .rejects.toThrow("already attached");
  });
});
