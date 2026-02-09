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
  const candidates = pageLines.filter((line) =>
    isTitleCandidate(line, minTitleFontSize, extents, pageLines),
  );

  if (candidates.length === 0) return findTopMatterTitleFallback(pageLines);

  return candidates.sort(
    (a, b) => scoreTitleCandidate(b, bodyFontSize) - scoreTitleCandidate(a, bodyFontSize),
  )[0];
}

function groupLinesByPage(lines: TextLine[]): Map<number, TextLine[]> {
  const grouped = new Map<number, TextLine[]>();
  for (const line of lines) {
    const existing = grouped.get(line.pageIndex);
    if (existing) {
      existing.push(line);
    } else {
      grouped.set(line.pageIndex, [line]);
    }
  }
  return grouped;
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

function isLikelyDenseSameFontBlock(line: TextLine, firstPageLines: TextLine[]): boolean {
  const count = firstPageLines.filter(
    (other) =>
      Math.abs(other.y - line.y) <= TITLE_NEARBY_LINE_WINDOW &&
      Math.abs(other.fontSize - line.fontSize) <= TITLE_NEARBY_FONT_SIZE_TOLERANCE,
  ).length;
  return count > MAX_NEARBY_SAME_FONT_LINES;
}

function findTopMatterTitleFallback(firstPageLines: TextLine[]): TextLine | undefined {
  const sorted = [...firstPageLines].sort((a, b) => {
    if (a.y !== b.y) return b.y - a.y;
    return a.x - b.x;
  });
  const authorIdx = sorted.findIndex((line) => isLikelyAuthorLine(line.text));
  if (authorIdx <= 0) return undefined;

  const authorLine = sorted[authorIdx];
  const minIdx = Math.max(0, authorIdx - TOP_MATTER_TITLE_LOOKBACK_LINES);
  const block: TextLine[] = [];

  for (let i = authorIdx - 1; i >= minIdx; i -= 1) {
    const line = sorted[i];
    if (!isLikelyTopMatterTitleLine(line.text)) {
      if (block.length > 0) break;
      continue;
    }
    const maxXOffset = line.pageWidth * 0.08;
    if (Math.abs(line.x - authorLine.x) > maxXOffset) {
      if (block.length > 0) break;
      continue;
    }
    block.push(line);
  }

  return block.length === 0 ? undefined : block[block.length - 1];
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
