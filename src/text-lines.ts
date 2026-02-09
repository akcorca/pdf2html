// biome-ignore lint/nursery/noExcessiveLinesPerFile: text-layout heuristics are kept together intentionally.
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
const MULTI_COLUMN_NEAR_ROW_MAX_Y_DELTA_FONT_RATIO = 2.1;
const MULTI_COLUMN_NEAR_ROW_MIN_TEXT_CHARS = 10;
const MULTI_COLUMN_NEAR_ROW_TOP_Y_RATIO = 0.8;
const MULTI_COLUMN_NEAR_ROW_BOTTOM_Y_RATIO = 0.1;
const MULTI_COLUMN_NEAR_ROW_LEFT_MAX_RATIO = 0.42;
const MULTI_COLUMN_NEAR_ROW_RIGHT_MIN_RATIO = 0.58;
const MISORDERED_TOP_LEVEL_HEADING_LOOKAHEAD = 18;
const MISORDERED_NUMBERED_HEADING_LOOKAHEAD = 18;
const MISORDERED_TOP_LEVEL_HEADING_MAX_Y_DELTA_FONT_RATIO = 3.2;
const MISORDERED_NUMBERED_HEADING_MAX_Y_DELTA_FONT_RATIO = 12;
const MAX_REORDER_HEADING_DIGIT_RATIO = 0.34;
const MIN_MIDPOINT_RECOVERY_GAP_RATIO = 0.06;

export function collectTextLines(document: ExtractedDocument): TextLine[] {
  const lines: TextLine[] = [];
  const multiColumnPageIndexes = new Set<number>();
  for (const page of document.pages) {
    const collectedPage = collectPageLines(page);
    lines.push(...collectedPage.lines);
    if (collectedPage.isMultiColumn) multiColumnPageIndexes.add(page.pageIndex);
  }
  const sorted = lines.sort((left, right) =>
    compareLinesForReadingOrder(left, right, multiColumnPageIndexes),
  );
  const reorderedTopLevel = reorderMisorderedTopLevelHeadings(sorted, multiColumnPageIndexes);
  return reorderMisorderedNumberedHeadings(reorderedTopLevel, multiColumnPageIndexes);
}

function collectPageLines(page: ExtractedPage): { lines: TextLine[]; isMultiColumn: boolean } {
  const buckets = bucketFragments(page);
  const splitByColumn = isLikelyMultiColumnPage(buckets, page.width);
  const lines: TextLine[] = [];

  for (const [bucket, bucketFragments] of buckets) {
    const sorted = [...bucketFragments].sort((left, right) => left.x - right.x);
    const breakIndexes = findColumnBreakIndexes(sorted, page.width);
    const shouldSplitByColumns =
      splitByColumn || shouldForceSplitHeadingPrefixedRow(sorted, breakIndexes);
    const groups = shouldSplitByColumns
      ? splitFragmentsByColumnBreaks(sorted, page.width, breakIndexes, {
          allowMidpointFallback: splitByColumn,
        })
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
  if (isLikelyColumnHeadingLine(left.text) && isLikelyColumnHeadingLine(right.text)) {
    const leftColumn = classifyMultiColumnLine(left);
    const rightColumn = classifyMultiColumnLine(right);
    if (leftColumn === "spanning" || rightColumn === "spanning") return 0;
    if (leftColumn === rightColumn) return 0;
    return leftColumn === "left" ? -1 : 1;
  }

  if (!isLikelyNearRowBodyPair(left, right)) return 0;
  const leftColumn = classifyNearRowBodyColumn(left);
  const rightColumn = classifyNearRowBodyColumn(right);
  if (leftColumn === "spanning" || rightColumn === "spanning") return 0;
  if (leftColumn === rightColumn) return 0;
  return leftColumn === "left" ? -1 : 1;
}

function reorderMisorderedTopLevelHeadings(
  lines: TextLine[],
  multiColumnPageIndexes: Set<number>,
): TextLine[] {
  const reordered = [...lines];
  for (let index = 0; index < reordered.length; index += 1) {
    const promotionIndex = findTopLevelHeadingPromotionIndex(
      reordered,
      index,
      multiColumnPageIndexes,
    );
    if (promotionIndex === undefined) continue;
    promoteLine(reordered, promotionIndex, index);
    index += 1;
  }
  return reordered;
}

function reorderMisorderedNumberedHeadings(
  lines: TextLine[],
  multiColumnPageIndexes: Set<number>,
): TextLine[] {
  const reordered = [...lines];
  for (let index = 0; index < reordered.length; index += 1) {
    const promotionIndex = findNumberedHeadingPromotionIndex(
      reordered,
      index,
      multiColumnPageIndexes,
    );
    if (promotionIndex === undefined) continue;
    promoteLine(reordered, promotionIndex, index);
  }
  return reordered;
}

function findTopLevelHeadingPromotionIndex(
  lines: TextLine[],
  currentIndex: number,
  multiColumnPageIndexes: Set<number>,
): number | undefined {
  const current = lines[currentIndex];
  if (!isRightColumnHeadingCandidate(current, multiColumnPageIndexes)) return undefined;
  const currentHeadingNumber = getTopLevelHeadingNumber(current.text);
  if (currentHeadingNumber === undefined) return undefined;

  return findPromotionIndexWithinLookahead(
    lines,
    currentIndex,
    MISORDERED_TOP_LEVEL_HEADING_LOOKAHEAD,
    (candidate) => {
      const candidateHeadingNumber = getTopLevelHeadingNumber(candidate.text);
      if (candidateHeadingNumber === undefined) return false;
      if (candidateHeadingNumber + 1 !== currentHeadingNumber) return false;
      if (classifyMultiColumnLine(candidate) !== "left") return false;
      return isWithinVerticalHeadingRange(
        current,
        candidate,
        MISORDERED_TOP_LEVEL_HEADING_MAX_Y_DELTA_FONT_RATIO,
      );
    },
  );
}

function findNumberedHeadingPromotionIndex(
  lines: TextLine[],
  currentIndex: number,
  multiColumnPageIndexes: Set<number>,
): number | undefined {
  const current = lines[currentIndex];
  if (!isRightColumnHeadingCandidate(current, multiColumnPageIndexes)) return undefined;
  const currentPath = parseNumberedHeadingPathForReorder(current.text);
  if (!currentPath) return undefined;

  return findPromotionIndexWithinLookahead(
    lines,
    currentIndex,
    MISORDERED_NUMBERED_HEADING_LOOKAHEAD,
    (candidate) => {
      if (classifyMultiColumnLine(candidate) !== "left") return false;
      const candidatePath = parseNumberedHeadingPathForReorder(candidate.text);
      if (!candidatePath) return false;
      if (!shouldPromoteNumberedHeadingCandidate(candidatePath, currentPath)) return false;
      return isWithinVerticalHeadingRange(
        current,
        candidate,
        MISORDERED_NUMBERED_HEADING_MAX_Y_DELTA_FONT_RATIO,
      );
    },
  );
}

function findPromotionIndexWithinLookahead(
  lines: TextLine[],
  currentIndex: number,
  lookahead: number,
  shouldPromote: (candidate: TextLine) => boolean,
): number | undefined {
  const current = lines[currentIndex];
  const scanEnd = Math.min(lines.length, currentIndex + lookahead);
  for (let scanIndex = currentIndex + 1; scanIndex < scanEnd; scanIndex += 1) {
    const candidate = lines[scanIndex];
    if (candidate.pageIndex !== current.pageIndex) break;
    if (!shouldPromote(candidate)) continue;
    return scanIndex;
  }
  return undefined;
}

function isRightColumnHeadingCandidate(
  line: TextLine,
  multiColumnPageIndexes: Set<number>,
): boolean {
  return multiColumnPageIndexes.has(line.pageIndex) && classifyMultiColumnLine(line) === "right";
}

function isWithinVerticalHeadingRange(
  current: TextLine,
  candidate: TextLine,
  maxFontRatio: number,
): boolean {
  const maxYDelta = Math.max(current.fontSize, candidate.fontSize) * maxFontRatio;
  return Math.abs(current.y - candidate.y) <= maxYDelta;
}

function promoteLine(lines: TextLine[], fromIndex: number, toIndex: number): void {
  const promoted = lines[fromIndex];
  if (!promoted) return;
  lines.splice(fromIndex, 1);
  lines.splice(toIndex, 0, promoted);
}

function parseNumberedHeadingPathForReorder(text: string): number[] | undefined {
  const normalized = normalizeSpacing(text);
  const match = MULTI_COLUMN_HEADING_REORDER_PATTERN.exec(normalized);
  if (!match) return undefined;

  const headingText = match[2]?.trim() ?? "";
  if (!isLikelyNumberedHeadingTextForReorder(headingText)) return undefined;

  const pathTokens = match[1].replace(/\.$/, "").split(".");
  const path: number[] = [];
  for (const token of pathTokens) {
    const value = Number.parseInt(token, 10);
    if (!Number.isFinite(value) || value < 0) return undefined;
    path.push(value);
  }
  return path.length > 0 ? path : undefined;
}

function isLikelyNumberedHeadingTextForReorder(text: string): boolean {
  if (text.length < 2 || text.length > MAX_MULTI_COLUMN_HEADING_TEXT_LENGTH) return false;
  if (!/^[A-Z]/.test(text)) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (/[.!?]$/.test(text)) return false;
  const words = text.split(/\s+/).filter((token) => token.length > 0);
  if (words.length === 0 || words.length > MAX_MULTI_COLUMN_HEADING_WORDS) return false;
  const alphanumericLength = text.replace(/[^A-Za-z0-9]/g, "").length;
  const digitLength = text.replace(/[^0-9]/g, "").length;
  const digitRatio = digitLength / Math.max(alphanumericLength, 1);
  return digitRatio <= MAX_REORDER_HEADING_DIGIT_RATIO;
}

function shouldPromoteNumberedHeadingCandidate(
  candidatePath: number[],
  currentPath: number[],
): boolean {
  if (candidatePath[0] !== currentPath[0]) return false;
  if (isNumberPathPrefix(candidatePath, currentPath)) return true;
  if (candidatePath.length !== currentPath.length) return false;
  if (!isNumberPathPrefix(candidatePath.slice(0, -1), currentPath.slice(0, -1))) return false;
  const candidateLast = candidatePath[candidatePath.length - 1] ?? -1;
  const currentLast = currentPath[currentPath.length - 1] ?? -1;
  return candidateLast + 1 === currentLast;
}

function isNumberPathPrefix(prefix: number[], target: number[]): boolean {
  if (prefix.length === 0 || prefix.length > target.length) return false;
  return prefix.every((part, index) => part === target[index]);
}

function getTopLevelHeadingNumber(text: string): number | undefined {
  if (!isLikelyColumnHeadingLine(text)) return undefined;
  const normalized = normalizeSpacing(text);
  const match = /^(\d+)\.?\s+/.exec(normalized);
  if (!match) return undefined;
  if (/^\d+\.\d/.test(normalized)) return undefined;
  return Number.parseInt(match[1] ?? "", 10);
}

function isLikelyNearRowBodyPair(left: TextLine, right: TextLine): boolean {
  if (!isLikelyNearRowBodyLine(left) || !isLikelyNearRowBodyLine(right)) return false;
  const maxYDelta =
    Math.max(left.fontSize, right.fontSize) * MULTI_COLUMN_NEAR_ROW_MAX_Y_DELTA_FONT_RATIO;
  return Math.abs(left.y - right.y) <= maxYDelta;
}

function isLikelyNearRowBodyLine(line: TextLine): boolean {
  if (line.pageHeight <= 0) return false;
  const normalized = normalizeSpacing(line.text);
  if (countSubstantiveChars(normalized) < MULTI_COLUMN_NEAR_ROW_MIN_TEXT_CHARS) return false;
  if (/(?:https?:\/\/|www\.)/iu.test(normalized)) return false;
  const relativeY = line.y / line.pageHeight;
  if (relativeY >= MULTI_COLUMN_NEAR_ROW_TOP_Y_RATIO) return false;
  if (relativeY <= MULTI_COLUMN_NEAR_ROW_BOTTOM_Y_RATIO) return false;
  return true;
}

function classifyNearRowBodyColumn(line: TextLine): "left" | "right" | "spanning" {
  const pageWidth = Math.max(line.pageWidth, 1);
  const relativeX = line.x / pageWidth;
  if (relativeX <= MULTI_COLUMN_NEAR_ROW_LEFT_MAX_RATIO) return "left";
  if (relativeX >= MULTI_COLUMN_NEAR_ROW_RIGHT_MIN_RATIO) return "right";
  return "spanning";
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
  options?: { allowMidpointFallback?: boolean },
): ExtractedFragment[][] {
  const breakIndexes = precomputedBreakIndexes ?? findColumnBreakIndexes(fragments, pageWidth);
  const midpointSplit = options?.allowMidpointFallback
    ? splitFragmentsByMidpoint(fragments, pageWidth)
    : undefined;
  if (breakIndexes.length === 0) {
    if (midpointSplit) return midpointSplit;
    return [fragments];
  }
  const groups: ExtractedFragment[][] = [];
  let start = 0;
  for (const breakIndex of breakIndexes) {
    groups.push(fragments.slice(start, breakIndex + 1));
    start = breakIndex + 1;
  }
  groups.push(fragments.slice(start));
  const filteredGroups = groups.filter((g) => g.length > 0);
  if (
    midpointSplit &&
    shouldPreferMidpointSplit(fragments, filteredGroups, midpointSplit, pageWidth)
  ) {
    return midpointSplit;
  }
  return filteredGroups;
}

function splitFragmentsByMidpoint(
  fragments: ExtractedFragment[],
  pageWidth: number,
): ExtractedFragment[][] | undefined {
  const splitX = pageWidth * MULTI_COLUMN_SPLIT_RATIO;
  const leftColumn: ExtractedFragment[] = [];
  const rightColumn: ExtractedFragment[] = [];

  for (const fragment of fragments) {
    const estimatedCenter = fragment.x + estimateTextWidth(fragment.text, fragment.fontSize) / 2;
    if (estimatedCenter < splitX) {
      leftColumn.push(fragment);
    } else {
      rightColumn.push(fragment);
    }
  }

  if (leftColumn.length === 0 || rightColumn.length === 0) return undefined;
  const leftSubstantiveChars = leftColumn.reduce(
    (sum, fragment) => sum + countSubstantiveChars(fragment.text),
    0,
  );
  const rightSubstantiveChars = rightColumn.reduce(
    (sum, fragment) => sum + countSubstantiveChars(fragment.text),
    0,
  );
  if (
    leftSubstantiveChars < MIN_COLUMN_BREAK_TEXT_CHARACTER_COUNT ||
    rightSubstantiveChars < MIN_COLUMN_BREAK_TEXT_CHARACTER_COUNT
  ) {
    return undefined;
  }

  return [leftColumn, rightColumn];
}

type FragmentGroupSide = "left" | "right" | "mixed";

interface FragmentGroupSideSummary {
  hasLeft: boolean;
  hasRight: boolean;
  hasMixed: boolean;
}

function shouldPreferMidpointSplit(
  fragments: ExtractedFragment[],
  breakSplit: ExtractedFragment[][],
  midpointSplit: ExtractedFragment[][],
  pageWidth: number,
): boolean {
  if (midpointSplit.length !== 2) return false;
  const breakSummary = summarizeFragmentGroupSides(breakSplit, pageWidth);
  if (!breakSummary.hasMixed) return false;
  if (breakSummary.hasLeft && breakSummary.hasRight) return false;

  const midpointSummary = summarizeFragmentGroupSides(midpointSplit, pageWidth);
  if (midpointSummary.hasMixed) return false;
  if (!midpointSummary.hasLeft || !midpointSummary.hasRight) return false;

  const midpointGap = estimateMidpointSideStartGap(fragments, pageWidth);
  const minimumGap = Math.max(pageWidth * MIN_MIDPOINT_RECOVERY_GAP_RATIO, MIN_COLUMN_BREAK_GAP * 0.3);
  return midpointGap >= minimumGap;
}

function summarizeFragmentGroupSides(
  groups: ExtractedFragment[][],
  pageWidth: number,
): FragmentGroupSideSummary {
  const summary: FragmentGroupSideSummary = {
    hasLeft: false,
    hasRight: false,
    hasMixed: false,
  };
  for (const group of groups) {
    const side = classifyFragmentGroupSide(group, pageWidth);
    if (side === "left") summary.hasLeft = true;
    if (side === "right") summary.hasRight = true;
    if (side === "mixed") summary.hasMixed = true;
  }
  return summary;
}

function classifyFragmentGroupSide(group: ExtractedFragment[], pageWidth: number): FragmentGroupSide {
  const splitX = pageWidth * MULTI_COLUMN_SPLIT_RATIO;
  let hasLeft = false;
  let hasRight = false;
  for (const fragment of group) {
    const center = fragment.x + estimateTextWidth(fragment.text, fragment.fontSize) / 2;
    if (center < splitX) {
      hasLeft = true;
    } else {
      hasRight = true;
    }
    if (hasLeft && hasRight) return "mixed";
  }
  return hasLeft ? "left" : "right";
}

function estimateMidpointSideStartGap(fragments: ExtractedFragment[], pageWidth: number): number {
  const splitX = pageWidth * MULTI_COLUMN_SPLIT_RATIO;
  let leftMaxX = Number.NEGATIVE_INFINITY;
  let rightMinX = Number.POSITIVE_INFINITY;
  for (const fragment of fragments) {
    const center = fragment.x + estimateTextWidth(fragment.text, fragment.fontSize) / 2;
    if (center < splitX) {
      leftMaxX = Math.max(leftMaxX, fragment.x);
    } else {
      rightMinX = Math.min(rightMinX, fragment.x);
    }
  }
  if (!Number.isFinite(leftMaxX) || !Number.isFinite(rightMinX)) return 0;
  return rightMinX - leftMaxX;
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
