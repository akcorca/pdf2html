import type { TextLine } from "./pdf-types.ts";
import { estimateBodyFontSize, groupLinesByPage, normalizeSpacing } from "./text-lines.ts";

const FOOTNOTE_SYMBOL_MARKER_ONLY_PATTERN = /^(?:[*∗†‡§¶#])$/u;
const FOOTNOTE_SYMBOL_MARKER_PREFIX_PATTERN = /^(?:[*∗†‡§¶#])\s+.+$/u;
const FOOTNOTE_NUMERIC_MARKER_ONLY_PATTERN = /^\(?\d{1,2}\)?[.)]?$/u;
const FOOTNOTE_START_MAX_VERTICAL_RATIO = 0.38;
const FOOTNOTE_BLOCK_MAX_VERTICAL_RATIO = 0.42;
const FOOTNOTE_SYMBOL_MARKER_MAX_FONT_RATIO = 0.82;
const FOOTNOTE_NUMERIC_MARKER_MAX_FONT_RATIO = 0.65;
const FOOTNOTE_TEXT_MAX_FONT_RATIO = 0.98;
const FOOTNOTE_MIN_TEXT_LENGTH = 8;
const FOOTNOTE_MAX_VERTICAL_GAP = 20;

export function movePageFootnotesToDocumentEnd(lines: TextLine[]): TextLine[] {
  if (lines.length === 0) return lines;
  const bodyFontSize = estimateBodyFontSize(lines);
  const pageGroups = groupLinesByPage(lines);
  const moved = new Set<TextLine>();

  for (const pageLines of pageGroups.values()) {
    const ranges = findFootnoteRangesOnPage(pageLines, bodyFontSize);
    for (const range of ranges) {
      for (let index = range.startIndex; index < range.endIndex; index += 1) {
        moved.add(pageLines[index]);
      }
    }
  }

  if (moved.size === 0) return lines;
  const bodyLines = lines.filter((line) => !moved.has(line));
  const footnoteLines = lines.filter((line) => moved.has(line));
  return [...bodyLines, ...footnoteLines];
}

function findFootnoteRangesOnPage(
  pageLines: TextLine[],
  bodyFontSize: number,
): Array<{ startIndex: number; endIndex: number }> {
  const ranges: Array<{ startIndex: number; endIndex: number }> = [];
  let index = 0;

  while (index < pageLines.length - 1) {
    const markerLine = pageLines[index];
    if (!isFootnoteStartMarkerLine(markerLine, bodyFontSize)) {
      index += 1;
      continue;
    }

    const nextLine = pageLines[index + 1];
    if (!isLikelyFootnoteTextLine(nextLine, bodyFontSize)) {
      index += 1;
      continue;
    }

    let endIndex = index + 2;
    let previousLine = nextLine;
    while (endIndex < pageLines.length) {
      const line = pageLines[endIndex];
      if (!isLikelyFootnoteContinuationLine(line, previousLine, bodyFontSize)) break;
      previousLine = line;
      endIndex += 1;
    }

    ranges.push({ startIndex: index, endIndex });
    index = endIndex;
  }

  return ranges;
}

function isFootnoteStartMarkerLine(line: TextLine, bodyFontSize: number): boolean {
  if (line.y > line.pageHeight * FOOTNOTE_START_MAX_VERTICAL_RATIO) return false;
  const text = normalizeSpacing(line.text);
  if (text.length === 0) return false;
  if (
    FOOTNOTE_SYMBOL_MARKER_ONLY_PATTERN.test(text) ||
    FOOTNOTE_SYMBOL_MARKER_PREFIX_PATTERN.test(text)
  ) {
    return line.fontSize <= bodyFontSize * FOOTNOTE_SYMBOL_MARKER_MAX_FONT_RATIO;
  }
  if (FOOTNOTE_NUMERIC_MARKER_ONLY_PATTERN.test(text)) {
    return line.fontSize <= bodyFontSize * FOOTNOTE_NUMERIC_MARKER_MAX_FONT_RATIO;
  }
  return false;
}

function isLikelyFootnoteTextLine(line: TextLine, bodyFontSize: number): boolean {
  if (line.y > line.pageHeight * FOOTNOTE_BLOCK_MAX_VERTICAL_RATIO) return false;
  if (line.fontSize > bodyFontSize * FOOTNOTE_TEXT_MAX_FONT_RATIO) return false;
  const text = normalizeSpacing(line.text);
  if (text.length < FOOTNOTE_MIN_TEXT_LENGTH) return false;
  return /[A-Za-z]/.test(text);
}

function isLikelyFootnoteContinuationLine(
  line: TextLine,
  previousLine: TextLine,
  bodyFontSize: number,
): boolean {
  if (line.pageIndex !== previousLine.pageIndex) return false;
  if (line.y >= previousLine.y) return false;
  if (previousLine.y - line.y > FOOTNOTE_MAX_VERTICAL_GAP) return false;
  if (line.y > line.pageHeight * FOOTNOTE_BLOCK_MAX_VERTICAL_RATIO) return false;
  if (line.fontSize > bodyFontSize * FOOTNOTE_TEXT_MAX_FONT_RATIO) return false;

  const text = normalizeSpacing(line.text);
  if (text.length === 0) return false;
  return true;
}
