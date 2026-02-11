import type { TextLine } from "./pdf-types.ts";
import { estimateBodyFontSize, groupLinesByPage, normalizeSpacing } from "./text-lines.ts";

const FOOTNOTE_SYMBOL_MARKER_ONLY_PATTERN = /^(?:[*∗†‡§¶#])$/u;
const FOOTNOTE_SYMBOL_START_MARKER_PATTERN = /^(?:[*∗†‡§¶#])(?:\s+.+)?$/u;
const FOOTNOTE_NUMERIC_MARKER_ONLY_PATTERN = /^\(?\d{1,2}\)?[.)]?$/u;
const FOOTNOTE_START_MAX_VERTICAL_RATIO = 0.38;
const FOOTNOTE_BLOCK_MAX_VERTICAL_RATIO = 0.42;
const FOOTNOTE_SYMBOL_MARKER_MAX_FONT_RATIO = 0.82;
const FOOTNOTE_NUMERIC_MARKER_MAX_FONT_RATIO = 0.65;
const FOOTNOTE_TEXT_MAX_FONT_RATIO = 0.98;
const FOOTNOTE_MIN_TEXT_LENGTH = 8;
const FOOTNOTE_MAX_VERTICAL_GAP = 20;
const FOOTNOTE_CONTINUATION_MAX_LEFT_OFFSET_RATIO = 0.08;
const FOOTNOTE_CONTINUATION_MAX_FONT_DELTA = 0.8;
const FOOTNOTE_MARKER_PREFIX_PATTERN = /^(?:[*∗†‡§¶#]|\(?\d{1,2}\)?[.)]?)\s+/u;
const FOOTNOTE_LEADING_NUMERIC_MARKER_PATTERN = /^\(?(\d{1,2})\)?[.)]?\s+/u;
const FOOTNOTE_URL_START_PATTERN = /^https?:\/\//iu;

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

function normalizeFootnoteLines(footnoteLines: TextLine[], bodyFontSize: number): TextLine[] {
  return inferMissingNumericFootnoteMarkers(
    mergeWrappedFootnoteLines(
      mergeStandaloneFootnoteMarkerLines(footnoteLines, bodyFontSize),
      bodyFontSize,
    ),
  );
}

function collectFootnoteLines(lines: TextLine[], bodyFontSize: number): Set<TextLine> {
  const moved = new Set<TextLine>();
  for (const pageLines of groupLinesByPage(lines).values()) {
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
  return moved;
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

function isLikelyFootnoteContinuationLine(
  line: TextLine,
  previousLine: TextLine,
  bodyFontSize: number,
): boolean {
  if (!isDescendingNearbyLine(line, previousLine)) return false;
  return getFootnoteBlockText(line, bodyFontSize) !== undefined;
}

function isDescendingNearbyLine(line: TextLine, previousLine: TextLine): boolean {
  if (line.pageIndex !== previousLine.pageIndex) return false;
  if (line.y >= previousLine.y) return false;
  return previousLine.y - line.y <= FOOTNOTE_MAX_VERTICAL_GAP;
}

function getFootnoteBlockText(line: TextLine, bodyFontSize: number): string | undefined {
  if (line.y > line.pageHeight * FOOTNOTE_BLOCK_MAX_VERTICAL_RATIO) return undefined;
  if (line.fontSize > bodyFontSize * FOOTNOTE_TEXT_MAX_FONT_RATIO) return undefined;

  const text = normalizeSpacing(line.text);
  if (text.length === 0) return undefined;
  return text;
}

function getFootnoteContentText(line: TextLine, bodyFontSize: number): string | undefined {
  const text = getFootnoteBlockText(line, bodyFontSize);
  if (!text || text.length < FOOTNOTE_MIN_TEXT_LENGTH) return undefined;
  if (!/[A-Za-z]/.test(text)) return undefined;
  return text;
}

function mergeStandaloneFootnoteMarkerLines(
  footnoteLines: TextLine[],
  bodyFontSize: number,
): TextLine[] {
  return mergeAdjacentLines(footnoteLines, (markerLine, textLine) =>
    mergeStandaloneMarkerLine(markerLine, textLine, bodyFontSize),
  );
}

function mergeStandaloneMarkerLine(
  markerLine: TextLine,
  textLine: TextLine | undefined,
  bodyFontSize: number,
): TextLine | undefined {
  if (!textLine) return undefined;
  if (markerLine.pageIndex !== textLine.pageIndex) return undefined;

  const markerText = normalizeSpacing(markerLine.text);
  if (!isFootnoteMarkerOnlyText(markerText)) return undefined;
  const textLineText = getFootnoteContentText(textLine, bodyFontSize);
  if (!textLineText) return undefined;

  return {
    ...textLine,
    x: Math.min(markerLine.x, textLine.x),
    estimatedWidth: Math.max(
      textLine.estimatedWidth,
      markerLine.estimatedWidth + textLine.estimatedWidth,
    ),
    text: `${markerText} ${textLineText}`,
  };
}

function isFootnoteMarkerOnlyText(text: string): boolean {
  return (
    FOOTNOTE_SYMBOL_MARKER_ONLY_PATTERN.test(text) ||
    FOOTNOTE_NUMERIC_MARKER_ONLY_PATTERN.test(text)
  );
}

function mergeWrappedFootnoteLines(footnoteLines: TextLine[], bodyFontSize: number): TextLine[] {
  return mergeAdjacentLines(footnoteLines, (previousLine, line) =>
    mergeFootnoteContinuationLine(previousLine, line, bodyFontSize),
  );
}

function mergeAdjacentLines(
  lines: TextLine[],
  tryMerge: (previousLine: TextLine, line: TextLine) => TextLine | undefined,
): TextLine[] {
  if (lines.length < 2) return lines;
  const merged: TextLine[] = [lines[0]];

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    const previousLine = merged[merged.length - 1];
    const mergedLine = tryMerge(previousLine, line);
    if (mergedLine) {
      merged[merged.length - 1] = mergedLine;
      continue;
    }
    merged.push(line);
  }

  return merged;
}

function mergeFootnoteContinuationLine(
  previousLine: TextLine,
  line: TextLine,
  bodyFontSize: number,
): TextLine | undefined {
  if (!isDescendingNearbyLine(line, previousLine)) return undefined;
  if (Math.abs(line.fontSize - previousLine.fontSize) > FOOTNOTE_CONTINUATION_MAX_FONT_DELTA) {
    return undefined;
  }

  const leftOffset = Math.abs(line.x - previousLine.x);
  if (leftOffset > line.pageWidth * FOOTNOTE_CONTINUATION_MAX_LEFT_OFFSET_RATIO) return undefined;

  const previousText = getFootnoteBlockText(previousLine, bodyFontSize);
  const currentText = getFootnoteBlockText(line, bodyFontSize);
  if (!previousText || !currentText) return undefined;
  if (FOOTNOTE_MARKER_PREFIX_PATTERN.test(currentText)) return undefined;
  if (FOOTNOTE_URL_START_PATTERN.test(currentText)) return undefined;
  if (FOOTNOTE_URL_START_PATTERN.test(previousText)) return undefined;

  return {
    ...previousLine,
    // Keep the merged line anchored to the latest physical line so
    // subsequent continuation checks use adjacent-line gaps.
    y: line.y,
    estimatedWidth: Math.max(previousLine.estimatedWidth, line.estimatedWidth),
    text: `${previousText} ${currentText}`,
  };
}

function inferMissingNumericFootnoteMarkers(lines: TextLine[]): TextLine[] {
  if (lines.length === 0) return lines;
  const markerNumbers = lines.map((line) => parseLeadingNumericMarker(line.text));
  const nextMarkerByIndex = buildNextMarkerByIndex(markerNumbers);
  const resolvedLines = [...lines];
  let previousMarker: number | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const currentMarker = markerNumbers[index];
    if (currentMarker !== undefined) {
      previousMarker = currentMarker;
      continue;
    }
    if (previousMarker === undefined) continue;

    const text = normalizeSpacing(lines[index].text);
    if (!FOOTNOTE_URL_START_PATTERN.test(text)) continue;

    const nextMarker = nextMarkerByIndex[index];
    if (nextMarker === undefined || nextMarker <= previousMarker + 1) continue;

    const inferredMarker = previousMarker + 1;
    resolvedLines[index] = { ...lines[index], text: `${inferredMarker} ${text}` };
    previousMarker = inferredMarker;
  }

  return resolvedLines;
}

function parseLeadingNumericMarker(text: string): number | undefined {
  const match = FOOTNOTE_LEADING_NUMERIC_MARKER_PATTERN.exec(normalizeSpacing(text));
  if (!match) return undefined;
  const marker = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(marker) ? marker : undefined;
}

function buildNextMarkerByIndex(markers: Array<number | undefined>): Array<number | undefined> {
  const nextMarkerByIndex: Array<number | undefined> = new Array(markers.length);
  let nextMarker: number | undefined;
  for (let index = markers.length - 1; index >= 0; index -= 1) {
    nextMarkerByIndex[index] = nextMarker;
    const marker = markers[index];
    if (marker !== undefined) {
      nextMarker = marker;
    }
  }
  return nextMarkerByIndex;
}
