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

const FOOTNOTE_START_MARKER_RULES = [
  {
    pattern: FOOTNOTE_SYMBOL_MARKER_ONLY_PATTERN,
    maxFontRatio: FOOTNOTE_SYMBOL_MARKER_MAX_FONT_RATIO,
  },
  {
    pattern: FOOTNOTE_SYMBOL_MARKER_PREFIX_PATTERN,
    maxFontRatio: FOOTNOTE_SYMBOL_MARKER_MAX_FONT_RATIO,
  },
  {
    pattern: FOOTNOTE_NUMERIC_MARKER_ONLY_PATTERN,
    maxFontRatio: FOOTNOTE_NUMERIC_MARKER_MAX_FONT_RATIO,
  },
] as const;

export function movePageFootnotesToDocumentEnd(lines: TextLine[]): TextLine[] {
  if (lines.length === 0) return lines;
  const bodyFontSize = estimateBodyFontSize(lines);
  const moved = collectFootnoteLines(lines, bodyFontSize);

  if (moved.size === 0) return lines;
  const bodyLines: TextLine[] = [];
  const footnoteLines: TextLine[] = [];
  for (const line of lines) {
    if (moved.has(line)) {
      footnoteLines.push(line);
      continue;
    }
    bodyLines.push(line);
  }
  return [...bodyLines, ...mergeStandaloneFootnoteMarkerLines(footnoteLines, bodyFontSize)];
}

function collectFootnoteLines(lines: TextLine[], bodyFontSize: number): Set<TextLine> {
  const pageGroups = groupLinesByPage(lines);
  const moved = new Set<TextLine>();
  for (const pageLines of pageGroups.values()) {
    addFootnoteLinesOnPage(moved, pageLines, bodyFontSize);
  }
  return moved;
}

function addFootnoteLinesOnPage(
  moved: Set<TextLine>,
  pageLines: TextLine[],
  bodyFontSize: number,
): void {
  let index = 0;

  while (index < pageLines.length - 1) {
    const endIndex = findFootnoteRangeEndIndex(pageLines, index, bodyFontSize);
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

function findFootnoteRangeEndIndex(
  pageLines: TextLine[],
  startIndex: number,
  bodyFontSize: number,
): number | undefined {
  const markerLine = pageLines[startIndex];
  if (!isFootnoteStartMarkerLine(markerLine, bodyFontSize)) return undefined;

  const nextLine = pageLines[startIndex + 1];
  if (!isLikelyFootnoteTextLine(nextLine, bodyFontSize)) return undefined;

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

  for (const rule of FOOTNOTE_START_MARKER_RULES) {
    if (rule.pattern.test(text) && line.fontSize <= bodyFontSize * rule.maxFontRatio) {
      return true;
    }
  }

  return false;
}

function isLikelyFootnoteTextLine(line: TextLine, bodyFontSize: number): boolean {
  const text = getValidFootnoteBlockText(line, bodyFontSize);
  return text !== undefined && text.length >= FOOTNOTE_MIN_TEXT_LENGTH && /[A-Za-z]/.test(text);
}

function isLikelyFootnoteContinuationLine(
  line: TextLine,
  previousLine: TextLine,
  bodyFontSize: number,
): boolean {
  if (line.pageIndex !== previousLine.pageIndex) return false;
  if (line.y >= previousLine.y) return false;
  if (previousLine.y - line.y > FOOTNOTE_MAX_VERTICAL_GAP) return false;
  return getValidFootnoteBlockText(line, bodyFontSize) !== undefined;
}

function getValidFootnoteBlockText(
  line: TextLine,
  bodyFontSize: number,
): string | undefined {
  if (line.y > line.pageHeight * FOOTNOTE_BLOCK_MAX_VERTICAL_RATIO) return undefined;
  if (line.fontSize > bodyFontSize * FOOTNOTE_TEXT_MAX_FONT_RATIO) return undefined;

  const text = normalizeSpacing(line.text);
  if (text.length === 0) return undefined;
  return text;
}

function mergeStandaloneFootnoteMarkerLines(
  footnoteLines: TextLine[],
  bodyFontSize: number,
): TextLine[] {
  if (footnoteLines.length < 2) return footnoteLines;
  const merged: TextLine[] = [];
  let index = 0;

  while (index < footnoteLines.length) {
    const markerLine = footnoteLines[index];
    const textLine = footnoteLines[index + 1];
    const markerText = normalizeSpacing(markerLine.text);
    if (
      textLine !== undefined &&
      markerLine.pageIndex === textLine.pageIndex &&
      isFootnoteMarkerOnlyText(markerText) &&
      isLikelyFootnoteTextLine(textLine, bodyFontSize)
    ) {
      const textLineText = normalizeSpacing(textLine.text);
      merged.push({
        ...textLine,
        x: Math.min(markerLine.x, textLine.x),
        estimatedWidth: Math.max(
          textLine.estimatedWidth,
          markerLine.estimatedWidth + textLine.estimatedWidth,
        ),
        text: `${markerText} ${textLineText}`,
      });
      index += 2;
      continue;
    }

    merged.push(markerLine);
    index += 1;
  }

  return merged;
}

function isFootnoteMarkerOnlyText(text: string): boolean {
  return FOOTNOTE_SYMBOL_MARKER_ONLY_PATTERN.test(text);
}
