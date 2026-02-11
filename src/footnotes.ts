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
const FOOTNOTE_PUBLICATION_METADATA_MAX_PAGE_INDEX = 1;
const FOOTNOTE_PUBLICATION_METADATA_START_MAX_VERTICAL_RATIO = 0.2;
const FOOTNOTE_PUBLICATION_METADATA_START_MAX_FONT_RATIO = 1.06;
const FOOTNOTE_PUBLICATION_METADATA_START_MAX_PAGE_FONT_RATIO = 1.08;
const FOOTNOTE_PUBLICATION_METADATA_MAX_X_DELTA_RATIO = 0.05;
const FOOTNOTE_PUBLICATION_METADATA_MAX_FONT_DELTA = 0.8;
const FOOTNOTE_PUBLICATION_METADATA_MIN_LINES = 2;
const FOOTNOTE_PUBLICATION_METADATA_START_PATTERN =
  /^(?:[*∗†‡§¶#]\s*)?corresponding\s+author\b/iu;
const FOOTNOTE_PUBLICATION_METADATA_EMAIL_PATTERN = /^e-?mail\s+address:\s+/iu;
const FOOTNOTE_PUBLICATION_METADATA_DOI_PATTERN =
  /^(?:https?:\/\/(?:dx\.)?doi\.org\/10\.|doi\.org\/10\.|org\/10\.|(?:doi\s*:\s*)?10\.\d{4,9}\/)/iu;
const FOOTNOTE_PUBLICATION_METADATA_ARTICLE_HISTORY_PATTERN =
  /^(?:received\b|accepted\b|available\s+online\b)/iu;
const FOOTNOTE_PUBLICATION_METADATA_COPYRIGHT_PATTERN =
  /^(?:\d{4}-\d{3,4}\/)?(?:©|\(c\)|copyright\b|all rights reserved\b)/iu;

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

interface FootnoteDetectionContext {
  pageLines: TextLine[];
  startIndex: number;
  bodyFontSize: number;
  pageBodyFontSize: number;
}

type FootnoteRangeDetector = (context: FootnoteDetectionContext) => number | undefined;

const FOOTNOTE_RANGE_DETECTORS: readonly FootnoteRangeDetector[] = [
  findPublicationMetadataFootnoteRangeEndIndex,
  findFootnoteRangeEndIndex,
  findUnmarkedFootnoteRangeEndIndex,
];

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
    for (let index = 0; index < pageLines.length - 1; ) {
      const endIndex = findFirstFootnoteRangeEndIndex({
        pageLines,
        startIndex: index,
        bodyFontSize,
        pageBodyFontSize,
      });
      if (endIndex === undefined) {
        index += 1;
        continue;
      }
      addLineRangeToSet(moved, pageLines, index, endIndex);
      index = endIndex;
    }
  }
  return moved;
}

function addLineRangeToSet(
  target: Set<TextLine>,
  lines: TextLine[],
  startIndex: number,
  endIndex: number,
): void {
  for (let index = startIndex; index < endIndex; index += 1) {
    target.add(lines[index]);
  }
}

function findFirstFootnoteRangeEndIndex(context: FootnoteDetectionContext): number | undefined {
  for (const detector of FOOTNOTE_RANGE_DETECTORS) {
    const endIndex = detector(context);
    if (endIndex !== undefined) return endIndex;
  }
  return undefined;
}

function findPublicationMetadataFootnoteRangeEndIndex(
  context: FootnoteDetectionContext,
): number | undefined {
  const { pageLines, startIndex, bodyFontSize, pageBodyFontSize } = context;
  const startLine = pageLines[startIndex];
  if (!isPublicationMetadataStartLine(startLine, bodyFontSize, pageBodyFontSize)) return undefined;

  const endIndex = extendRangeEndIndex(pageLines, startIndex, (line, previousLine) =>
    isLikelyPublicationMetadataContinuationLine(line, previousLine, bodyFontSize, pageBodyFontSize),
  );

  return endIndex - startIndex >= FOOTNOTE_PUBLICATION_METADATA_MIN_LINES ? endIndex : undefined;
}

function findUnmarkedFootnoteRangeEndIndex(
  context: FootnoteDetectionContext,
): number | undefined {
  const { pageLines, startIndex, bodyFontSize, pageBodyFontSize } = context;
  const startLine = pageLines[startIndex];
  if (!isUnmarkedFootnoteStartLine(startLine, bodyFontSize, pageBodyFontSize)) return undefined;

  const previousLine = pageLines[startIndex - 1];
  if (!isLikelyUnmarkedFootnoteStartBoundary(previousLine, startLine, bodyFontSize)) {
    return undefined;
  }

  return findFootnoteContinuationRangeEndIndex(pageLines, startIndex + 1, bodyFontSize);
}

function findFootnoteRangeEndIndex(
  context: FootnoteDetectionContext,
): number | undefined {
  const { pageLines, startIndex, bodyFontSize } = context;
  const markerLine = pageLines[startIndex];
  if (!isFootnoteStartMarkerLine(markerLine, bodyFontSize)) return undefined;
  return findFootnoteContinuationRangeEndIndex(pageLines, startIndex + 1, bodyFontSize);
}

function findFootnoteContinuationRangeEndIndex(
  pageLines: TextLine[],
  firstContentIndex: number,
  bodyFontSize: number,
): number | undefined {
  const firstContentLine = pageLines[firstContentIndex];
  if (!firstContentLine || !getFootnoteContentText(firstContentLine, bodyFontSize)) return undefined;
  return extendRangeEndIndex(pageLines, firstContentIndex, (line, previousLine) =>
    isLikelyFootnoteContinuationLine(line, previousLine, bodyFontSize),
  );
}

function extendRangeEndIndex(
  pageLines: TextLine[],
  startIndex: number,
  isContinuationLine: (line: TextLine, previousLine: TextLine) => boolean,
): number {
  let endIndex = startIndex + 1;
  let previousLine = pageLines[startIndex];
  while (endIndex < pageLines.length) {
    const line = pageLines[endIndex];
    if (!isContinuationLine(line, previousLine)) break;
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

function isPublicationMetadataStartLine(
  line: TextLine,
  bodyFontSize: number,
  pageBodyFontSize: number,
): boolean {
  if (line.pageIndex > FOOTNOTE_PUBLICATION_METADATA_MAX_PAGE_INDEX) return false;
  if (line.pageHeight <= 0) return false;
  if (line.y > line.pageHeight * FOOTNOTE_PUBLICATION_METADATA_START_MAX_VERTICAL_RATIO) {
    return false;
  }
  if (!isWithinPublicationMetadataFontBounds(line, bodyFontSize, pageBodyFontSize)) return false;

  const text = normalizeSpacing(line.text);
  return FOOTNOTE_PUBLICATION_METADATA_START_PATTERN.test(text);
}

function isLikelyPublicationMetadataContinuationLine(
  line: TextLine,
  previousLine: TextLine,
  bodyFontSize: number,
  pageBodyFontSize: number,
): boolean {
  if (!isDescendingNearbyFootnoteLine(line, previousLine)) return false;
  if (
    Math.abs(line.x - previousLine.x) > line.pageWidth * FOOTNOTE_PUBLICATION_METADATA_MAX_X_DELTA_RATIO
  ) {
    return false;
  }
  if (Math.abs(line.fontSize - previousLine.fontSize) > FOOTNOTE_PUBLICATION_METADATA_MAX_FONT_DELTA) {
    return false;
  }
  if (!isWithinPublicationMetadataFontBounds(line, bodyFontSize, pageBodyFontSize)) return false;

  const text = normalizeSpacing(line.text);
  if (text.length < FOOTNOTE_MIN_TEXT_LENGTH) return false;
  return isPublicationMetadataLineText(text);
}

function isWithinPublicationMetadataFontBounds(
  line: TextLine,
  bodyFontSize: number,
  pageBodyFontSize: number,
): boolean {
  return (
    line.fontSize <= bodyFontSize * FOOTNOTE_PUBLICATION_METADATA_START_MAX_FONT_RATIO &&
    line.fontSize <= pageBodyFontSize * FOOTNOTE_PUBLICATION_METADATA_START_MAX_PAGE_FONT_RATIO
  );
}

function isPublicationMetadataLineText(text: string): boolean {
  return (
    FOOTNOTE_PUBLICATION_METADATA_EMAIL_PATTERN.test(text) ||
    FOOTNOTE_PUBLICATION_METADATA_DOI_PATTERN.test(text) ||
    FOOTNOTE_PUBLICATION_METADATA_ARTICLE_HISTORY_PATTERN.test(text) ||
    FOOTNOTE_PUBLICATION_METADATA_COPYRIGHT_PATTERN.test(text)
  );
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
