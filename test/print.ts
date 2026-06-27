/**
 * Interpret ANSI escape sequences into a plain text grid.
 * Handles CSI cursor positioning (row;colH) and UTF-8 text.
 * Strips all SGR (color/style) sequences.
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
  let lastCh = " "; // preceding graphic character, for REP (CSI b)

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
      } else if (cmd === "b") {
        // REP: repeat the preceding graphic character `params` times
        let n = parseInt(params) || 0;
        for (let r = 0; r < n; r++) {
          if (x >= 0 && x < w && y >= 0 && y < h) {
            grid[y][x] = lastCh;
          }
          x++;
        }
      } else if (cmd === "m") {
        // SGR — ignore
      }
      // ignore all other CSI sequences (?25l, ?25h, etc.)
    } else if (ansi[i] === "\n") {
      y++;
      x = 0;
      i++;
    } else {
      // regular character — could be multi-byte UTF-8
      let cp = ansi.codePointAt(i)!;
      let ch = String.fromCodePoint(cp);
      lastCh = ch;
      if (x >= 0 && x < w && y >= 0 && y < h) {
        grid[y][x] = ch;
      }
      x++;
      i += ch.length;
    }
  }

  return grid.map((row) => row.join("")).join("\n");
}
