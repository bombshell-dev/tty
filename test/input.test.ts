import { beforeEach, describe, expect, it } from "./suite.ts";
import { createInput, type Input } from "../input.ts";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function str(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("input", () => {
  let input: Input;

  beforeEach(async () => {
    input = await createInput({ escLatency: 25 });
  });

  describe("printable ASCII", () => {
    it("parses a single character", () => {
      let result = input.scan(bytes(0x61)); // 'a'
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({ type: "keydown", key: "a" });
    });

    it("parses multiple characters", () => {
      let result = input.scan(str("hello"));
      expect(result.events.length).toBe(5);
      expect(result.events[0]).toMatchObject({ type: "keydown", key: "h" });
      expect(result.events[4]).toMatchObject({ type: "keydown", key: "o" });
    });
  });

  describe("control characters", () => {
    it("parses Ctrl+C", () => {
      let result = input.scan(bytes(0x03));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "c",
        ctrl: true,
      });
    });

    it("parses Tab without ctrl modifier", () => {
      let result = input.scan(bytes(0x09));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({ type: "keydown", key: "Tab" });
    });

    it("parses Enter without ctrl modifier", () => {
      let result = input.scan(bytes(0x0d));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({ type: "keydown", key: "Enter" });
    });
  });

  describe("backspace", () => {
    it("parses 0x7f as backspace", () => {
      let result = input.scan(bytes(0x7f));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "Backspace",
      });
    });
  });

  describe("arrow keys", () => {
    it("parses arrow up (CSI)", () => {
      let result = input.scan(bytes(0x1b, 0x5b, 0x41));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "ArrowUp",
      });
    });

    it("parses arrow down (SS3)", () => {
      let result = input.scan(bytes(0x1b, 0x4f, 0x42));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "ArrowDown",
      });
    });
  });

  describe("modifier combos", () => {
    it("parses Ctrl+Arrow Up", () => {
      let result = input.scan(bytes(0x1b, 0x5b, 0x31, 0x3b, 0x35, 0x41));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "ArrowUp",
        ctrl: true,
      });
    });

    it("parses Shift+Arrow Up", () => {
      let result = input.scan(bytes(0x1b, 0x5b, 0x31, 0x3b, 0x32, 0x41));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "ArrowUp",
        shift: true,
      });
    });

    it("parses Ctrl+Alt+Shift combo", () => {
      let result = input.scan(bytes(0x1b, 0x5b, 0x31, 0x3b, 0x38, 0x41));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "ArrowUp",
        ctrl: true,
        alt: true,
        shift: true,
      });
    });
  });

  describe("function keys", () => {
    it("parses F1 (SS3)", () => {
      let result = input.scan(bytes(0x1b, 0x4f, 0x50));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({ type: "keydown", key: "F1" });
    });

    it("parses F5 (CSI ~)", () => {
      let result = input.scan(str("\x1b[15~"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({ type: "keydown", key: "F5" });
    });
  });

  describe("navigation keys", () => {
    it("parses Home", () => {
      let result = input.scan(bytes(0x1b, 0x4f, 0x48));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({ type: "keydown", key: "Home" });
    });

    it("parses End", () => {
      let result = input.scan(bytes(0x1b, 0x4f, 0x46));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({ type: "keydown", key: "End" });
    });

    it("parses Delete", () => {
      let result = input.scan(str("\x1b[3~"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "Delete",
      });
    });

    it("parses PgDn with Ctrl", () => {
      let result = input.scan(str("\x1b[6;5~"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "PageDown",
        ctrl: true,
      });
    });
  });

  describe("mouse", () => {
    it("parses SGR mouse press", () => {
      let result = input.scan(str("\x1b[<0;35;12M"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "mousedown",
        button: "left",
        x: 34,
        y: 11,
      });
    });

    it("parses SGR left release", () => {
      let result = input.scan(str("\x1b[<0;10;5m"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "mouseup",
        button: "left",
        x: 9,
        y: 4,
      });
    });

    it("parses SGR right release", () => {
      let result = input.scan(str("\x1b[<2;10;5m"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "mouseup",
        button: "right",
        x: 9,
        y: 4,
      });
    });

    it("parses SGR middle release", () => {
      let result = input.scan(str("\x1b[<1;10;5m"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "mouseup",
        button: "middle",
        x: 9,
        y: 4,
      });
    });

    it("parses VT200 release", () => {
      // button 3 = release (0x23 = 3 + 0x20), x=10 (0x2b), y=5 (0x26)
      let result = input.scan(bytes(0x1b, 0x5b, 0x4d, 0x23, 0x2b, 0x26));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "mouseup",
        button: "release",
        x: 10,
        y: 5,
      });
    });

    it("parses SGR wheel up", () => {
      let result = input.scan(str("\x1b[<64;15;20M"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "wheel",
        direction: "up",
        x: 14,
        y: 19,
      });
    });

    it("parses SGR wheel down", () => {
      let result = input.scan(str("\x1b[<65;15;20M"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "wheel",
        direction: "down",
        x: 14,
        y: 19,
      });
    });

    it("parses VT200 mouse", () => {
      // \x1b[M + button(0+0x20=0x20) + x(10+0x21=0x2b) + y(5+0x21=0x26)
      let result = input.scan(bytes(0x1b, 0x5b, 0x4d, 0x20, 0x2b, 0x26));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "mousedown",
        button: "left",
        x: 10,
        y: 5,
      });
    });

    it("parses SGR mouse press with shift", () => {
      // btn=4 (shift bit) => left + shift
      let result = input.scan(str("\x1b[<4;10;5M"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "mousedown",
        button: "left",
        x: 9,
        y: 4,
        shift: true,
      });
    });

    it("parses SGR mouse press with ctrl", () => {
      // btn=16 (ctrl bit) => left + ctrl
      let result = input.scan(str("\x1b[<16;10;5M"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "mousedown",
        button: "left",
        x: 9,
        y: 4,
        ctrl: true,
      });
    });

    it("parses SGR mouse press with alt", () => {
      // btn=8 (alt bit) => left + alt
      let result = input.scan(str("\x1b[<8;10;5M"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "mousedown",
        button: "left",
        x: 9,
        y: 4,
        alt: true,
      });
    });

    it("parses SGR mouse press with ctrl+shift", () => {
      // btn=20 (ctrl=16 + shift=4) => left + ctrl + shift
      let result = input.scan(str("\x1b[<20;10;5M"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "mousedown",
        button: "left",
        x: 9,
        y: 4,
        ctrl: true,
        shift: true,
      });
    });
  });

  describe("ESC timeout", () => {
    it("returns pending for lone ESC", () => {
      let result = input.scan(bytes(0x1b));
      expect(result.events.length).toBe(0);
      expect(result.pending).toBeDefined();
      expect(result.pending!.delay).toBe(25);
    });

    it("resolves ESC after timeout", async () => {
      input.scan(bytes(0x1b));
      await new Promise((r) => setTimeout(r, 30));
      let result = input.scan(new Uint8Array(0));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "Escape",
      });
      expect(result.pending).toBeUndefined();
    });

    it("resolves as escape sequence when more bytes arrive", () => {
      let r1 = input.scan(bytes(0x1b));
      expect(r1.events.length).toBe(0);

      let r2 = input.scan(bytes(0x5b, 0x41));
      expect(r2.events.length).toBe(1);
      expect(r2.events[0]).toMatchObject({ type: "keydown", key: "ArrowUp" });
      expect(r2.pending).toBeUndefined();
    });

    it("resolves pending ESC as Alt modifier when plain byte arrives", () => {
      let r1 = input.scan(bytes(0x1b));
      expect(r1.events.length).toBe(0);
      expect(r1.pending).toBeDefined();

      // "x" arrives — ESC + x = Alt+x
      let r2 = input.scan(bytes(0x78)); // 'x'
      expect(r2.events.length).toBe(1);
      expect(r2.events[0]).toMatchObject({
        type: "keydown",
        key: "x",
        alt: true,
      });
      expect(r2.pending).toBeUndefined();
    });

    it("completes pending ESC sequence and parses trailing bytes", () => {
      let r1 = input.scan(bytes(0x1b));
      expect(r1.events.length).toBe(0);
      expect(r1.pending).toBeDefined();

      // rest of ArrowUp + "hi"
      let r2 = input.scan(bytes(0x5b, 0x41, 0x68, 0x69));
      expect(r2.events.length).toBe(3);
      expect(r2.events[0]).toMatchObject({ type: "keydown", key: "ArrowUp" });
      expect(r2.events[1]).toMatchObject({ type: "keydown", key: "h" });
      expect(r2.events[2]).toMatchObject({ type: "keydown", key: "i" });
      expect(r2.pending).toBeUndefined();
    });
  });

  describe("Alt combinations", () => {
    it("parses Alt+a as unrecognized ESC sequence", () => {
      let result = input.scan(bytes(0x1b, 0x61));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "a",
        alt: true,
      });
    });
  });

  describe("multi-event burst", () => {
    it("parses multiple escape sequences in one call", () => {
      // Arrow Up + Arrow Down + "hi"
      let result = input.scan(
        bytes(0x1b, 0x5b, 0x41, 0x1b, 0x5b, 0x42, 0x68, 0x69),
      );
      expect(result.events.length).toBe(4);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "ArrowUp",
      });
      expect(result.events[1]).toMatchObject({
        type: "keydown",
        key: "ArrowDown",
      });
      expect(result.events[2]).toMatchObject({ type: "keydown", key: "h" });
      expect(result.events[3]).toMatchObject({ type: "keydown", key: "i" });
    });
  });

  describe("partial sequences", () => {
    it("buffers partial escape sequence", () => {
      let r1 = input.scan(bytes(0x1b, 0x5b));
      expect(r1.events.length).toBe(0);

      let r2 = input.scan(bytes(0x41));
      expect(r2.events.length).toBe(1);
      expect(r2.events[0]).toMatchObject({ type: "keydown", key: "ArrowUp" });
    });
  });

  describe("Kitty keyboard protocol (CSI u)", () => {
    it("parses character with alt modifier", () => {
      let result = input.scan(str("\x1b[97;3u")); // a + Alt
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "a",
        alt: true,
      });
    });

    it("parses Tab with alt modifier", () => {
      let result = input.scan(str("\x1b[9;3u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "Tab",
        alt: true,
      });
    });

    it("parses Enter with ctrl modifier", () => {
      let result = input.scan(str("\x1b[13;5u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "Enter",
        ctrl: true,
      });
    });

    it("parses Escape with shift modifier", () => {
      let result = input.scan(str("\x1b[27;2u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "Escape",
        shift: true,
      });
    });

    it("parses Backspace without modifiers", () => {
      let result = input.scan(str("\x1b[127u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "Backspace",
      });
    });

    it("parses combined modifiers", () => {
      let result = input.scan(str("\x1b[105;7u")); // i + Ctrl+Alt
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "i",
        ctrl: true,
        alt: true,
      });
    });

    it("parses F1 functional key codepoint", () => {
      let result = input.scan(str("\x1b[57376;2u")); // F1 + Shift
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "F1",
        shift: true,
      });
    });

    it("parses arrow key codepoint", () => {
      let result = input.scan(str("\x1b[57352;5u")); // ArrowUp + Ctrl
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "ArrowUp",
        ctrl: true,
      });
    });
  });

  describe("Kitty action types", () => {
    it("parses press as keydown", () => {
      let result = input.scan(str("\x1b[97;1:1u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({ type: "keydown", key: "a" });
    });

    it("parses repeat as keyrepeat", () => {
      let result = input.scan(str("\x1b[97;1:2u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({ type: "keyrepeat", key: "a" });
    });

    it("parses release as keyup", () => {
      let result = input.scan(str("\x1b[97;1:3u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({ type: "keyup", key: "a" });
    });

    it("parses F1 press with shift", () => {
      let result = input.scan(str("\x1b[57376;2:1u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "F1",
        shift: true,
      });
    });
  });

  describe("Kitty alternate keys", () => {
    it("parses shifted key", () => {
      let result = input.scan(str("\x1b[97:65;6u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "a",
        ctrl: true,
        shift: true,
        shifted: "A",
      });
    });

    it("parses shifted and base keys", () => {
      let result = input.scan(str("\x1b[97:65:97;3:1u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "a",
        code: "a",
        alt: true,
        shifted: "A",
      });
    });

    it("parses empty shifted with base key as code", () => {
      let result = input.scan(str("\x1b[1057::99;5u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "\u0421",
        code: "c",
        ctrl: true,
      });
    });
  });

  describe("Kitty associated text", () => {
    it("parses single codepoint text", () => {
      let result = input.scan(str("\x1b[97;;97u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "a",
        text: "a",
      });
    });

    it("parses text with shift modifier", () => {
      let result = input.scan(str("\x1b[97;2;65u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "a",
        shift: true,
        text: "A",
      });
    });

    it("parses IME text event", () => {
      let result = input.scan(str("\x1b[0;;228u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "\0",
        text: "\u00e4",
      });
    });

    it("parses multi-codepoint text", () => {
      let result = input.scan(str("\x1b[0;;4354:4449:4523u"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "\0",
        text: "\u1102\u1161\u11AB",
      });
    });

    it("keyup has no text", () => {
      let result = input.scan(str("\x1b[97;1:3u"));
      expect(result.events.length).toBe(1);
      let ev = result.events[0];
      expect(ev).toMatchObject({ type: "keyup", key: "a" });
      expect("text" in ev).toBe(false);
      expect("shifted" in ev).toBe(false);
      expect("base" in ev).toBe(false);
    });
  });

  describe("Kitty legacy CSI sequences", () => {
    it("parses arrow up with action", () => {
      let result = input.scan(str("\x1b[1;1:1A"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "ArrowUp",
        code: "ArrowUp",
      });
    });

    it("parses arrow up release", () => {
      let result = input.scan(str("\x1b[1;1:3A"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keyup",
        key: "ArrowUp",
        code: "ArrowUp",
      });
    });

    it("parses arrow with shift modifier", () => {
      let result = input.scan(str("\x1b[1;2:1D"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "ArrowLeft",
        code: "ArrowLeft",
        shift: true,
      });
    });

    it("parses plain arrow without action", () => {
      let result = input.scan(str("\x1b[1;1A"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "ArrowUp",
        code: "ArrowUp",
      });
    });

    it("parses delete with action", () => {
      let result = input.scan(str("\x1b[3;1:1~"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "Delete",
        code: "Delete",
      });
    });

    it("parses F1 with action", () => {
      let result = input.scan(str("\x1b[1;1:1P"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "F1",
        code: "F1",
      });
    });
  });

  describe("cursor position (DSR response)", () => {
    it("parses cursor position report", () => {
      let result = input.scan(str("\x1b[24;80R"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "cursor",
        row: 24,
        column: 80,
      });
    });

    it("parses cursor at origin", () => {
      let result = input.scan(str("\x1b[1;1R"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "cursor",
        row: 1,
        column: 1,
      });
    });

    it("parses cursor interleaved with other input", () => {
      let result = input.scan(str("a\x1b[10;5Rb"));
      expect(result.events.length).toBe(3);
      expect(result.events[0]).toMatchObject({ type: "keydown", key: "a" });
      expect(result.events[1]).toMatchObject({
        type: "cursor",
        row: 10,
        column: 5,
      });
      expect(result.events[2]).toMatchObject({ type: "keydown", key: "b" });
    });
  });

  describe("OSC 22 pointer shape reports", () => {
    it("parses a current-shape reply terminated by ST", () => {
      let result = input.scan(str("\x1b]22;pointer\x1b\\"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "pointershape",
        report: "pointer",
      });
    });

    it("parses a reply terminated by BEL", () => {
      let result = input.scan(str("\x1b]22;text\x07"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "pointershape",
        report: "text",
      });
    });

    it("parses an empty-stack reply (0)", () => {
      let result = input.scan(str("\x1b]22;0\x1b\\"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "pointershape",
        report: "0",
      });
    });

    it("parses a support-query reply (comma list) verbatim", () => {
      let result = input.scan(str("\x1b]22;1,0,1\x1b\\"));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "pointershape",
        report: "1,0,1",
      });
    });

    it("buffers a reply split across scans", () => {
      let first = input.scan(str("\x1b]22;poin"));
      expect(first.events.length).toBe(0);
      let second = input.scan(str("ter\x1b\\"));
      expect(second.events.length).toBe(1);
      expect(second.events[0]).toMatchObject({
        type: "pointershape",
        report: "pointer",
      });
    });

    it("parses a reply interleaved with other input", () => {
      let result = input.scan(str("a\x1b]22;default\x1b\\b"));
      expect(result.events.length).toBe(3);
      expect(result.events[0]).toMatchObject({ type: "keydown", key: "a" });
      expect(result.events[1]).toMatchObject({
        type: "pointershape",
        report: "default",
      });
      expect(result.events[2]).toMatchObject({ type: "keydown", key: "b" });
    });
  });

  describe("UTF-8", () => {
    it("parses 2-byte UTF-8 (é)", () => {
      let result = input.scan(bytes(0xc3, 0xa9));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "\u00e9",
      });
    });

    it("parses 3-byte UTF-8 (中)", () => {
      let result = input.scan(bytes(0xe4, 0xb8, 0xad));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "\u4e2d",
      });
    });

    it("parses 4-byte UTF-8 (emoji 🎉)", () => {
      let result = input.scan(bytes(0xf0, 0x9f, 0x8e, 0x89));
      expect(result.events.length).toBe(1);
      expect(result.events[0]).toMatchObject({
        type: "keydown",
        key: "\u{1f389}",
      });
    });
  });
});
