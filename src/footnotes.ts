import type { TextLine } from "./pdf-types.ts";
import {
  getFootnoteBlockText,
  getFootnoteContentText,
  isDescendingNearbyFootnoteLine,
} from "./footnote-line-text.ts";
import { normalizeFootnoteLines } from "./footnote-normalize.ts";
import { estimateBodyFontSize, groupLinesByPage, normalizeSpacing } from "./text-lines.ts";

const FOOTNOTE_SYMBOL_START_MARKER_PATTERN = /^(?:[*∗†‡§¶#])(?:\s+.+)?$/u;
const FOOTNOTE_NUMERIC_MARKER_ONLY_PATTERN = /^\(?\d{1,2}\)?[.)]?$/u;
const FOOTNOTE_START_MAX_VERTICAL_RATIO = 0.38;
const FOOTNOTE_SYMBOL_MARKER_MAX_FONT_RATIO = 0.82;
const FOOTNOTE_NUMERIC_MARKER_MAX_FONT_RATIO = 0.65;
const FOOTNOTE_MIN_TEXT_LENGTH = 8;
const FOOTNOTE_MARKER_PREFIX_PATTERN = /^(?:[*∗†‡§¶#]|\(?\d{1,2}\)?[.)]?)\s+/u;
const FOOTNOTE_UNMARKED_START_MAX_VERTICAL_RATIO = 0.2;
const FOOTNOTE_UNMARKED_MAX_FONT_RATIO = 0.93;
const FOOTNOTE_UNMARKED_MAX_PAGE_FONT_RATIO = 0.95;
const FOOTNOTE_UNMARKED_MIN_WORD_COUNT = 8;
const FOOTNOTE_UNMARKED_MIN_LOWERCASE_WORD_COUNT = 4;
const FOOTNOTE_UNMARKED_MIN_BOUNDARY_GAP = 12;

const FOOTNOTE_START_MARKER_RULES = [
  {
    pattern: FOOTNOTE_SYMBOL_START_MARKER_PATTERN,
    maxFontRatio: FOOTNOTE_SYMBOL_MARKER_MAX_FONT_RATIO,
  },
  {
    pattern: FOOTNOTE_NUMERIC_MARKER_ONLY_PATTERN,
    maxFontRatio: FOOTNOTE_NUMERIC_MARKER_MAX_FONT_RATIO,
  },
] as const;

export function movePageFootnotesToDocumentEnd(
  lines: TextLine[],
): { bodyLines: TextLine[]; footnoteLines: TextLine[] } {
  if (lines.length === 0) return { bodyLines: lines, footnoteLines: [] };
  const bodyFontSize = estimateBodyFontSize(lines);
  const moved = collectFootnoteLines(lines, bodyFontSize);

  if (moved.size === 0) return { bodyLines: lines, footnoteLines: [] };
  const { bodyLines, footnoteLines } = partitionFootnoteLines(lines, moved);
  return {
    bodyLines,
    footnoteLines: normalizeFootnoteLines(footnoteLines, bodyFontSize),
  };
}

function partitionFootnoteLines(
  lines: TextLine[],
  moved: Set<TextLine>,
): { bodyLines: TextLine[]; footnoteLines: TextLine[] } {
  const bodyLines: TextLine[] = [];
  const footnoteLines: TextLine[] = [];

  for (const line of lines) {
    (moved.has(line) ? footnoteLines : bodyLines).push(line);
  }

  return { bodyLines, footnoteLines };
}

function collectFootnoteLines(lines: TextLine[], bodyFontSize: number): Set<TextLine> {
  const moved = new Set<TextLine>();
  for (const pageLines of groupLinesByPage(lines).values()) {
    const pageBodyFontSize = estimateBodyFontSize(pageLines);
    let index = 0;
    while (index < pageLines.length - 1) {
      const endIndex =
        findFootnoteRangeEndIndex(pageLines, index, bodyFontSize) ??
        findUnmarkedFootnoteRangeEndIndex(pageLines, index, bodyFontSize, pageBodyFontSize);
      if (endIndex === undefined) {
        index += 1;
        continue;
      }
      for (let rangeIndex = index; rangeIndex < endIndex; rangeIndex += 1) {
        moved.add(pageLines[rangeIndex]);
      }
      index = endIndex;
    }
  }
  return moved;
}

function findUnmarkedFootnoteRangeEndIndex(
  pageLines: TextLine[],
  startIndex: number,
  bodyFontSize: number,
  pageBodyFontSize: number,
): number | undefined {
  const startLine = pageLines[startIndex];
  if (!isUnmarkedFootnoteStartLine(startLine, bodyFontSize, pageBodyFontSize)) return undefined;

  const previousLine = pageLines[startIndex - 1];
  if (!isLikelyUnmarkedFootnoteStartBoundary(previousLine, startLine, bodyFontSize)) {
    return undefined;
  }

  const nextLine = pageLines[startIndex + 1];
  if (!nextLine || !getFootnoteContentText(nextLine, bodyFontSize)) return undefined;
  let endIndex = startIndex + 2;
  let previousRangeLine = nextLine;
  while (endIndex < pageLines.length) {
    const line = pageLines[endIndex];
    if (!isLikelyFootnoteContinuationLine(line, previousRangeLine, bodyFontSize)) break;
    previousRangeLine = line;
    endIndex += 1;
  }

  return endIndex;
}

function findFootnoteRangeEndIndex(
  pageLines: TextLine[],
  startIndex: number,
  bodyFontSize: number,
): number | undefined {
  const markerLine = pageLines[startIndex];
  if (!isFootnoteStartMarkerLine(markerLine, bodyFontSize)) return undefined;
  const nextLine = pageLines[startIndex + 1];
  if (!nextLine || !getFootnoteContentText(nextLine, bodyFontSize)) return undefined;
  let endIndex = startIndex + 2;
  let previousLine = nextLine;
  while (endIndex < pageLines.length) {
    const line = pageLines[endIndex];
    if (!isLikelyFootnoteContinuationLine(line, previousLine, bodyFontSize)) break;
    previousLine = line;
    endIndex += 1;
  }

  return endIndex;
}

function isFootnoteStartMarkerLine(line: TextLine, bodyFontSize: number): boolean {
  if (line.y > line.pageHeight * FOOTNOTE_START_MAX_VERTICAL_RATIO) return false;
  const text = normalizeSpacing(line.text);
  if (text.length === 0) return false;

  return FOOTNOTE_START_MARKER_RULES.some(
    (rule) => rule.pattern.test(text) && line.fontSize <= bodyFontSize * rule.maxFontRatio,
  );
}

function isUnmarkedFootnoteStartLine(
  line: TextLine,
  bodyFontSize: number,
  pageBodyFontSize: number,
): boolean {
  if (line.y > line.pageHeight * FOOTNOTE_UNMARKED_START_MAX_VERTICAL_RATIO) return false;
  if (line.fontSize > bodyFontSize * FOOTNOTE_UNMARKED_MAX_FONT_RATIO) return false;
  if (line.fontSize > pageBodyFontSize * FOOTNOTE_UNMARKED_MAX_PAGE_FONT_RATIO) return false;

  const text = normalizeSpacing(line.text);
  if (text.length < FOOTNOTE_MIN_TEXT_LENGTH) return false;
  if (FOOTNOTE_MARKER_PREFIX_PATTERN.test(text)) return false;
  return isLikelyFootnoteProseText(text);
}

function isLikelyUnmarkedFootnoteStartBoundary(
  previousLine: TextLine | undefined,
  startLine: TextLine,
  bodyFontSize: number,
): boolean {
  if (!previousLine) return false;
  if (previousLine.pageIndex !== startLine.pageIndex) return false;
  if (previousLine.y <= startLine.y) return false;
  if (previousLine.y - startLine.y < FOOTNOTE_UNMARKED_MIN_BOUNDARY_GAP) return false;

  const previousText = getFootnoteContentText(previousLine, bodyFontSize);
  if (!previousText) return true;
  return !isLikelyFootnoteProseText(previousText);
}

function isLikelyFootnoteProseText(text: string): boolean {
  if (!/[A-Za-z]/.test(text)) return false;
  if (!/[A-Za-z]{3,}/.test(text)) return false;
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length < FOOTNOTE_UNMARKED_MIN_WORD_COUNT) return false;
  const lowercaseWords = words.filter((word) => /^[a-z][a-z'-]{2,}$/u.test(word));
  return lowercaseWords.length >= FOOTNOTE_UNMARKED_MIN_LOWERCASE_WORD_COUNT;
}

function isLikelyFootnoteContinuationLine(
  line: TextLine,
  previousLine: TextLine,
  bodyFontSize: number,
): boolean {
  if (!isDescendingNearbyFootnoteLine(line, previousLine)) return false;
  return getFootnoteBlockText(line, bodyFontSize) !== undefined;
}

export { linkFootnoteMarkers } from "./footnote-link.ts";
