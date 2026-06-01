// gen-wcwidth.ts — generate src/wcwidth.c from Unicode 16.0 data
// Usage: deno task gen-wcwidth
//
// Packed encoding (special_small_ranges): each uint32_t packs start codepoint
// in bits 31–11, count in bits 10–1, and a wide bit in bit 0. Large ranges
// (count > 1023) use separate starts[] + counts[] + widths[] arrays.
//
// BMP coarse filter: a 64-byte bitmap (1 bit per 128-codepoint block) gates
// the binary search. Clean blocks return width 1 without touching the table.

let UNICODE_BASE = "https://www.unicode.org/Public/16.0.0/ucd";

interface Interval {
  start: number;
  end: number; // inclusive
}

interface TaggedInterval extends Interval {
  width: 0 | 2;
}

async function fetchText(path: string): Promise<string> {
  let url = `${UNICODE_BASE}/${path}`;
  console.error(`Fetching ${url} …`);
  let response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return response.text();
}

function parseCodepointRange(token: string): Interval {
  if (token.includes("..")) {
    let [lo, hi] = token.split("..").map((s) => parseInt(s, 16));
    return { start: lo, end: hi };
  }
  let cp = parseInt(token, 16);
  return { start: cp, end: cp };
}

/**
 * Parses `extracted/DerivedGeneralCategory.txt` lines of the form
 * `XXXX..YYYY ; Category # …` and returns intervals matching `category`.
 */
function parseGeneralCategory(text: string, category: string): Interval[] {
  let intervals: Interval[] = [];
  for (let line of text.split("\n")) {
    let content = line.split("#")[0].trim();
    if (!content) continue;
    let [range, cat] = content.split(";").map((s) => s.trim());
    if (cat !== category) continue;
    intervals.push(parseCodepointRange(range));
  }
  return intervals;
}

/**
 * Parses `DerivedCoreProperties.txt` lines of the form
 * `XXXX ; Property_Name # …` and returns intervals matching `property`.
 */
function parseDerivedProperty(text: string, property: string): Interval[] {
  let intervals: Interval[] = [];
  for (let line of text.split("\n")) {
    let content = line.split("#")[0].trim();
    if (!content) continue;
    let [range, prop] = content.split(";").map((s) => s.trim());
    if (prop !== property) continue;
    intervals.push(parseCodepointRange(range));
  }
  return intervals;
}

/**
 * Parses `EastAsianWidth.txt` lines of the form `XXXX ; W|F # …`
 * and returns intervals for Wide (W) and Fullwidth (F) codepoints.
 */
function parseWideEastAsian(text: string): Interval[] {
  let intervals: Interval[] = [];
  for (let line of text.split("\n")) {
    let content = line.split("#")[0].trim();
    if (!content) continue;
    let [range, width] = content.split(";").map((s) => s.trim());
    if (width !== "W" && width !== "F") continue;
    intervals.push(parseCodepointRange(range));
  }
  return intervals;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  intervals.sort((a, b) => a.start - b.start);
  let merged: Interval[] = [{ ...intervals[0] }];
  for (let index = 1; index < intervals.length; index++) {
    let current = merged[merged.length - 1];
    let next = intervals[index];
    if (next.start <= current.end + 1) {
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

/**
 * Subtracts `mask` intervals from `base`, returning codepoints in `base` that
 * are not covered by any interval in `mask`. Used to let combining marks take
 * priority over wide ranges when the same codepoint appears in both tables.
 */
function subtractIntervals(base: Interval[], mask: Interval[]): Interval[] {
  let result = [...base];
  for (let m of mask) {
    let next: Interval[] = [];
    for (let b of result) {
      if (m.end < b.start || m.start > b.end) {
        next.push(b);
      } else {
        if (b.start < m.start) next.push({ start: b.start, end: m.start - 1 });
        if (b.end > m.end) next.push({ start: m.end + 1, end: b.end });
      }
    }
    result = next;
  }
  return result;
}

function assertNoAdjacentRanges(intervals: Interval[], label: string): void {
  for (let index = 1; index < intervals.length; index++) {
    let previous = intervals[index - 1];
    let current = intervals[index];
    if (current.start <= previous.end + 1) {
      throw new Error(
        `${label}: adjacent ranges at index ${index}: ` +
          `[0x${previous.start.toString(16)}, 0x${
            previous.end.toString(16)
          }] ` +
          `and [0x${current.start.toString(16)}, 0x${
            current.end.toString(16)
          }]`,
      );
    }
  }
}

function formatUint32Hex(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function formatUint16Hex(value: number): string {
  return `0x${value.toString(16).padStart(4, "0")}`;
}

function formatUint8Hex(value: number): string {
  return `0x${value.toString(16).padStart(2, "0")}`;
}

function formatUint32Array(values: number[], indent = "  "): string {
  let lines: string[] = [];
  for (let index = 0; index < values.length; index += 8) {
    let chunk = values.slice(index, index + 8);
    lines.push(indent + chunk.map(formatUint32Hex).join(", ") + ",");
  }
  return lines.join("\n");
}

function formatUint16Array(values: number[], indent = "  "): string {
  let lines: string[] = [];
  for (let index = 0; index < values.length; index += 8) {
    let chunk = values.slice(index, index + 8);
    lines.push(indent + chunk.map(formatUint16Hex).join(", ") + ",");
  }
  return lines.join("\n");
}

function formatUint8Array(values: number[], indent = "  "): string {
  let lines: string[] = [];
  for (let index = 0; index < values.length; index += 8) {
    let chunk = values.slice(index, index + 8);
    lines.push(indent + chunk.map(formatUint8Hex).join(", ") + ",");
  }
  return lines.join("\n");
}

async function sha256Hex(input: string): Promise<string> {
  let bytes = new TextEncoder().encode(input);
  let digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

let [derivedCategoryText, derivedCorePropsText, eastAsianWidthText] =
  await Promise.all([
    fetchText("extracted/DerivedGeneralCategory.txt"),
    fetchText("DerivedCoreProperties.txt"),
    fetchText("EastAsianWidth.txt"),
  ]);

let nonspacingMarks = parseGeneralCategory(derivedCategoryText, "Mn");
const enclosingMarks = parseGeneralCategory(derivedCategoryText, "Me");
const defaultIgnorables = parseDerivedProperty(
  derivedCorePropsText,
  "Default_Ignorable_Code_Point",
);

// 0x00–0xFF is handled by fast-path checks in wcwidth(), so strip it from the table.
const allZeroWidth = mergeIntervals([
  ...nonspacingMarks,
  ...enclosingMarks,
  ...defaultIgnorables,
]);
const combiningIntervals = mergeIntervals(
  allZeroWidth
    .filter((interval) => interval.end > 0xff)
    .map((interval) => ({
      start: Math.max(interval.start, 0x100),
      end: interval.end,
    })),
);
assertNoAdjacentRanges(combiningIntervals, "combining");

let wideIntervals = mergeIntervals(parseWideEastAsian(eastAsianWidthText));
assertNoAdjacentRanges(wideIntervals, "wide");

// Strip any codepoints that are in both tables — combining takes priority.
// U+115F (Hangul Choseong Filler) is the known overlap in Unicode 16.0.
const pureWideIntervals = subtractIntervals(wideIntervals, combiningIntervals);

// Merge combining (width 0) and pure-wide (width 2) into a single sorted table.
const allSpecialIntervals: TaggedInterval[] = [
  ...combiningIntervals.map((i) => ({ ...i, width: 0 as const })),
  ...pureWideIntervals.map((i) => ({ ...i, width: 2 as const })),
].sort((a, b) => a.start - b.start);

for (let index = 1; index < allSpecialIntervals.length; index++) {
  let prev = allSpecialIntervals[index - 1];
  let curr = allSpecialIntervals[index];
  if (curr.start <= prev.end) {
    throw new Error(
      `combining/wide overlap at 0x${curr.start.toString(16)} ` +
        `(prev width=${prev.width} ends at 0x${prev.end.toString(16)})`,
    );
  }
}

let allRanges = allSpecialIntervals.map((i) => ({
  start: i.start,
  count: i.end - i.start,
  width: i.width,
}));

for (let range of allRanges) {
  if (range.start > 0x1fffff) {
    throw new Error(
      `Range start 0x${
        range.start.toString(16)
      } exceeds 21 bits — packed encoding broken`,
    );
  }
}

// Unicode 16.0's DerivedCoreProperties.txt includes E0000..E0FFF as a single
// Default_Ignorable block (count = 4095), so combining ranges also need the
// small/large split — not just wide ranges.
// Threshold is 1023 (10-bit count field) rather than 255 to absorb more wide ranges into small.
const smallRanges = allRanges.filter((range) => range.count <= 1023);
const largeRanges = allRanges.filter((range) => range.count > 1023);

let smallPacked = smallRanges.map(
  (range) =>
    (range.start << 11) | (range.count << 1) | (range.width === 2 ? 1 : 0),
);

for (let index = 1; index < smallPacked.length; index++) {
  if (smallPacked[index] <= smallPacked[index - 1]) {
    throw new Error(
      `special_small_ranges not strictly increasing at index ${index}`,
    );
  }
}

let largeStarts = largeRanges.map((range) => range.start);
const largeCounts = largeRanges.map((range) => range.count);
const largeWidths = largeRanges.map((range) => range.width);

// BMP coarse filter: 64-byte bitmap, 1 bit per 128-codepoint block.
// A 0-bit means no special codepoints in that block — skip the binary search.
const bmpFilter = new Uint32Array(16);
for (const range of allRanges) {
  if (range.start > 0xffff) continue;
  let endCp = Math.min(range.start + range.count, 0xffff);
  let startBlock = range.start >> 7;
  let endBlock = endCp >> 7;
  for (let block = startBlock; block <= endBlock; block++) {
    bmpFilter[block >> 5] |= 1 << (block & 31);
  }
}
let dirtyBlocks = 0;
for (const w of bmpFilter) {
  let x = w;
  while (x) {
    x &= x - 1;
    dirtyBlocks++;
  }
}

let tableBytes = 16 * 4 + // bmp_filter
  smallPacked.length * 4 +
  largeStarts.length * 4 +
  largeCounts.length * 2 +
  largeWidths.length * 1;

console.error(`special_small_ranges: ${smallPacked.length} entries`);
console.error(`special_large_ranges: ${largeRanges.length} entries`);
console.error(`BMP dirty blocks:     ${dirtyBlocks} / 512`);
console.error(`Table data:           ${tableBytes} bytes`);

// Fingerprint the generated tables (not the source text or comments) so the
// header changes only when the emitted data would actually differ. Re-running
// against identical Unicode data is byte-for-byte reproducible.
let dataHash = (await sha256Hex(
  JSON.stringify({
    unicode: UNICODE_BASE,
    bmpFilter: Array.from(bmpFilter),
    smallPacked,
    largeStarts,
    largeCounts,
    largeWidths,
  }),
)).slice(0, 16);

let output = `\
/* wcwidth.c - Unicode character width lookup
 * Unicode 16.0 - generated by tasks/gen-wcwidth.ts
 * Data hash: ${dataHash}
 *
 * Only zero-width (combining marks + default ignorable) and double-width
 * (wide/fullwidth) codepoints are stored. Everything else defaults to
 * width 1. Control characters (U+0000-U+001F, U+007F-U+009F) are handled
 * by the fast-path checks in wcwidth() and are not in the tables.
 *
 * Sources:
 *   DerivedGeneralCategory.txt: Mn/Me categories -> width 0
 *   DerivedCoreProperties.txt: Default_Ignorable_Code_Point -> width 0
 *   EastAsianWidth.txt: W/F properties -> width 2
 *
 * Combining (width 0) and wide (width 2) ranges are merged into a single
 * sorted table so wcwidth() needs only one binary search for any codepoint.
 *
 * BMP coarse filter (bmp_filter):
 *   64-byte bitmap, 1 bit per 128-codepoint BMP block. A 0-bit means no
 *   special codepoints in that block - return width 1 without searching.
 *
 * Packed encoding (special_small_ranges):
 *   Each uint32_t entry packs one Unicode range as
 *     bits 31-11  start codepoint (fits in 21 bits; Unicode max is U+10FFFF)
 *     bits  10-1  count of additional codepoints beyond start (max 1023)
 *     bit      0  0 = width 0 (combining), 1 = width 2 (wide)
 *   Array is sorted by start so binary search operates on raw uint32_t values.
 *
 * Large-range encoding (special_large_* parallel arrays):
 *   Used for ranges whose span exceeds 1023 codepoints.
 */

#include <stdint.h>

/* clang-format off */

static const uint32_t bmp_filter[16] = {
${formatUint32Array(Array.from(bmpFilter))}
};

static const uint32_t special_small_ranges[] = {
${formatUint32Array(smallPacked)}
};
#define SPECIAL_SMALL_COUNT ${smallPacked.length}

static const uint32_t special_large_starts[] = {
${formatUint32Array(largeStarts)}
};
static const uint16_t special_large_counts[] = {
${formatUint16Array(largeCounts)}
};
static const uint8_t special_large_widths[] = {
${formatUint8Array(largeWidths)}
};
#define SPECIAL_LARGE_COUNT ${largeRanges.length}

/* clang-format on */

static int codepoint_in_special(uint32_t codepoint) {
  if (codepoint <= 0xffff) {
    uint32_t block = codepoint >> 7;
    if (!((bmp_filter[block >> 5] >> (block & 31u)) & 1u))
      return 1;
  }
  int left = 0, right = SPECIAL_SMALL_COUNT - 1;
  while (left <= right) {
    int mid = (left + right) / 2;
    uint32_t entry = special_small_ranges[mid];
    uint32_t start = entry >> 11;
    if (codepoint < start)
      right = mid - 1;
    else if (codepoint > start + ((entry >> 1) & 0x3FF))
      left = mid + 1;
    else
      return (entry & 1) ? 2 : 0;
  }
  left = 0;
  right = SPECIAL_LARGE_COUNT - 1;
  while (left <= right) {
    int mid = (left + right) / 2;
    if (codepoint < special_large_starts[mid])
      right = mid - 1;
    else if (codepoint > special_large_starts[mid] + special_large_counts[mid])
      left = mid + 1;
    else
      return special_large_widths[mid];
  }
  return 1;
}

int wcwidth(uint32_t codepoint) {
  if (codepoint >= 0x20 && codepoint <= 0x7e)
    return 1;
  if (codepoint >= 0xa0 && codepoint <= 0xff)
    return 1;
  if (codepoint < 0x20 || (codepoint > 0x7e && codepoint < 0xa0))
    return codepoint == 0 ? 0 : -1;
  return codepoint_in_special(codepoint);
}

int iswprint(uint32_t codepoint) { return wcwidth(codepoint) >= 0; }
`;

if (Deno.args.includes("--check")) {
  let existing = await Deno.readTextFile("src/wcwidth.c");
  if (existing !== output) {
    console.error("src/wcwidth.c is out of date — run: deno task gen-wcwidth");
    Deno.exit(1);
  }
  console.error("src/wcwidth.c is up to date");
} else {
  await Deno.writeTextFile("src/wcwidth.c", output);
  console.error("Wrote src/wcwidth.c");
}

export {};
