import type { TextLine } from "./pdf-types.ts";
import {
  getFootnoteBlockText,
  getFootnoteContentText,
  isDescendingNearbyFootnoteLine,
} from "./footnote-line-text.ts";
import { parseLeadingNumericMarker } from "./string-utils.ts";
import { normalizeSpacing } from "./text-lines.ts";

const FOOTNOTE_SYMBOL_MARKER_ONLY_PATTERN = /^(?:[*∗†‡§¶#])$/u;
const FOOTNOTE_NUMERIC_MARKER_ONLY_PATTERN = /^\(?\d{1,2}\)?[.)]?$/u;
const FOOTNOTE_CONTINUATION_MAX_LEFT_OFFSET_RATIO = 0.08;
const FOOTNOTE_CONTINUATION_MAX_FONT_DELTA = 0.8;
const FOOTNOTE_MARKER_PREFIX_PATTERN = /^(?:[*∗†‡§¶#]|\(?\d{1,2}\)?[.)]?)\s+/u;
const FOOTNOTE_URL_START_PATTERN = /^https?:\/\//iu;

export function normalizeFootnoteLines(footnoteLines: TextLine[], bodyFontSize: number): TextLine[] {
  return inferMissingNumericFootnoteMarkers(
    mergeWrappedFootnoteLines(
      mergeStandaloneFootnoteMarkerLines(footnoteLines, bodyFontSize),
      bodyFontSize,
    ),
  );
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
    estimatedWidth: Math.max(markerLine.estimatedWidth + textLine.estimatedWidth, textLine.estimatedWidth),
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
  if (!isDescendingNearbyFootnoteLine(line, previousLine)) return undefined;
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

export { parseLeadingNumericMarker } from "./string-utils.ts";
