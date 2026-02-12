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
const FOOTNOTE_TINY_MATH_FRAGMENT_MAX_TEXT_LENGTH = 24;
const FOOTNOTE_TINY_MATH_FRAGMENT_MAX_TOKEN_COUNT = 8;
const FOOTNOTE_TINY_MATH_FRAGMENT_MAX_VERTICAL_GAP = 4;
const FOOTNOTE_TINY_MATH_FRAGMENT_MAX_FONT_RATIO = 0.85;
const FOOTNOTE_TINY_MATH_FRAGMENT_ALLOWED_PATTERN = /^[A-Za-z0-9\s−\-+*/=(){}[\],.;:·√∑∏∞]+$/u;
const FOOTNOTE_TINY_MATH_FRAGMENT_SYMBOL_PATTERN = /[=+\-−*/√∑∏∞·]/u;
const FOOTNOTE_TINY_MATH_FRAGMENT_NUMERIC_PATTERN = /\d/;
const FOOTNOTE_TINY_MATH_FRAGMENT_MULTI_LETTER_TOKEN_PATTERN = /[A-Za-z]{2,}/;
const FOOTNOTE_TINY_MATH_CONTEXT_PATTERN = /[=+\-−*/√∑∏∞·]/u;

export function normalizeFootnoteLines(footnoteLines: TextLine[], bodyFontSize: number): TextLine[] {
  const markerMergedLines = mergeAdjacentLines(footnoteLines, (markerLine, textLine) =>
    mergeStandaloneMarkerLine(markerLine, textLine, bodyFontSize),
  );
  const continuationMergedLines = mergeAdjacentLines(markerMergedLines, (previousLine, line) =>
    mergeFootnoteContinuationLine(previousLine, line, bodyFontSize),
  );
  return inferMissingNumericFootnoteMarkers(continuationMergedLines);
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

  const previousText = getFootnoteBlockText(previousLine, bodyFontSize);
  const currentText = getFootnoteBlockText(line, bodyFontSize);
  if (!previousText || !currentText) return undefined;
  if (isBlockedFootnoteContinuationText(previousText, currentText)) {
    return undefined;
  }

  const detachedTinyMathContinuation = isDetachedTinyMathContinuationLine(
    previousLine,
    line,
    previousText,
    currentText,
  );
  if (!detachedTinyMathContinuation && !isWithinStandardContinuationBounds(previousLine, line)) {
    return undefined;
  }

  return {
    ...previousLine,
    // Keep the merged line anchored to the latest physical line so
    // subsequent continuation checks use adjacent-line gaps.
    y: line.y,
    estimatedWidth: Math.max(previousLine.estimatedWidth, line.estimatedWidth),
    text: `${previousText} ${currentText}`,
  };
}

function isBlockedFootnoteContinuationText(previousText: string, currentText: string): boolean {
  return (
    FOOTNOTE_MARKER_PREFIX_PATTERN.test(currentText) ||
    FOOTNOTE_URL_START_PATTERN.test(currentText) || FOOTNOTE_URL_START_PATTERN.test(previousText)
  );
}

function isWithinStandardContinuationBounds(previousLine: TextLine, line: TextLine): boolean {
  if (Math.abs(line.fontSize - previousLine.fontSize) > FOOTNOTE_CONTINUATION_MAX_FONT_DELTA) {
    return false;
  }
  return (
    Math.abs(line.x - previousLine.x) <=
    line.pageWidth * FOOTNOTE_CONTINUATION_MAX_LEFT_OFFSET_RATIO
  );
}

function isDetachedTinyMathContinuationLine(
  previousLine: TextLine,
  line: TextLine,
  previousText: string,
  currentText: string,
): boolean {
  if (previousLine.y <= line.y) return false;
  if (previousLine.y - line.y > FOOTNOTE_TINY_MATH_FRAGMENT_MAX_VERTICAL_GAP) return false;
  if (line.fontSize > previousLine.fontSize * FOOTNOTE_TINY_MATH_FRAGMENT_MAX_FONT_RATIO) {
    return false;
  }
  if (currentText.length > FOOTNOTE_TINY_MATH_FRAGMENT_MAX_TEXT_LENGTH) return false;
  if (!FOOTNOTE_TINY_MATH_FRAGMENT_ALLOWED_PATTERN.test(currentText)) return false;

  const tokens = currentText.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0 || tokens.length > FOOTNOTE_TINY_MATH_FRAGMENT_MAX_TOKEN_COUNT) {
    return false;
  }
  if (tokens.some((token) => FOOTNOTE_TINY_MATH_FRAGMENT_MULTI_LETTER_TOKEN_PATTERN.test(token))) {
    return false;
  }

  const hasMathSignal =
    FOOTNOTE_TINY_MATH_FRAGMENT_SYMBOL_PATTERN.test(currentText) ||
    FOOTNOTE_TINY_MATH_FRAGMENT_NUMERIC_PATTERN.test(currentText);
  if (!hasMathSignal) return false;

  return FOOTNOTE_TINY_MATH_CONTEXT_PATTERN.test(previousText);
}

function inferMissingNumericFootnoteMarkers(lines: TextLine[]): TextLine[] {
  if (lines.length === 0) return lines;
  const markerNumbers = lines.map((line) => parseLeadingNumericMarker(line.text));
  const explicitMarkers = markerNumbers
    .map((marker, index) => (marker === undefined ? undefined : { marker, index }))
    .filter((value): value is { marker: number; index: number } => value !== undefined);
  const resolvedLines = [...lines];
  let previousMarker: number | undefined;
  let nextExplicitMarkerIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const currentExplicitMarker = explicitMarkers[nextExplicitMarkerIndex];
    if (currentExplicitMarker?.index === index) {
      previousMarker = currentExplicitMarker.marker;
      nextExplicitMarkerIndex += 1;
      continue;
    }
    if (previousMarker === undefined) continue;

    const text = normalizeSpacing(lines[index].text);
    if (!FOOTNOTE_URL_START_PATTERN.test(text)) continue;

    const nextMarker = explicitMarkers[nextExplicitMarkerIndex]?.marker;
    if (nextMarker === undefined || nextMarker <= previousMarker + 1) continue;

    const inferredMarker = previousMarker + 1;
    resolvedLines[index] = { ...lines[index], text: `${inferredMarker} ${text}` };
    previousMarker = inferredMarker;
  }

  return resolvedLines;
}

export { parseLeadingNumericMarker } from "./string-utils.ts";
