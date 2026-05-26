// gen-wcwidth.ts — generate src/wcwidth.c from Unicode 16.0 data
// Usage: deno task gen-wcwidth
//
// wcwidth = "wide character width", a POSIX standard function.
// This script fetches three Unicode data files and emits a compact C
// implementation with two lookup strategies:
//
//   "packed" ranges  — uint32_t where bits 31–8 = start codepoint,
//                      bits 7–0 = count (max 255).  Used for combining
//                      marks and small wide ranges.
//
//   "large" ranges   — separate uint32_t starts[] + uint16_t counts[]
//                      for the handful of CJK/Hangul blocks whose range
//                      spans more than 255 codepoints.

const UNICODE_BASE = "https://www.unicode.org/Public/16.0.0/ucd";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Interval {
  start: number;
  end: number; // inclusive
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchText(path: string): Promise<string> {
  const url = `${UNICODE_BASE}/${path}`;
  console.error(`Fetching ${url} …`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return response.text();
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function parseCodepointRange(token: string): Interval {
  if (token.includes("..")) {
    const [lo, hi] = token.split("..").map((s) => parseInt(s, 16));
    return { start: lo, end: hi };
  }
  const cp = parseInt(token, 16);
  return { start: cp, end: cp };
}

// extracted/DerivedGeneralCategory.txt  →  "XXXX..YYYY ; Category # …"
function parseGeneralCategory(text: string, category: string): Interval[] {
  const intervals: Interval[] = [];
  for (const line of text.split("\n")) {
    const content = line.split("#")[0].trim();
    if (!content) continue;
    const [range, cat] = content.split(";").map((s) => s.trim());
    if (cat !== category) continue;
    intervals.push(parseCodepointRange(range));
  }
  return intervals;
}

// DerivedCoreProperties.txt  →  "XXXX ; Property_Name # …"
function parseDerivedProperty(text: string, property: string): Interval[] {
  const intervals: Interval[] = [];
  for (const line of text.split("\n")) {
    const content = line.split("#")[0].trim();
    if (!content) continue;
    const [range, prop] = content.split(";").map((s) => s.trim());
    if (prop !== property) continue;
    intervals.push(parseCodepointRange(range));
  }
  return intervals;
}

// EastAsianWidth.txt  →  "XXXX ; W|F # …"  (W = Wide, F = Fullwidth)
function parseWideEastAsian(text: string): Interval[] {
  const intervals: Interval[] = [];
  for (const line of text.split("\n")) {
    const content = line.split("#")[0].trim();
    if (!content) continue;
    const [range, width] = content.split(";").map((s) => s.trim());
    if (width !== "W" && width !== "F") continue;
    intervals.push(parseCodepointRange(range));
  }
  return intervals;
}

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  intervals.sort((a, b) => a.start - b.start);
  const merged: Interval[] = [{ ...intervals[0] }];
  for (let index = 1; index < intervals.length; index++) {
    const current = merged[merged.length - 1];
    const next = intervals[index];
    if (next.start <= current.end + 1) {
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

function assertNoAdjacentRanges(intervals: Interval[], label: string): void {
  for (let index = 1; index < intervals.length; index++) {
    const previous = intervals[index - 1];
    const current = intervals[index];
    if (current.start <= previous.end + 1) {
      throw new Error(
        `${label}: adjacent ranges at index ${index}: ` +
          `[0x${previous.start.toString(16)}, 0x${previous.end.toString(16)}] ` +
          `and [0x${current.start.toString(16)}, 0x${current.end.toString(16)}]`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// C emit helpers
// ---------------------------------------------------------------------------

function formatUint32Hex(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function formatUint16Hex(value: number): string {
  return `0x${value.toString(16).padStart(4, "0")}`;
}

function formatUint32Array(values: number[], indent = "  "): string {
  const lines: string[] = [];
  for (let index = 0; index < values.length; index += 8) {
    const chunk = values.slice(index, index + 8);
    lines.push(indent + chunk.map(formatUint32Hex).join(", ") + ",");
  }
  return lines.join("\n");
}

function formatUint16Array(values: number[], indent = "  "): string {
  const lines: string[] = [];
  for (let index = 0; index < values.length; index += 8) {
    const chunk = values.slice(index, index + 8);
    lines.push(indent + chunk.map(formatUint16Hex).join(", ") + ",");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [derivedCategoryText, derivedCorePropsText, eastAsianWidthText] =
  await Promise.all([
    fetchText("extracted/DerivedGeneralCategory.txt"),
    fetchText("DerivedCoreProperties.txt"),
    fetchText("EastAsianWidth.txt"),
  ]);

// --- Collect width-0 intervals ---

const nonspacingMarks = parseGeneralCategory(derivedCategoryText, "Mn");
const enclosingMarks = parseGeneralCategory(derivedCategoryText, "Me");
const defaultIgnorables = parseDerivedProperty(
  derivedCorePropsText,
  "Default_Ignorable_Code_Point",
);

// Merge all zero-width sources, then strip anything in the fast-path range
// (0x00–0xFF). Those codepoints are handled by hard-coded checks in wcwidth()
// so there is no point carrying them in the lookup table.
const allZeroWidth = mergeIntervals([
  ...nonspacingMarks,
  ...enclosingMarks,
  ...defaultIgnorables,
]);
const combiningIntervals = mergeIntervals(
  allZeroWidth
    .filter((interval) => interval.end > 0xff)
    .map((interval) => ({ start: Math.max(interval.start, 0x100), end: interval.end })),
);
assertNoAdjacentRanges(combiningIntervals, "combining");

// --- Collect width-2 intervals ---

const wideIntervals = mergeIntervals(parseWideEastAsian(eastAsianWidthText));
assertNoAdjacentRanges(wideIntervals, "wide");

// --- Convert intervals to (start, count) pairs ---

const combiningRanges = combiningIntervals.map((interval) => ({
  start: interval.start,
  count: interval.end - interval.start,
}));

const wideRanges = wideIntervals.map((interval) => ({
  start: interval.start,
  count: interval.end - interval.start,
}));

// --- Assert 24-bit start constraint (hard limit: Unicode fits in 21 bits) ---

for (const range of [...combiningRanges, ...wideRanges]) {
  if (range.start > 0xffffff) {
    throw new Error(
      `Range start 0x${range.start.toString(16)} exceeds 24 bits — packed encoding broken`,
    );
  }
}

// --- Split both combining and wide ranges into small (count ≤ 255) / large ---
//
// Unicode 16.0's DerivedCoreProperties.txt includes E0000..E0FFF as a single
// Default_Ignorable block (count = 4095), so combining ranges also need the
// small/large split — not just wide ranges.

const combiningSmallRanges = combiningRanges.filter((range) => range.count <= 255);
const combiningLargeRanges = combiningRanges.filter((range) => range.count > 255);
const wideSmallRanges = wideRanges.filter((range) => range.count <= 255);
const wideLargeRanges = wideRanges.filter((range) => range.count > 255);

// --- Pack small entries: (start << 8) | count ---

const combiningSmallPacked = combiningSmallRanges.map(
  (range) => (range.start << 8) | range.count,
);
const wideSmallPacked = wideSmallRanges.map(
  (range) => (range.start << 8) | range.count,
);
const combiningLargeStarts = combiningLargeRanges.map((range) => range.start);
const combiningLargeCounts = combiningLargeRanges.map((range) => range.count);
const wideLargeStarts = wideLargeRanges.map((range) => range.start);
const wideLargeCounts = wideLargeRanges.map((range) => range.count);

// --- Verify sort invariants (packed arrays must be strictly increasing) ---

for (let index = 1; index < combiningSmallPacked.length; index++) {
  if (combiningSmallPacked[index] <= combiningSmallPacked[index - 1]) {
    throw new Error(`combining_small_ranges not strictly increasing at index ${index}`);
  }
}
for (let index = 1; index < wideSmallPacked.length; index++) {
  if (wideSmallPacked[index] <= wideSmallPacked[index - 1]) {
    throw new Error(`wide_small_ranges not strictly increasing at index ${index}`);
  }
}

// --- Report ---

const tableBytes =
  combiningSmallPacked.length * 4 +
  combiningLargeStarts.length * 4 +
  combiningLargeCounts.length * 2 +
  wideSmallPacked.length * 4 +
  wideLargeStarts.length * 4 +
  wideLargeCounts.length * 2;

console.error(`combining_small_ranges: ${combiningSmallPacked.length} entries`);
console.error(`combining_large_ranges: ${combiningLargeRanges.length} entries`);
console.error(`wide_small_ranges:      ${wideSmallPacked.length} entries`);
console.error(`wide_large_ranges:      ${wideLargeRanges.length} entries`);
console.error(`Table data:             ${tableBytes} bytes`);

// --- Emit src/wcwidth.c ---

const date = new Date().toISOString().slice(0, 10);

const output = `\
/* wcwidth.c - Unicode character width lookup
 * Unicode 16.0 — generated by tasks/gen-wcwidth.ts on ${date}
 *
 * Only zero-width (combining marks + default ignorable) and double-width
 * (wide/fullwidth) codepoints are stored. Everything else defaults to
 * width 1. Control characters (U+0000–U+001F, U+007F–U+009F) are handled
 * by the fast-path checks in wcwidth() and are not in the tables.
 *
 * Sources:
 *   extracted/DerivedGeneralCategory.txt  Mn/Me categories → width 0
 *   DerivedCoreProperties.txt             Default_Ignorable_Code_Point → width 0
 *   EastAsianWidth.txt                    W/F properties → width 2
 *
 * Packed encoding (*_small_ranges arrays):
 *   Each uint32_t entry packs one Unicode range as
 *     bits 31–8  start codepoint (fits in 24 bits; Unicode max is U+10FFFF)
 *     bits  7–0  count of additional codepoints beyond start (0 = single char)
 *   Arrays are sorted by start so binary search operates on raw uint32_t values.
 *
 * Large-range encoding (*_large_starts / *_large_counts parallel arrays):
 *   Used for ranges whose span exceeds 255 codepoints — large CJK blocks,
 *   Hangul syllables, and the Unicode tag character plane.
 */

#include <stdint.h>

static const uint32_t combining_small_ranges[] = {
${formatUint32Array(combiningSmallPacked)}
};
#define COMBINING_SMALL_RANGE_COUNT ${combiningSmallPacked.length}

static const uint32_t combining_large_starts[] = {
${formatUint32Array(combiningLargeStarts)}
};
static const uint16_t combining_large_counts[] = {
${formatUint16Array(combiningLargeCounts)}
};
#define COMBINING_LARGE_RANGE_COUNT ${combiningLargeRanges.length}

static const uint32_t wide_small_ranges[] = {
${formatUint32Array(wideSmallPacked)}
};
#define WIDE_SMALL_RANGE_COUNT ${wideSmallPacked.length}

static const uint32_t wide_large_starts[] = {
${formatUint32Array(wideLargeStarts)}
};
static const uint16_t wide_large_counts[] = {
${formatUint16Array(wideLargeCounts)}
};
#define WIDE_LARGE_RANGE_COUNT ${wideLargeRanges.length}

static int codepoint_in_range(
  const uint32_t *starts, const uint16_t *counts, int length, uint32_t codepoint
) {
  int left = 0, right = length - 1;
  while (left <= right) {
    int mid = (left + right) / 2;
    if (codepoint < starts[mid])                    right = mid - 1;
    else if (codepoint > starts[mid] + counts[mid]) left  = mid + 1;
    else                                            return 1;
  }
  return 0;
}

static int codepoint_in_packed_range(const uint32_t *ranges, int length, uint32_t codepoint) {
  int left = 0, right = length - 1;
  while (left <= right) {
    int mid        = (left + right) / 2;
    uint32_t entry = ranges[mid];
    uint32_t start = entry >> 8;
    if (codepoint < start)                       right = mid - 1;
    else if (codepoint > start + (entry & 0xff)) left  = mid + 1;
    else                                         return 1;
  }
  return 0;
}

int wcwidth(uint32_t codepoint) {
  if (codepoint >= 0x20 && codepoint <= 0x7e)
    return 1;
  if (codepoint >= 0xa0 && codepoint <= 0xff)
    return 1;
  if (codepoint < 0x20 || (codepoint > 0x7e && codepoint < 0xa0))
    return codepoint == 0 ? 0 : -1;
  if (codepoint_in_packed_range(combining_small_ranges, COMBINING_SMALL_RANGE_COUNT, codepoint)) return 0;
  if (codepoint_in_range(combining_large_starts, combining_large_counts, COMBINING_LARGE_RANGE_COUNT, codepoint)) return 0;
  if (codepoint_in_packed_range(wide_small_ranges, WIDE_SMALL_RANGE_COUNT, codepoint)) return 2;
  if (codepoint_in_range(wide_large_starts, wide_large_counts, WIDE_LARGE_RANGE_COUNT, codepoint)) return 2;
  return 1;
}

int iswprint(uint32_t codepoint) { return wcwidth(codepoint) >= 0; }
`;

await Deno.writeTextFile("src/wcwidth.c", output);
console.error("Wrote src/wcwidth.c");
