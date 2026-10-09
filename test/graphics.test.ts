/* test/graphics.test.ts — the Graphics Specification's test suite (§14).
 * One spec, one test file. */

import { createInput } from "../input.ts";
import { close, img, type Op, open, type SizingAxis } from "../ops.ts";
import { createTerm } from "../term.ts";
import { describe, it } from "./suite.ts";
import { print } from "./print.ts";

const KITTY_GRANT = {
  type: "capability",
  key: "kitty-graphics",
  value: true,
} as const;
const KITTY_DENY = {
  type: "capability",
  key: "kitty-graphics",
  value: false,
} as const;

/** Solid-color W×H RGBA image. */
function solid(w: number, h: number, rgb: [number, number, number]): {
  width: number;
  height: number;
  pixels: Uint8Array;
} {
  let pixels = new Uint8Array(w * h * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = rgb[0];
    pixels[i + 1] = rgb[1];
    pixels[i + 2] = rgb[2];
    pixels[i + 3] = 255;
  }
  return { width: w, height: h, pixels };
}

async function term(w = 40, h = 12) {
  return await createTerm({ width: w, height: h });
}

/** Render a frame and return the output as a string. */
function frame(t: Awaited<ReturnType<typeof term>>, ops: Op[]): string {
  return new TextDecoder().decode(t.render(ops).output);
}

function grid(t: Awaited<ReturnType<typeof term>>, ops: Op[]): string[] {
  let text = print(frame(t, ops), 40, 12);
  return text.split("\n");
}

describe("graphics: tier resolution", () => {
  it("renders ascii art without evidence (auto ladder)", async () => {
    let t = await term();
    t.setImage(1, solid(8, 8, [255, 0, 0]));
    let out = frame(t, [img("a", { image: 1, alt: "x" })]);
    if (out.includes("\x1b_G")) throw new Error("kitty bytes without evidence");
    if (!out.includes("\x1b[38;2;255;0;0m")) throw new Error("no art color");
  });

  it("kitty tier after the capability grant", async () => {
    let t = await term();
    t.setImage(1, solid(8, 8, [255, 0, 0]));
    t.update([KITTY_GRANT]);
    let out = frame(t, [img("a", { image: 1, alt: "x" })]);
    if (!out.includes("\x1b_Ga=t,t=d,f=32,i=1,s=8,v=8,")) {
      throw new Error("no transmission block");
    }
    if (!out.includes("\x1b_Ga=p,i=1,p=")) throw new Error("no placement");
    if (!out.includes("q=2")) throw new Error("not quiet");
  });

  it("variant override: alt force, kitty fall-through, ascii direct", async () => {
    let t = await term();
    t.setImage(1, solid(8, 8, [255, 0, 0]));
    let alt = frame(t, [img("a", { image: 1, alt: "hart", variant: "alt" })]);
    if (alt.includes("\x1b_G") || !alt.includes("hart")) {
      throw new Error("variant alt not honored");
    }
    let kitty = frame(t, [
      img("a", { image: 1, alt: "x", variant: "kitty" }),
    ]);
    if (kitty.includes("\x1b_G")) {
      throw new Error("variant kitty ignored missing evidence");
    }
    // fresh color: the identical art frame would diff to silence
    t.setImage(2, solid(8, 8, [0, 255, 0]));
    let ascii = frame(t, [
      img("a", { image: 2, alt: "x", variant: "ascii" }),
    ]);
    if (ascii.includes("\x1b_G") || !ascii.includes("\x1b[38;2;0;255;0m")) {
      throw new Error("variant ascii not honored");
    }
  });

  it("image omitted renders alt-only without error", async () => {
    let t = await term();
    let out = frame(t, [img("a", { alt: "chart: revenue" })]);
    if (!out.includes("chart: revenue")) throw new Error("alt not rendered");
    let errs = t.render([img("a", { alt: "chart: revenue" })]).errors;
    if (errs.length !== 0) throw new Error("unexpected error");
  });

  it("missing registry id renders alt tier + IMAGE_NOT_FOUND", async () => {
    let t = await term();
    let r = t.render([img("a", { image: 99, alt: "fallback" })]);
    if (!new TextDecoder().decode(r.output).includes("fallback")) {
      throw new Error("no alt fallback");
    }
    let found = r.errors.some((e) => e.type === "IMAGE_NOT_FOUND");
    if (!found) throw new Error("IMAGE_NOT_FOUND not surfaced");
  });

  it("line mode caps the ladder at ascii", async () => {
    let t = await term();
    t.setImage(1, solid(8, 8, [255, 0, 0]));
    t.update([KITTY_GRANT]);
    let out = new TextDecoder().decode(
      t.render([img("a", { image: 1, alt: "x" })], { mode: "line" }).output,
    );
    if (out.includes("\x1b_G")) throw new Error("APC bytes in line mode");
  });
});

describe("graphics: kitty conformance", () => {
  it("steady state is byte-silent", async () => {
    let t = await term();
    t.setImage(1, solid(8, 8, [255, 0, 0]));
    t.update([KITTY_GRANT]);
    frame(t, [img("a", { image: 1, alt: "x" })]);
    let out = frame(t, [img("a", { image: 1, alt: "x" })]);
    if (out.includes("\x1b_G")) throw new Error("re-emitted graphics bytes");
  });

  it("chunks large payloads m=1/m=0 at 4096 base64 chars", async () => {
    let t = await term();
    t.setImage(1, solid(40, 40, [0, 255, 0])); // 6400 bytes → 3 chunks
    t.update([KITTY_GRANT]);
    let out = frame(t, [img("a", { image: 1, alt: "x" })]);
    let blocks = out.split("\x1b_G").length - 1;
    if (blocks !== 4) {
      throw new Error(`expected tx 3 chunks + 1 placement, got ${blocks}`);
    }
    let m1 = out.match(/m=1/g)?.length ?? 0;
    let m0 = out.match(/m=0/g)?.length ?? 0;
    if (m1 !== 2 || m0 !== 1) throw new Error(`m flags ${m1}/${m0}`);
    let first = out.indexOf("a=t,t=d,f=32,i=1,s=40,v=40");
    if (first < 0) throw new Error("tx header missing");
  });

  it("replace re-transmits with delete-before-transmit, re-places", async () => {
    let t = await term();
    t.setImage(1, solid(8, 8, [255, 0, 0]));
    t.update([KITTY_GRANT]);
    frame(t, [img("a", { image: 1, alt: "x" })]);
    t.setImage(1, solid(8, 8, [0, 0, 255])); // version bump
    let out = frame(t, [img("a", { image: 1, alt: "x" })]);
    let dIdx = out.indexOf("\x1b_Ga=d,d=I,i=1");
    let txIdx = out.indexOf("\x1b_Ga=t,t=d,f=32,i=1");
    let pIdx = out.indexOf("\x1b_Ga=p,i=1,p=");
    if (dIdx < 0 || txIdx < 0 || pIdx < 0) {
      throw new Error("replace cycle incomplete");
    }
    if (!(dIdx < txIdx && txIdx < pIdx)) {
      throw new Error("ordering: delete, transmit, place");
    }
  });

  it("move re-places with the same placement id, no delete/re-transmit", async () => {
    let t = await term(40, 12);
    t.setImage(1, solid(4, 4, [255, 0, 0]));
    t.update([KITTY_GRANT]);
    let one = frame(t, [img("a", { image: 1, alt: "x" })]);
    let pid = one.match(/a=p,i=1,p=(\d+)/)?.[1];
    if (!pid) throw new Error("no pid");
    frame(t, [img("a", { image: 1, alt: "x" })]); // steady: silent
    // move: the same directive inside a padded container shifts the
    // element's box (Clay's root is the window, so an img-as-root cannot
    // move: its footprint is window-derived)
    let three = frame(t, [
      open("wrap", { layout: { padding: { left: 2, top: 2 } } }),
      img("a", { image: 1, alt: "x" }),
      close(),
    ]);
    if (!three.includes(`a=p,i=1,p=${pid},c=`)) {
      throw new Error("move lost the placement id");
    }
    if (three.includes("a=d,")) throw new Error("move emitted a deletion");
    if (three.includes("a=t,")) throw new Error("move re-transmitted");
  });

  it("unmount deletes the scoped placement and repaints", async () => {
    let t = await term(40, 12);
    t.setImage(1, solid(4, 4, [255, 0, 0]));
    t.update([KITTY_GRANT]);
    let one = frame(t, [img("a", { image: 1, alt: "x" })]);
    let pid = one.match(/a=p,i=1,p=(\d+)/)?.[1];
    let out = frame(t, []); // element gone
    if (!out.includes(`a=d,d=i,i=1,p=${pid}`)) {
      throw new Error("no scoped deletion on unmount");
    }
    let g = print(out, 40, 12).split("\n");
    // the old footprint repaints as blank content (space), not graphics
    if (g[0].slice(0, 4) !== "    ") throw new Error("footprint not repainted");
  });

  it("removeImage returns the d=I block and is idempotent", async () => {
    let t = await term();
    t.setImage(1, solid(4, 4, [255, 0, 0]));
    t.update([KITTY_GRANT]);
    frame(t, [img("a", { image: 1, alt: "x" })]);
    let bytes = new TextDecoder().decode(t.removeImage(1));
    if (!bytes.includes("\x1b_Ga=d,d=I,i=1")) throw new Error("no d=I");
    let again = t.removeImage(1);
    if (again.length !== 0) throw new Error("not idempotent");
  });

  it("removeImage without kitty evidence still deletes (earlier evidence)", async () => {
    let t = await term();
    t.setImage(1, solid(4, 4, [255, 0, 0]));
    t.update([KITTY_GRANT]);
    frame(t, [img("a", { image: 1, alt: "x" })]);
    t.update([KITTY_DENY]); // denial itself cleans + falls back
    // after denial, re-remove: the entry is still live, so d=I flows again
    let bytes = new TextDecoder().decode(t.removeImage(1));
    if (!bytes.includes("a=d,d=I,i=1")) throw new Error("denial ate removal");
  });
});

describe("graphics: capability invalidation", () => {
  it("denial returns immediate deletion bytes (TINV-5)", async () => {
    let t = await term();
    t.setImage(1, solid(4, 4, [255, 0, 0]));
    t.update([KITTY_GRANT]);
    frame(t, [img("a", { image: 1, alt: "x" })]);
    let bytes = new TextDecoder().decode(t.update([KITTY_DENY]));
    if (!bytes.includes("\x1b_Ga=d,d=I,i=1")) {
      throw new Error("no immediate denial bytes");
    }
  });

  it("grant then render emits kitty; denial render falls back to ascii", async () => {
    let t = await term();
    t.setImage(1, solid(8, 8, [255, 0, 0]));
    t.update([KITTY_GRANT]);
    let kitty = frame(t, [img("a", { image: 1, alt: "x" })]);
    if (!kitty.includes("\x1b_Ga=p")) throw new Error("grant not honored");
    t.update([KITTY_DENY]);
    let ascii = frame(t, [img("a", { image: 1, alt: "x" })]);
    if (ascii.includes("\x1b_G")) throw new Error("kitty after denial");
    if (!ascii.includes("\x1b[38;2;255;0;0m")) throw new Error("no ascii art");
  });

  it("re-arming re-transmits (stored data is never trusted)", async () => {
    let t = await term();
    t.setImage(1, solid(8, 8, [255, 0, 0]));
    t.update([KITTY_GRANT]);
    frame(t, [img("a", { image: 1, alt: "x" })]);
    t.update([KITTY_DENY]);
    t.update([KITTY_GRANT]);
    let out = frame(t, [img("a", { image: 1, alt: "x" })]);
    if (!out.includes("\x1b_Ga=t,")) {
      throw new Error("re-arm skipped re-transmission");
    }
  });
});

describe("graphics: resize", () => {
  it("resize returns deletion bytes; next render re-transmits + re-places", async () => {
    let t = await term(40, 12);
    t.setImage(1, solid(8, 8, [255, 0, 0]));
    t.update([KITTY_GRANT]);
    frame(t, [img("a", { image: 1, alt: "x" })]);
    let bytes = new TextDecoder().decode(
      t.update([{ type: "resize", width: 30, height: 10 }]),
    );
    if (!bytes.includes("\x1b_Ga=d,d=I,i=1")) {
      throw new Error("no resize deletion bytes");
    }
    let out = frame(t, [img("a", { image: 1, alt: "x" })]);
    if (!out.includes("\x1b_Ga=t,")) throw new Error("no re-transmission");
    if (!out.includes("\x1b_Ga=p,i=1,p=")) throw new Error("no re-place");
  });
});

describe("graphics: ascii art", () => {
  it("solid red square paints uniform density glyphs in red", async () => {
    let t = await term();
    t.setImage(1, solid(8, 8, [255, 0, 0]));
    let g = grid(t, [img("a", { image: 1, alt: "x" })]);
    for (let y = 0; y < 4; y++) {
      if (g[y].slice(0, 8) !== "::::::::") {
        throw new Error(`row ${y}: ${JSON.stringify(g[y].slice(0, 8))}`);
      }
    }
    // intrinsic size under the half-row convention: 8 cols × ceil(8/2)=4 rows
    for (let y = 4; y < 12; y++) {
      if (g[y].slice(0, 8) !== "        ") {
        throw new Error(`row ${y} painted outside the footprint`);
      }
    }
  });

  it("luminance ordering: dark square paints lower-density glyphs", async () => {
    let t = await term();
    t.setImage(1, solid(8, 8, [40, 40, 40]));
    let dark = grid(t, [img("a", { image: 1, alt: "x" })])[0].slice(0, 8);
    t.setImage(2, solid(8, 8, [220, 220, 220]));
    let light = grid(t, [img("b", { image: 2, alt: "x" })])[0].slice(0, 8);
    if (dark === light) throw new Error("luminance did not change density");
  });

  it("determinism: identical inputs, identical art bytes", async () => {
    let a = await term();
    let b = await term();
    a.setImage(1, solid(8, 8, [90, 140, 200]));
    b.setImage(1, solid(8, 8, [90, 140, 200]));
    if (
      frame(a, [img("a", { image: 1, alt: "x" })]) !==
        frame(b, [img("a", { image: 1, alt: "x" })])
    ) {
      throw new Error("nondeterministic art");
    }
  });

  it("alpha below the threshold is transparent and keeps the background", async () => {
    let t = await term();
    // element bg declared; image fully transparent
    let px = new Uint8Array(8 * 8 * 4); // alpha 0 everywhere
    t.setImage(1, { width: 8, height: 8, pixels: px });
    let bg = 0xff102030; // rgba(): alpha 255 = opaque declared bg
    let out = frame(t, [img("a", { image: 1, alt: "x", bg })]);
    let g = print(out, 40, 12).split("\n");
    if (g[0].slice(0, 8) !== "        ") throw new Error("not blank");
    // the bg is element-declared; the blank cell carries it — asserted via
    // the raw output's bg SGR
    if (!out.includes("\x1b[48;2;16;32;48m")) {
      throw new Error("element bg missing under transparent art");
    }
  });
});

describe("graphics: alt tier", () => {
  it("empty alt renders an empty box (decorative)", async () => {
    let t = await term();
    let g = print(frame(t, [img("a", { alt: "" })]), 40, 12).split("\n");
    for (let y = 0; y < 12; y++) {
      if (g[y].trim() !== "") throw new Error("decorative img painted");
    }
  });
});

describe("graphics: registry API", () => {
  it("setImage validation throws RangeError", async () => {
    let t = await term();
    let bad = [-1, 0, 4294967296, 1.5] as number[];
    for (let id of bad) {
      let threw = false;
      try {
        t.setImage(id, solid(2, 2, [0, 0, 0]));
      } catch (e) {
        threw = e instanceof RangeError;
      }
      if (!threw) throw new Error(`id ${id} accepted`);
    }
    let threw = false;
    try {
      t.setImage(1, { width: 2, height: 2, pixels: new Uint8Array(3) });
    } catch (e) {
      threw = e instanceof RangeError;
    }
    if (!threw) throw new Error("length mismatch accepted");
  });

  it("input.scan() sees zero events from the APC frames alone", async () => {
    let t = await term();
    t.setImage(1, solid(8, 8, [255, 0, 0]));
    t.update([KITTY_GRANT]);
    let out = frame(t, [img("a", { image: 1, alt: "x" })]);
    // INV-I5's claim is about the graphics frames themselves: fed to the
    // input parser, an APC frame generates no responses of any kind
    // deno-lint-ignore no-control-regex
    let apc = out.match(/\x1b_G[^\x1b]*\x1b\\/g) ?? [];
    if (apc.length === 0) throw new Error("no APC frames to test");
    let input = await createInput();
    let { events } = input.scan(new TextEncoder().encode(apc.join("")));
    if (events.length !== 0) {
      throw new Error(`input parser saw ${events.length} events`);
    }
  });
});

describe("graphics: validation", () => {
  it("img ops pass validate()", async () => {
    let { validate } = await import("../validate.ts");
    let sizing: SizingAxis = { type: "fixed", value: 8 };
    if (
      !validate([
        img("a", { image: 1, alt: "x" }),
        img("b", { alt: "", width: sizing, height: sizing, variant: "ascii" }),
      ])
    ) {
      throw new Error("valid img ops rejected");
    }
    if (validate([img("c", { image: 0, alt: "x" })])) {
      throw new Error("registry id 0 accepted");
    }
    if (validate([img("d", { image: 1, alt: undefined as never })])) {
      throw new Error("missing alt accepted");
    }
    if (validate([img("e", { alt: "x", variant: "sixel" as never })])) {
      throw new Error("bad variant accepted");
    }
  });
});
