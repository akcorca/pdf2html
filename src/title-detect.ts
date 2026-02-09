import type { PageVerticalExtent, TextLine } from "./pdf-types.ts";
import {
  MAX_NEARBY_SAME_FONT_LINES,
  MAX_TOP_MATTER_TITLE_COMMA_COUNT,
  MIN_AUTHOR_LINE_COMMA_COUNT,
  MIN_AUTHOR_NAME_TOKEN_COUNT,
  MIN_TOP_MATTER_TITLE_WORD_COUNT,
  TITLE_MAX_WIDTH_RATIO,
  TITLE_MIN_FONT_SIZE_DELTA,
  TITLE_MIN_FONT_SIZE_RATIO,
  TITLE_MIN_RELATIVE_VERTICAL_POSITION,
  TITLE_NEARBY_FONT_SIZE_TOLERANCE,
  TITLE_NEARBY_LINE_WINDOW,
  TOP_MATTER_TITLE_LOOKBACK_LINES,
} from "./pdf-types.ts";
import {
  computePageVerticalExtents,
  estimateBodyFontSize,
  groupLinesByPage,
  getRelativeVerticalPosition,
  normalizeSpacing,
} from "./text-lines.ts";

const TITLE_SEARCH_PAGE_LIMIT = 3;

export function findTitleLine(lines: TextLine[]): TextLine | undefined {
  if (lines.length === 0) return undefined;
  const bodyFontSize = estimateBodyFontSize(lines);
  const linesByPage = groupLinesByPage(lines);
  const pageIndexes = [...linesByPage.keys()].sort((left, right) => left - right);
  for (const pageIndex of pageIndexes.slice(0, TITLE_SEARCH_PAGE_LIMIT)) {
    const pageLines = linesByPage.get(pageIndex);
    if (!pageLines || pageLines.length === 0) continue;
    const titleLine = findTitleLineOnPage(pageLines, bodyFontSize);
    if (titleLine) return titleLine;
  }
  return undefined;
}

function findTitleLineOnPage(
  pageLines: TextLine[],
  bodyFontSize: number,
): TextLine | undefined {
  const minTitleFontSize = Math.max(
    bodyFontSize + TITLE_MIN_FONT_SIZE_DELTA,
    bodyFontSize * TITLE_MIN_FONT_SIZE_RATIO,
  );
  const extents = computePageVerticalExtents(pageLines);
  let bestCandidate: TextLine | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const line of pageLines) {
    if (!isTitleCandidate(line, minTitleFontSize, extents, pageLines)) continue;
    const score = scoreTitleCandidate(line, bodyFontSize);
    if (score > bestScore) {
      bestCandidate = line;
      bestScore = score;
    }
  }

  if (bestCandidate) return bestCandidate;
  return findTopMatterTitleFallback(pageLines);
}

function isTitleCandidate(
  line: TextLine,
  minFontSize: number,
  extents: Map<number, PageVerticalExtent>,
  allLines: TextLine[],
): boolean {
  if (line.fontSize < minFontSize) return false;
  if (line.text.length < 8) return false;
  if (/[.!?]$/.test(line.text)) return false;
  const wordCount = line.text.split(/\s+/).filter((part) => part.length > 0).length;
  if (wordCount < MIN_TOP_MATTER_TITLE_WORD_COUNT) return false;
  const relativeY = getRelativeVerticalPosition(line, extents);
  if (relativeY < TITLE_MIN_RELATIVE_VERTICAL_POSITION) return false;
  if (line.estimatedWidth > line.pageWidth * TITLE_MAX_WIDTH_RATIO) return false;
  if (isLikelyDenseSameFontBlock(line, allLines)) return false;
  const pageCenter = line.pageWidth / 2;
  const lineCenter = line.x + line.estimatedWidth / 2;
  return Math.abs(lineCenter - pageCenter) <= line.pageWidth * 0.2;
}

function isLikelyDenseSameFontBlock(line: TextLine, pageLines: TextLine[]): boolean {
  let nearbySameFontLineCount = 0;
  for (const other of pageLines) {
    if (
      Math.abs(other.y - line.y) <= TITLE_NEARBY_LINE_WINDOW &&
      Math.abs(other.fontSize - line.fontSize) <= TITLE_NEARBY_FONT_SIZE_TOLERANCE
    ) {
      nearbySameFontLineCount += 1;
      if (nearbySameFontLineCount > MAX_NEARBY_SAME_FONT_LINES) return true;
    }
  }
  return false;
}

function findTopMatterTitleFallback(pageLines: TextLine[]): TextLine | undefined {
  const sorted = [...pageLines].sort((a, b) => {
    if (a.y !== b.y) return b.y - a.y;
    return a.x - b.x;
  });
  const authorIdx = sorted.findIndex((line) => isLikelyAuthorLine(line.text));
  if (authorIdx <= 0) return undefined;

  const authorLine = sorted[authorIdx];
  const minIdx = Math.max(0, authorIdx - TOP_MATTER_TITLE_LOOKBACK_LINES);
  let fallbackTitleLine: TextLine | undefined;

  for (let i = authorIdx - 1; i >= minIdx; i -= 1) {
    const line = sorted[i];
    const isAlignedTopMatterTitleLine =
      isLikelyTopMatterTitleLine(line.text) &&
      Math.abs(line.x - authorLine.x) <= line.pageWidth * 0.08;
    if (!isAlignedTopMatterTitleLine) {
      if (fallbackTitleLine) break;
      continue;
    }
    fallbackTitleLine = line;
  }

  return fallbackTitleLine;
}

function isLikelyAuthorLine(text: string): boolean {
  const normalized = normalizeSpacing(text);
  if (normalized.length < 20) return false;
  if (containsDocumentMetadata(normalized)) return false;
  const commaCount = (normalized.match(/,/g) ?? []).length;
  if (commaCount < MIN_AUTHOR_LINE_COMMA_COUNT) return false;
  const capitalizedTokens = normalized.match(/\b[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?\b/g) ?? [];
  return capitalizedTokens.length >= MIN_AUTHOR_NAME_TOKEN_COUNT;
}

function isLikelyTopMatterTitleLine(text: string): boolean {
  const normalized = normalizeSpacing(text);
  if (normalized.length < 20 || normalized.length > 140) return false;
  if (containsDocumentMetadata(normalized)) return false;
  if (/[.!?]$/.test(normalized)) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;
  const wordCount = normalized.split(" ").filter((p) => p.length > 0).length;
  if (wordCount < MIN_TOP_MATTER_TITLE_WORD_COUNT) return false;
  const commaCount = (normalized.match(/,/g) ?? []).length;
  if (commaCount > MAX_TOP_MATTER_TITLE_COMMA_COUNT) return false;
  if (/^[A-Z0-9\- ]+$/.test(normalized)) return false;
  const alphaOnly = normalized.replace(/[^A-Za-z]/g, "");
  const uppercaseRatio =
    alphaOnly.length > 0 ? alphaOnly.replace(/[^A-Z]/g, "").length / alphaOnly.length : 0;
  return uppercaseRatio <= 0.9;
}

export function containsDocumentMetadata(text: string): boolean {
  return /(?:https?:\/\/|www\.|@|doi\b|wileyonlinelibrary\.com)/i.test(text);
}

export function scoreTitleCandidate(line: TextLine, bodyFontSize: number): number {
  const pageCenter = line.pageWidth / 2;
  const lineCenter = line.x + line.estimatedWidth / 2;
  const centerDistance = Math.abs(lineCenter - pageCenter);
  const centerScore = 1 - Math.min(centerDistance / pageCenter, 1);
  const sizeScore = line.fontSize / Math.max(bodyFontSize, 1);
  const verticalScore = line.y / Math.max(line.pageHeight, 1);
  return sizeScore * 3 + centerScore * 2 + verticalScore;
}
