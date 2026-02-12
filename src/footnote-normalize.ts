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

  const continuationTexts = getMergeableFootnoteContinuationTexts(
    previousLine,
    line,
    bodyFontSize,
  );
  if (!continuationTexts) return undefined;

  const { previousText, currentText } = continuationTexts;
  if (
    !isDetachedTinyMathContinuationLine(previousLine, line, previousText, currentText) &&
    !isWithinStandardContinuationBounds(previousLine, line)
  ) {
    return undefined;
  }

  return buildMergedFootnoteContinuationLine(previousLine, line, previousText, currentText);
}

function getMergeableFootnoteContinuationTexts(
  previousLine: TextLine,
  line: TextLine,
  bodyFontSize: number,
): { previousText: string; currentText: string } | undefined {
  const previousText = getFootnoteBlockText(previousLine, bodyFontSize);
  const currentText = getFootnoteBlockText(line, bodyFontSize);
  if (!previousText || !currentText) return undefined;
  if (isBlockedFootnoteContinuationText(previousText, currentText)) return undefined;
  return { previousText, currentText };
}

function buildMergedFootnoteContinuationLine(
  previousLine: TextLine,
  line: TextLine,
  previousText: string,
  currentText: string,
): TextLine {
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
    FOOTNOTE_URL_START_PATTERN.test(currentText) ||
    FOOTNOTE_URL_START_PATTERN.test(previousText)
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
  const explicitMarkers = collectExplicitNumericMarkers(lines);
  if (explicitMarkers.length < 2) return lines;
  const resolvedLines = [...lines];

  for (let index = 0; index < explicitMarkers.length - 1; index += 1) {
    const currentMarker = explicitMarkers[index];
    const nextMarker = explicitMarkers[index + 1];
    if (nextMarker.marker <= currentMarker.marker + 1) continue;
    inferMissingNumericMarkersWithinRange(lines, resolvedLines, currentMarker, nextMarker);
  }

  return resolvedLines;
}

interface ExplicitNumericMarker {
  marker: number;
  index: number;
}

function inferMissingNumericMarkersWithinRange(
  lines: TextLine[],
  resolvedLines: TextLine[],
  currentMarker: ExplicitNumericMarker,
  nextMarker: ExplicitNumericMarker,
): void {
  let inferredMarker = currentMarker.marker;
  for (
    let lineIndex = currentMarker.index + 1;
    lineIndex < nextMarker.index && inferredMarker + 1 < nextMarker.marker;
    lineIndex += 1
  ) {
    const text = normalizeSpacing(lines[lineIndex].text);
    if (!FOOTNOTE_URL_START_PATTERN.test(text)) continue;
    inferredMarker += 1;
    resolvedLines[lineIndex] = { ...lines[lineIndex], text: `${inferredMarker} ${text}` };
  }
}

function collectExplicitNumericMarkers(lines: TextLine[]): ExplicitNumericMarker[] {
  const explicitMarkers: ExplicitNumericMarker[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const marker = parseLeadingNumericMarker(lines[index].text);
    if (marker !== undefined) {
      explicitMarkers.push({ marker, index });
    }
  }
  return explicitMarkers;
}

export { parseLeadingNumericMarker } from "./string-utils.ts";
