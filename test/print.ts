/**
 * Interpret ANSI escape sequences into a plain text grid.
 * Handles CSI cursor positioning (row;colH), DECTCEM show/hide
 * (?25h/?25l), and UTF-8 text. Strips SGR (color/style) sequences.
 *
 * When the hardware cursor is visible at the end of the stream, its
 * cell is marked with U+0332 COMBINING LOW LINE appended to the base
 * character. The base char is preserved and the underline spans its
 * rendered width — including the full width of CJK/wide chars.
 */
export function print(ansi: string, w: number, h: number): string {
  let grid: string[][] = [];
  for (let y = 0; y < h; y++) {
    grid[y] = [];
    for (let x = 0; x < w; x++) {
      grid[y][x] = " ";
    }
  }

  let x = 0;
  let y = 0;
  let i = 0;
  let cursorVisible = false;

  while (i < ansi.length) {
    if (ansi[i] === "\x1b" && ansi[i + 1] === "[") {
      // parse CSI sequence
      i += 2;
      let params = "";
      while (
        i < ansi.length && ansi[i] >= "0" && ansi[i] <= "9" ||
        ansi[i] === ";" || ansi[i] === "?"
      ) {
        params += ansi[i++];
      }
      let cmd = ansi[i++];

      if (cmd === "H") {
        // cursor position: row;col (1-indexed)
        let parts = params.split(";");
        y = (parseInt(parts[0]) || 1) - 1;
        x = (parseInt(parts[1]) || 1) - 1;
      } else if (cmd === "h" && params === "?25") {
        cursorVisible = true;
      } else if (cmd === "l" && params === "?25") {
        cursorVisible = false;
      }
      // ignore SGR and all other CSI sequences
    } else if (ansi[i] === "\n") {
      y++;
      x = 0;
      i++;
    } else {
      // regular character — could be multi-byte UTF-8
      let cp = ansi.codePointAt(i)!;
      let ch = String.fromCodePoint(cp);
      if (x >= 0 && x < w && y >= 0 && y < h) {
        grid[y][x] = ch;
      }
      x++;
      i += ch.length;
    }
  }

  if (cursorVisible && x >= 0 && x < w && y >= 0 && y < h) {
    grid[y][x] = grid[y][x] + "\u0332";
  }

  return grid.map((row) => row.join("")).join("\n");
}
