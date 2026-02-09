import type {
  ExtractedDocument,
  ExtractedFragment,
  ExtractedPage,
  PageVerticalExtent,
  TextLine,
} from "./pdf-types.ts";
import {
  COLUMN_BREAK_LEFT_MAX_RATIO,
  COLUMN_BREAK_RIGHT_MIN_RATIO,
  LINE_Y_BUCKET_SIZE,
  MAX_REASONABLE_Y_MULTIPLIER,
  MIN_COLUMN_BREAK_GAP,
  MIN_COLUMN_BREAK_GAP_RATIO,
  MIN_COLUMN_BREAK_TEXT_CHARACTER_COUNT,
  MIN_MULTI_COLUMN_BREAK_ROWS,
  MIN_MULTI_COLUMN_BREAK_ROW_RATIO,
  PAGE_EDGE_MARGIN,
  STANDALONE_PAGE_NUMBER_PATTERN,
} from "./pdf-types.ts";

const NUMBERED_SECTION_MARKER_PATTERN = /^\d+(?:\.\d+){0,4}\.?$/;
const MAX_NUMBERED_SECTION_PREFIX_WORDS = 8;
const MULTI_COLUMN_SPLIT_RATIO = 0.5;
const MULTI_COLUMN_SPANNING_LINE_WIDTH_RATIO = 0.62;
const MULTI_COLUMN_HEADING_REORDER_PATTERN = /^(\d+(?:\.\d+){0,4}\.?)\s+(.+)$/u;
const MAX_MULTI_COLUMN_HEADING_TEXT_LENGTH = 90;
const MAX_MULTI_COLUMN_HEADING_WORDS = 16;

export function collectTextLines(document: ExtractedDocument): TextLine[] {
  const lines: TextLine[] = [];
  const multiColumnPageIndexes = new Set<number>();
  for (const page of document.pages) {
    const collectedPage = collectPageLines(page);
    lines.push(...collectedPage.lines);
    if (collectedPage.isMultiColumn) multiColumnPageIndexes.add(page.pageIndex);
  }
  return lines.sort((left, right) => compareLinesForReadingOrder(left, right, multiColumnPageIndexes));
}

function collectPageLines(page: ExtractedPage): { lines: TextLine[]; isMultiColumn: boolean } {
  const buckets = bucketFragments(page);
  const splitByColumn = isLikelyMultiColumnPage(buckets, page.width);
  const lines: TextLine[] = [];

  for (const [bucket, bucketFragments] of buckets) {
    const sorted = [...bucketFragments].sort((left, right) => left.x - right.x);
    const breakIndexes = findColumnBreakIndexes(sorted, page.width);
    const groups =
      splitByColumn || shouldForceSplitHeadingPrefixedRow(sorted, breakIndexes)
        ? splitFragmentsByColumnBreaks(sorted, page.width, breakIndexes)
        : [sorted];

    for (const fragments of groups) {
      const text = normalizeSpacing(fragments.map((f) => f.text).join(" "));
      if (text.length === 0) continue;

      lines.push({
        pageIndex: page.pageIndex,
        pageHeight: page.height,
        pageWidth: page.width,
        estimatedWidth: estimateLineWidth(fragments),
        x: Math.min(...fragments.map((f) => f.x)),
        y: bucket,
        fontSize: Math.max(...fragments.map((f) => f.fontSize)),
        text,
      });
    }
  }

  return { lines, isMultiColumn: splitByColumn };
}

function compareLinesForReadingOrder(
  left: TextLine,
  right: TextLine,
  multiColumnPageIndexes: Set<number>,
): number {
  if (left.pageIndex !== right.pageIndex) return left.pageIndex - right.pageIndex;

  if (multiColumnPageIndexes.has(left.pageIndex)) {
    const columnOrder = compareMultiColumnLineOrder(left, right);
    if (columnOrder !== 0) return columnOrder;
  }

  if (left.y !== right.y) return right.y - left.y;
  return left.x - right.x;
}

function compareMultiColumnLineOrder(left: TextLine, right: TextLine): number {
  if (!isLikelyColumnHeadingLine(left.text) || !isLikelyColumnHeadingLine(right.text)) return 0;
  const leftColumn = classifyMultiColumnLine(left);
  const rightColumn = classifyMultiColumnLine(right);
  if (leftColumn === "spanning" || rightColumn === "spanning") return 0;
  if (leftColumn === rightColumn) return 0;
  return leftColumn === "left" ? -1 : 1;
}

function isLikelyColumnHeadingLine(text: string): boolean {
  const normalized = normalizeSpacing(text);
  const match = MULTI_COLUMN_HEADING_REORDER_PATTERN.exec(normalized);
  if (!match) return false;
  const headingText = match[2].trim();
  if (headingText.length < 2 || headingText.length > MAX_MULTI_COLUMN_HEADING_TEXT_LENGTH) {
    return false;
  }
  if (!/^[A-Z]/.test(headingText)) return false;
  if (!/[A-Za-z]/.test(headingText)) return false;
  if (headingText.includes(",") || headingText.includes(":")) return false;
  if (/[.!?]$/.test(headingText)) return false;
  const words = headingText.split(/\s+/).filter((token) => token.length > 0);
  if (words.length === 0 || words.length > MAX_MULTI_COLUMN_HEADING_WORDS) return false;
  return words.every((token) => /^[A-Za-z][A-Za-z-]*$/.test(token));
}

function classifyMultiColumnLine(line: TextLine): "left" | "right" | "spanning" {
  const pageWidth = Math.max(line.pageWidth, 1);
  if (line.estimatedWidth / pageWidth >= MULTI_COLUMN_SPANNING_LINE_WIDTH_RATIO) return "spanning";
  const lineCenter = line.x + line.estimatedWidth / 2;
  return lineCenter < pageWidth * MULTI_COLUMN_SPLIT_RATIO ? "left" : "right";
}

function bucketFragments(page: ExtractedPage): Map<number, ExtractedFragment[]> {
  const buckets = new Map<number, ExtractedFragment[]>();
  for (const fragment of page.fragments) {
    if (fragment.y > page.height * MAX_REASONABLE_Y_MULTIPLIER) continue;
    const bucket = Math.round(fragment.y / LINE_Y_BUCKET_SIZE) * LINE_Y_BUCKET_SIZE;
    const existing = buckets.get(bucket);
    if (existing) {
      existing.push(fragment);
    } else {
      buckets.set(bucket, [fragment]);
    }
  }
  return buckets;
}

function isLikelyMultiColumnPage(
  buckets: Map<number, ExtractedFragment[]>,
  pageWidth: number,
): boolean {
  let multiFragmentRows = 0;
  let rowsWithColumnBreak = 0;
  for (const fragments of buckets.values()) {
    if (fragments.length < 2) continue;
    multiFragmentRows += 1;
    const sorted = [...fragments].sort((left, right) => left.x - right.x);
    if (findColumnBreakIndexes(sorted, pageWidth).length > 0) rowsWithColumnBreak += 1;
  }
  if (rowsWithColumnBreak < MIN_MULTI_COLUMN_BREAK_ROWS) return false;
  return rowsWithColumnBreak / Math.max(multiFragmentRows, 1) >= MIN_MULTI_COLUMN_BREAK_ROW_RATIO;
}

function splitFragmentsByColumnBreaks(
  fragments: ExtractedFragment[],
  pageWidth: number,
  precomputedBreakIndexes?: number[],
): ExtractedFragment[][] {
  const breakIndexes = precomputedBreakIndexes ?? findColumnBreakIndexes(fragments, pageWidth);
  if (breakIndexes.length === 0) return [fragments];
  const groups: ExtractedFragment[][] = [];
  let start = 0;
  for (const breakIndex of breakIndexes) {
    groups.push(fragments.slice(start, breakIndex + 1));
    start = breakIndex + 1;
  }
  groups.push(fragments.slice(start));
  return groups.filter((g) => g.length > 0);
}

function shouldForceSplitHeadingPrefixedRow(
  fragments: ExtractedFragment[],
  breakIndexes: number[],
): boolean {
  if (breakIndexes.length === 0) return false;
  const firstColumnFragments = fragments.slice(0, breakIndexes[0] + 1);
  const firstColumnText = normalizeSpacing(firstColumnFragments.map((f) => f.text).join(" "));
  if (firstColumnText.length === 0) return false;
  const tokens = firstColumnText.split(" ").filter((token) => token.length > 0);
  if (tokens.length < 2 || tokens.length > MAX_NUMBERED_SECTION_PREFIX_WORDS) return false;
  if (!NUMBERED_SECTION_MARKER_PATTERN.test(tokens[0])) return false;
  const headingTokens = tokens.slice(1);
  if (!headingTokens.some((token) => /[A-Za-z]/.test(token))) return false;
  return headingTokens.every((token) => /^[A-Za-z][A-Za-z-]*$/.test(token));
}

function findColumnBreakIndexes(fragments: ExtractedFragment[], pageWidth: number): number[] {
  const indexes: number[] = [];
  for (let i = 0; i < fragments.length - 1; i += 1) {
    if (isLikelyColumnBreak(fragments[i], fragments[i + 1], pageWidth)) indexes.push(i);
  }
  return indexes;
}

function isLikelyColumnBreak(
  left: ExtractedFragment,
  right: ExtractedFragment,
  pageWidth: number,
): boolean {
  const minimumGap = Math.max(MIN_COLUMN_BREAK_GAP, pageWidth * MIN_COLUMN_BREAK_GAP_RATIO);
  if (right.x - left.x < minimumGap) return false;
  if (left.x > pageWidth * COLUMN_BREAK_LEFT_MAX_RATIO) return false;
  if (right.x < pageWidth * COLUMN_BREAK_RIGHT_MIN_RATIO) return false;
  return (
    countSubstantiveChars(left.text) >= MIN_COLUMN_BREAK_TEXT_CHARACTER_COUNT &&
    countSubstantiveChars(right.text) >= MIN_COLUMN_BREAK_TEXT_CHARACTER_COUNT
  );
}

function countSubstantiveChars(text: string): number {
  return text.replace(/[^\p{L}\p{N}]+/gu, "").length;
}

export function normalizeSpacing(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function estimateLineWidth(fragments: ExtractedFragment[]): number {
  const startX = Math.min(...fragments.map((f) => f.x));
  const endX = Math.max(...fragments.map((f) => f.x));
  const spanFromPositions = endX - startX;
  const spanFromText = fragments.reduce(
    (sum, f) => sum + estimateTextWidth(f.text, f.fontSize),
    0,
  );
  return Math.max(spanFromPositions, spanFromText);
}

export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.52;
}

export function computePageVerticalExtents(lines: TextLine[]): Map<number, PageVerticalExtent> {
  const extents = new Map<number, PageVerticalExtent>();
  for (const line of lines) {
    const current = extents.get(line.pageIndex);
    if (!current) {
      extents.set(line.pageIndex, { minY: line.y, maxY: line.y });
      continue;
    }
    current.minY = Math.min(current.minY, line.y);
    current.maxY = Math.max(current.maxY, line.y);
  }
  return extents;
}

export function estimateBodyFontSize(lines: TextLine[]): number {
  const frequencies = new Map<number, number>();
  for (const line of lines) {
    const rounded = Math.round(line.fontSize);
    frequencies.set(rounded, (frequencies.get(rounded) ?? 0) + 1);
  }
  const [mostFrequent] = [...frequencies.entries()].sort((left, right) => {
    if (left[1] !== right[1]) return right[1] - left[1];
    return left[0] - right[0];
  })[0] ?? [10, 0];
  return mostFrequent;
}

export function isNearPageEdge(
  line: TextLine,
  pageExtents: Map<number, PageVerticalExtent>,
  edgeMargin: number = PAGE_EDGE_MARGIN,
): boolean {
  const relativeY = getRelativeVerticalPosition(line, pageExtents);
  return relativeY <= edgeMargin || relativeY >= 1 - edgeMargin;
}

export function isNearPhysicalPageEdge(
  line: TextLine,
  edgeMargin: number = PAGE_EDGE_MARGIN,
): boolean {
  if (line.pageHeight <= 0) return false;
  const bottom = line.pageHeight * edgeMargin;
  if (line.y >= 0 && line.y <= bottom) return true;
  const top = line.pageHeight * (1 - edgeMargin);
  return line.y <= line.pageHeight && line.y >= top;
}

export function getRelativeVerticalPosition(
  line: TextLine,
  pageExtents: Map<number, PageVerticalExtent>,
): number {
  const extent = pageExtents.get(line.pageIndex);
  if (!extent) return 0.5;
  const span = extent.maxY - extent.minY;
  if (span <= 0) return 0.5;
  return (line.y - extent.minY) / span;
}

export function isStandalonePageNumber(
  line: TextLine,
  pageExtents: Map<number, PageVerticalExtent>,
): boolean {
  if (!STANDALONE_PAGE_NUMBER_PATTERN.test(line.text)) return false;
  return isNearPageEdge(line, pageExtents);
}
