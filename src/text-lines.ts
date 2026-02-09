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
const DOTTED_SUBSECTION_HEADING_MARKER_PATTERN = /^\d+(?:\.\d+){1,4}\.\s+/u;
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
const MISORDERED_NUMBERED_HEADING_FALLBACK_LOOKAHEAD = 96;
const MISORDERED_TOP_LEVEL_HEADING_MAX_Y_DELTA_FONT_RATIO = 3.2;
const MISORDERED_NUMBERED_HEADING_MAX_Y_DELTA_FONT_RATIO = 12;
const MISORDERED_NUMBERED_HEADING_FALLBACK_MAX_Y_DELTA_FONT_RATIO = 48;
const MAX_REORDER_HEADING_DIGIT_RATIO = 0.34;
const MIN_MIDPOINT_RECOVERY_GAP_RATIO = 0.05;
const MIN_COLUMN_MAJOR_BODY_LINES_PER_SIDE = 10;
const MIN_COLUMN_MAJOR_VERTICAL_SPAN_RATIO = 0.2;
const ADJACENT_RIGHT_BODY_HEADING_LOOKBACK = 6;
const ADJACENT_RIGHT_BODY_HEADING_MAX_Y_DELTA_FONT_RATIO = 2.8;
const LEFT_HEADING_BODY_CONTINUATION_LOOKAHEAD = 16;
const LEFT_HEADING_BODY_CONTINUATION_MAX_Y_DELTA_FONT_RATIO = 3.6;
const LEFT_HEADING_RIGHT_BODY_START_PATTERN = /^[a-z]/u;
const LEFT_HEADING_RIGHT_BODY_END_PUNCTUATION_PATTERN = /[.!?]["')\]]?$/;
const RIGHT_HEADING_LEFT_BODY_CONTINUATION_LOOKAHEAD = 8;
const RIGHT_HEADING_LEFT_BODY_CONTINUATION_MAX_Y_DELTA_FONT_RATIO = 2.8;
const RIGHT_HEADING_LEFT_BODY_MAX_LEFT_OFFSET_RATIO = 0.06;
const RIGHT_HEADING_LEFT_BODY_CONTINUATION_START_PATTERN = /^[a-z0-9(“‘"']/u;
const RIGHT_HEADING_LEFT_BODY_END_PUNCTUATION_PATTERN = /[.!?]["')\]]?$/;

export function collectTextLines(document: ExtractedDocument): TextLine[] {
  const lines: TextLine[] = [];
  const multiColumnPageIndexes = new Set<number>();
  const columnMajorPageIndexes = new Set<number>();
  for (const page of document.pages) {
    const collectedPage = collectPageLines(page);
    lines.push(...collectedPage.lines);
    if (collectedPage.isMultiColumn) {
      multiColumnPageIndexes.add(page.pageIndex);
      if (shouldPreferColumnMajorOrdering(collectedPage.lines)) {
        columnMajorPageIndexes.add(page.pageIndex);
      }
    }
  }
  const sorted = lines.sort((left, right) =>
    compareLinesForReadingOrder(left, right, multiColumnPageIndexes, columnMajorPageIndexes),
  );
  return applyReadingOrderReorders(sorted, multiColumnPageIndexes);
}

function applyReadingOrderReorders(
  lines: TextLine[],
  multiColumnPageIndexes: Set<number>,
): TextLine[] {
  const reorderSteps: Array<(currentLines: TextLine[]) => TextLine[]> = [
    reorderMisorderedTopLevelHeadings,
    (currentLines) => reorderLeftColumnTopLevelHeadings(currentLines, multiColumnPageIndexes),
    (currentLines) => reorderMisorderedNumberedHeadings(currentLines, multiColumnPageIndexes),
    reorderRightColumnHeadingsAfterLeftBodyContinuations,
    (currentLines) =>
      reorderAdjacentSequentialHeadingPairsWithLeftBodyContinuations(
        currentLines,
        multiColumnPageIndexes,
      ),
    (currentLines) =>
      reorderLeftHeadingBodyContinuationBeforeRightColumnBody(
        currentLines,
        multiColumnPageIndexes,
      ),
  ];
  return reorderSteps.reduce((currentLines, reorder) => reorder(currentLines), lines);
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
  columnMajorPageIndexes: Set<number>,
): number {
  if (left.pageIndex !== right.pageIndex) return left.pageIndex - right.pageIndex;

  if (multiColumnPageIndexes.has(left.pageIndex)) {
    const columnOrder = compareMultiColumnLineOrder(
      left,
      right,
      columnMajorPageIndexes.has(left.pageIndex),
    );
    if (columnOrder !== 0) return columnOrder;
  }

  if (left.y !== right.y) return right.y - left.y;
  return left.x - right.x;
}

function compareMultiColumnLineOrder(
  left: TextLine,
  right: TextLine,
  preferColumnMajor: boolean,
): number {
  if (isLikelyColumnHeadingLine(left.text) && isLikelyColumnHeadingLine(right.text)) {
    return compareByMultiColumnSide(classifyMultiColumnLine(left), classifyMultiColumnLine(right));
  }

  if (preferColumnMajor) {
    const columnMajorOrder = compareColumnMajorBodyLineOrder(left, right);
    if (columnMajorOrder !== 0) return columnMajorOrder;
  }

  if (!isLikelyNearRowBodyPair(left, right)) return 0;
  return compareByNearRowBodyColumn(left, right);
}

function compareColumnMajorBodyLineOrder(left: TextLine, right: TextLine): number {
  if (!isLikelyColumnMajorBodyLine(left) || !isLikelyColumnMajorBodyLine(right)) return 0;
  return compareByNearRowBodyColumn(left, right);
}

function compareByMultiColumnSide(
  leftColumn: "left" | "right" | "spanning",
  rightColumn: "left" | "right" | "spanning",
): number {
  if (leftColumn === "spanning" || rightColumn === "spanning") return 0;
  if (leftColumn === rightColumn) return 0;
  return leftColumn === "left" ? -1 : 1;
}

function compareByNearRowBodyColumn(left: TextLine, right: TextLine): number {
  return compareByMultiColumnSide(classifyNearRowBodyColumn(left), classifyNearRowBodyColumn(right));
}

function isLikelyColumnMajorBodyLine(line: TextLine): boolean {
  if (!isLikelyNearRowBodyLine(line)) return false;
  return !isLikelyColumnHeadingLine(line.text);
}

function shouldPreferColumnMajorOrdering(lines: TextLine[]): boolean {
  const bodyLines = lines.filter((line) => isLikelyColumnMajorBodyLine(line));
  const leftLines = bodyLines.filter((line) => classifyNearRowBodyColumn(line) === "left");
  const rightLines = bodyLines.filter((line) => classifyNearRowBodyColumn(line) === "right");
  if (leftLines.length < MIN_COLUMN_MAJOR_BODY_LINES_PER_SIDE) return false;
  if (rightLines.length < MIN_COLUMN_MAJOR_BODY_LINES_PER_SIDE) return false;
  if (estimatePageVerticalSpanRatio(leftLines) < MIN_COLUMN_MAJOR_VERTICAL_SPAN_RATIO) return false;
  if (estimatePageVerticalSpanRatio(rightLines) < MIN_COLUMN_MAJOR_VERTICAL_SPAN_RATIO) return false;
  return true;
}

function estimatePageVerticalSpanRatio(lines: TextLine[]): number {
  if (lines.length === 0) return 0;
  const minY = Math.min(...lines.map((line) => line.y));
  const maxY = Math.max(...lines.map((line) => line.y));
  const pageHeight = Math.max(lines[0]?.pageHeight ?? 1, 1);
  return (maxY - minY) / pageHeight;
}

function reorderMisorderedTopLevelHeadings(
  lines: TextLine[],
): TextLine[] {
  return reorderLinesByPromotion(lines, {
    startIndex: 0,
    moveDirection: "forward",
    skipNextAfterPromotion: true,
    findPromotionIndex: (reordered, index) => findTopLevelHeadingPromotionIndex(reordered, index),
  });
}

function reorderMisorderedNumberedHeadings(
  lines: TextLine[],
  multiColumnPageIndexes: Set<number>,
): TextLine[] {
  return reorderLinesByPromotion(lines, {
    startIndex: 0,
    moveDirection: "forward",
    findPromotionIndex: (reordered, index) =>
      findNumberedHeadingPromotionIndex(reordered, index, multiColumnPageIndexes),
  });
}

function reorderLeftColumnTopLevelHeadings(
  lines: TextLine[],
  multiColumnPageIndexes: Set<number>,
): TextLine[] {
  return reorderLinesByPromotion(lines, {
    startIndex: 1,
    moveDirection: "backward",
    findPromotionIndex: (reordered, index) =>
      findLeftColumnTopLevelHeadingPromotionIndex(reordered, index, multiColumnPageIndexes),
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: heading-pair recovery heuristics are evaluated in one pass.
function reorderAdjacentSequentialHeadingPairsWithLeftBodyContinuations(
  lines: TextLine[],
  multiColumnPageIndexes: Set<number>,
): TextLine[] {
  const reordered = [...lines];
  for (let index = 0; index < reordered.length - 2; index += 1) {
    const leftHeading = reordered[index];
    const rightHeading = reordered[index + 1];
    if (!leftHeading || !rightHeading) continue;
    if (leftHeading.pageIndex !== rightHeading.pageIndex) continue;
    if (classifyMultiColumnLine(leftHeading) !== "left") continue;
    if (classifyMultiColumnLine(rightHeading) !== "right") continue;

    const continuationInsertionIndex = findLeftContinuationInsertionIndexForHeadingPair(
      leftHeading,
      rightHeading,
      index,
      multiColumnPageIndexes.has(leftHeading.pageIndex),
    );
    if (continuationInsertionIndex === undefined) continue;

    let continuationStart = index + 2;
    while (continuationStart < reordered.length) {
      const continuationLine = reordered[continuationStart];
      if (continuationLine.pageIndex !== leftHeading.pageIndex) break;
      if (classifyMultiColumnLine(continuationLine) !== "left") break;
      if (!isLikelyNearRowBodyLine(continuationLine)) break;
      if (isLikelyColumnHeadingLine(continuationLine.text)) break;
      if (continuationLine.y <= leftHeading.y) break;
      continuationStart += 1;
    }

    const continuationCount = continuationStart - (index + 2);
    if (continuationCount === 0) continue;

    const continuations = reordered.splice(index + 2, continuationCount);
    reordered.splice(continuationInsertionIndex, 0, ...continuations);
    index += continuationCount;
  }
  return reordered;
}

function reorderLeftHeadingBodyContinuationBeforeRightColumnBody(
  lines: TextLine[],
  multiColumnPageIndexes: Set<number>,
): TextLine[] {
  const reordered = [...lines];
  for (let index = 0; index < reordered.length - 1; index += 1) {
    const heading = reordered[index];
    if (!isLeftColumnHeadingEligibleForBodyContinuation(heading, multiColumnPageIndexes)) {
      continue;
    }

    const rightBodyCandidate = reordered[index + 1];
    if (!isRightColumnBodyCandidateAfterLeftHeading(rightBodyCandidate, heading)) continue;

    const leftContinuationIndex = findLeftBodyContinuationAfterHeading(
      reordered,
      index,
      heading,
    );
    if (leftContinuationIndex === undefined) continue;

    promoteLine(reordered, leftContinuationIndex, index + 1);
    index += 1;
  }
  return reordered;
}

function reorderRightColumnHeadingsAfterLeftBodyContinuations(
  lines: TextLine[],
): TextLine[] {
  const reordered = [...lines];
  for (let index = 1; index < reordered.length - 1; index += 1) {
    const heading = reordered[index];
    if (!isRightColumnHeadingEligibleForLeftContinuationDeferral(heading)) continue;

    const previousLine = reordered[index - 1];
    if (!isLeftBodyLineBeforeDeferredRightHeading(previousLine, heading)) continue;

    const insertionIndex = findDeferredRightHeadingInsertionIndex(
      reordered,
      index,
      previousLine,
      heading,
    );
    if (insertionIndex === undefined) continue;

    promoteLine(reordered, index, insertionIndex - 1);
    index = insertionIndex - 1;
  }
  return reordered;
}

function isRightColumnHeadingEligibleForLeftContinuationDeferral(
  heading: TextLine,
): boolean {
  if (classifyMultiColumnLine(heading) !== "right") return false;
  return isLikelyColumnHeadingLine(heading.text);
}

function isLeftBodyLineBeforeDeferredRightHeading(
  candidate: TextLine | undefined,
  heading: TextLine,
): candidate is TextLine {
  if (!candidate) return false;
  if (candidate.pageIndex !== heading.pageIndex) return false;
  if (classifyMultiColumnLine(candidate) !== "left") return false;
  if (isLikelyColumnHeadingLine(candidate.text)) return false;

  const normalized = normalizeSpacing(candidate.text);
  if (normalized.length === 0) return false;
  if (RIGHT_HEADING_LEFT_BODY_END_PUNCTUATION_PATTERN.test(normalized)) return false;

  const verticalDelta = Math.abs(candidate.y - heading.y);
  const maxVerticalDelta = Math.max(
    Math.max(candidate.fontSize, heading.fontSize) *
      RIGHT_HEADING_LEFT_BODY_CONTINUATION_MAX_Y_DELTA_FONT_RATIO,
    Math.max(candidate.fontSize, heading.fontSize) + 10,
  );
  return verticalDelta <= maxVerticalDelta;
}

function findDeferredRightHeadingInsertionIndex(
  lines: TextLine[],
  headingIndex: number,
  previousLeftLine: TextLine,
  heading: TextLine,
): number | undefined {
  let insertionIndex = headingIndex + 1;
  let currentLeftLine = previousLeftLine;
  let hasContinuation = false;
  const maxScanIndex = Math.min(
    lines.length,
    headingIndex + RIGHT_HEADING_LEFT_BODY_CONTINUATION_LOOKAHEAD + 1,
  );

  while (insertionIndex < maxScanIndex) {
    const candidate = lines[insertionIndex];
    if (!isLeftBodyContinuationAfterDeferredRightHeading(candidate, currentLeftLine, heading)) {
      break;
    }
    hasContinuation = true;
    currentLeftLine = candidate;
    insertionIndex += 1;
    if (
      RIGHT_HEADING_LEFT_BODY_END_PUNCTUATION_PATTERN.test(
        normalizeSpacing(currentLeftLine.text),
      )
    ) {
      break;
    }
  }

  return hasContinuation ? insertionIndex : undefined;
}

function isLeftBodyContinuationAfterDeferredRightHeading(
  candidate: TextLine | undefined,
  previousLeftLine: TextLine,
  heading: TextLine,
): candidate is TextLine {
  if (!candidate) return false;
  if (candidate.pageIndex !== heading.pageIndex) return false;
  if (classifyMultiColumnLine(candidate) !== "left") return false;
  if (isLikelyColumnHeadingLine(candidate.text)) return false;

  const normalized = normalizeSpacing(candidate.text);
  if (!RIGHT_HEADING_LEFT_BODY_CONTINUATION_START_PATTERN.test(normalized)) return false;

  const verticalDelta = previousLeftLine.y - candidate.y;
  const maxVerticalDelta = Math.max(
    Math.max(previousLeftLine.fontSize, candidate.fontSize) *
      RIGHT_HEADING_LEFT_BODY_CONTINUATION_MAX_Y_DELTA_FONT_RATIO,
    Math.max(previousLeftLine.fontSize, candidate.fontSize) + 10,
  );
  if (verticalDelta <= 0 || verticalDelta > maxVerticalDelta) return false;

  return (
    Math.abs(candidate.x - previousLeftLine.x) <=
    candidate.pageWidth * RIGHT_HEADING_LEFT_BODY_MAX_LEFT_OFFSET_RATIO
  );
}

function isLeftColumnHeadingEligibleForBodyContinuation(
  heading: TextLine,
  multiColumnPageIndexes: Set<number>,
): boolean {
  if (!multiColumnPageIndexes.has(heading.pageIndex)) return false;
  if (!isLikelyColumnHeadingLine(heading.text)) return false;
  if (classifyMultiColumnLine(heading) !== "left") return false;
  return /[a-z]/u.test(normalizeSpacing(heading.text));
}

function isRightColumnBodyCandidateAfterLeftHeading(
  candidate: TextLine | undefined,
  heading: TextLine,
): boolean {
  if (!candidate) return false;
  if (candidate.pageIndex !== heading.pageIndex) return false;
  if (classifyMultiColumnLine(candidate) !== "right") return false;
  if (!isLikelyNearRowBodyLine(candidate)) return false;
  if (isLikelyColumnHeadingLine(candidate.text)) return false;
  const candidateText = normalizeSpacing(candidate.text);
  if (!LEFT_HEADING_RIGHT_BODY_START_PATTERN.test(candidateText)) return false;
  return !LEFT_HEADING_RIGHT_BODY_END_PUNCTUATION_PATTERN.test(candidateText);
}

function findLeftBodyContinuationAfterHeading(
  lines: TextLine[],
  headingIndex: number,
  heading: TextLine,
): number | undefined {
  const maxScanIndex = Math.min(lines.length, headingIndex + LEFT_HEADING_BODY_CONTINUATION_LOOKAHEAD + 1);
  for (let scanIndex = headingIndex + 2; scanIndex < maxScanIndex; scanIndex += 1) {
    const candidate = lines[scanIndex];
    if (candidate.pageIndex !== heading.pageIndex) break;
    if (classifyMultiColumnLine(candidate) !== "left") continue;
    if (!isLikelyNearRowBodyLine(candidate)) continue;
    if (isLikelyColumnHeadingLine(candidate.text)) break;
    if (!/^[A-Z]/u.test(normalizeSpacing(candidate.text))) continue;

    const verticalDelta = heading.y - candidate.y;
    const maxVerticalDelta = Math.max(
      heading.fontSize * LEFT_HEADING_BODY_CONTINUATION_MAX_Y_DELTA_FONT_RATIO,
      heading.fontSize + 16,
    );
    if (verticalDelta <= 0 || verticalDelta > maxVerticalDelta) continue;
    return scanIndex;
  }
  return undefined;
}

function findLeftContinuationInsertionIndexForHeadingPair(
  leftHeading: TextLine,
  rightHeading: TextLine,
  leftHeadingIndex: number,
  allowTopLevelHeadingRecovery: boolean,
): number | undefined {
  const leftPath = parseNumberedHeadingPathForReorder(leftHeading.text);
  const rightPath = parseNumberedHeadingPathForReorder(rightHeading.text);
  if (
    leftPath !== undefined &&
    rightPath !== undefined &&
    hasDottedSubsectionHeadingMarker(leftHeading.text) &&
    hasDottedSubsectionHeadingMarker(rightHeading.text) &&
    isSequentialSiblingSubsectionPair(leftPath, rightPath)
  ) {
    return leftHeadingIndex + 1;
  }

  if (!allowTopLevelHeadingRecovery) return undefined;

  const leftTopLevel = getTopLevelHeadingNumber(leftHeading.text);
  const rightTopLevel = getTopLevelHeadingNumber(rightHeading.text);
  if (leftTopLevel === undefined || rightTopLevel === undefined) return undefined;
  if (leftTopLevel + 1 !== rightTopLevel) return undefined;
  return leftHeadingIndex;
}

function isSequentialSiblingSubsectionPair(leftPath: number[], rightPath: number[]): boolean {
  if (leftPath.length < 2 || rightPath.length < 2) return false;
  if (leftPath.length !== rightPath.length) return false;
  if (!isNumberPathPrefix(leftPath.slice(0, -1), rightPath.slice(0, -1))) return false;
  const leftLast = leftPath[leftPath.length - 1] ?? -1;
  const rightLast = rightPath[rightPath.length - 1] ?? -1;
  return leftLast + 1 === rightLast;
}

function hasDottedSubsectionHeadingMarker(text: string): boolean {
  return DOTTED_SUBSECTION_HEADING_MARKER_PATTERN.test(normalizeSpacing(text));
}

interface ReorderLinesByPromotionInput {
  startIndex: number;
  moveDirection: "forward" | "backward";
  findPromotionIndex: (lines: TextLine[], currentIndex: number) => number | undefined;
  skipNextAfterPromotion?: boolean;
}

function reorderLinesByPromotion(
  lines: TextLine[],
  input: ReorderLinesByPromotionInput,
): TextLine[] {
  const reordered = [...lines];
  for (let index = input.startIndex; index < reordered.length; index += 1) {
    const promotionIndex = input.findPromotionIndex(reordered, index);
    if (promotionIndex === undefined) continue;

    if (input.moveDirection === "forward") {
      promoteLine(reordered, promotionIndex, index);
      if (input.skipNextAfterPromotion) index += 1;
      continue;
    }

    promoteLine(reordered, index, promotionIndex);
  }
  return reordered;
}

function findLeftColumnTopLevelHeadingPromotionIndex(
  lines: TextLine[],
  currentIndex: number,
  multiColumnPageIndexes: Set<number>,
): number | undefined {
  const current = lines[currentIndex];
  if (!multiColumnPageIndexes.has(current.pageIndex)) return undefined;
  if (classifyMultiColumnLine(current) !== "left") return undefined;
  if (getTopLevelHeadingNumber(current.text) === undefined) return undefined;

  const maxYDelta = Math.max(
    current.fontSize * ADJACENT_RIGHT_BODY_HEADING_MAX_Y_DELTA_FONT_RATIO,
    current.fontSize + 12,
  );
  let promotionIndex = currentIndex;
  const scanStart = Math.max(0, currentIndex - ADJACENT_RIGHT_BODY_HEADING_LOOKBACK);
  for (let scanIndex = currentIndex - 1; scanIndex >= scanStart; scanIndex -= 1) {
    const candidate = lines[scanIndex];
    if (candidate.pageIndex !== current.pageIndex) break;
    if (Math.abs(candidate.y - current.y) > maxYDelta) break;
    if (classifyMultiColumnLine(candidate) !== "right") break;
    if (isLikelyColumnHeadingLine(candidate.text)) break;
    promotionIndex = scanIndex;
  }

  return promotionIndex < currentIndex ? promotionIndex : undefined;
}

function findTopLevelHeadingPromotionIndex(
  lines: TextLine[],
  currentIndex: number,
): number | undefined {
  const current = lines[currentIndex];
  if (!isRightColumnHeadingCandidate(current)) return undefined;
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
  if (!isRightColumnHeadingCandidate(current)) return undefined;
  const currentPath = parseNumberedHeadingPathForReorder(current.text);
  if (!currentPath) return undefined;
  const isDetectedMultiColumnPage = multiColumnPageIndexes.has(current.pageIndex);
  const lookahead = isDetectedMultiColumnPage
    ? MISORDERED_NUMBERED_HEADING_LOOKAHEAD
    : MISORDERED_NUMBERED_HEADING_FALLBACK_LOOKAHEAD;
  const maxYDeltaFontRatio = isDetectedMultiColumnPage
    ? MISORDERED_NUMBERED_HEADING_MAX_Y_DELTA_FONT_RATIO
    : MISORDERED_NUMBERED_HEADING_FALLBACK_MAX_Y_DELTA_FONT_RATIO;

  return findPromotionIndexWithinLookahead(
    lines,
    currentIndex,
    lookahead,
    (candidate) => {
      if (classifyMultiColumnLine(candidate) !== "left") return false;
      const candidatePath = parseNumberedHeadingPathForReorder(candidate.text);
      if (!candidatePath) return false;
      if (!shouldPromoteNumberedHeadingCandidate(candidatePath, currentPath)) return false;
      return isWithinVerticalHeadingRange(current, candidate, maxYDeltaFontRatio);
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

function isRightColumnHeadingCandidate(line: TextLine): boolean {
  return classifyMultiColumnLine(line) === "right";
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

interface ParsedMultiColumnHeading {
  marker: string;
  headingText: string;
}

function parseNumberedHeadingPathForReorder(text: string): number[] | undefined {
  const parsed = parseMultiColumnHeading(text);
  if (!parsed) return undefined;
  if (!isLikelyNumberedHeadingTextForReorder(parsed.headingText)) return undefined;
  return parseHeadingMarkerPath(parsed.marker);
}

function isLikelyNumberedHeadingTextForReorder(text: string): boolean {
  if (!hasBasicMultiColumnHeadingTextShape(text)) return false;
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
  const parsed = parseMultiColumnHeading(text);
  if (!parsed) return undefined;
  if (!isLikelyColumnHeadingText(parsed.headingText)) return undefined;
  const path = parseHeadingMarkerPath(parsed.marker);
  if (!path || path.length !== 1) return undefined;
  return path[0];
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
  const parsed = parseMultiColumnHeading(text);
  if (!parsed) return false;
  return isLikelyColumnHeadingText(parsed.headingText);
}

function parseMultiColumnHeading(text: string): ParsedMultiColumnHeading | undefined {
  const normalized = normalizeSpacing(text);
  const match = MULTI_COLUMN_HEADING_REORDER_PATTERN.exec(normalized);
  if (!match) return undefined;
  const marker = match[1] ?? "";
  const headingText = match[2]?.trim() ?? "";
  return { marker, headingText };
}

function parseHeadingMarkerPath(marker: string): number[] | undefined {
  const pathTokens = marker.replace(/\.$/, "").split(".");
  const path: number[] = [];
  for (const token of pathTokens) {
    const value = Number.parseInt(token, 10);
    if (!Number.isFinite(value) || value < 0) return undefined;
    path.push(value);
  }
  return path.length > 0 ? path : undefined;
}

function hasBasicMultiColumnHeadingTextShape(text: string): boolean {
  if (text.length < 2 || text.length > MAX_MULTI_COLUMN_HEADING_TEXT_LENGTH) return false;
  if (!/^[A-Z]/.test(text)) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (/[.!?]$/.test(text)) return false;
  const words = tokenizeHeadingWords(text);
  return words.length > 0 && words.length <= MAX_MULTI_COLUMN_HEADING_WORDS;
}

function isLikelyColumnHeadingText(headingText: string): boolean {
  if (!hasBasicMultiColumnHeadingTextShape(headingText)) return false;
  if (headingText.includes(",") || headingText.includes(":")) return false;
  return tokenizeHeadingWords(headingText).every((token) => /^[A-Za-z][A-Za-z-]*$/.test(token));
}

function tokenizeHeadingWords(text: string): string[] {
  return text.split(/\s+/).filter((token) => token.length > 0);
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
  const minimumGap = Math.max(
    pageWidth * MIN_MIDPOINT_RECOVERY_GAP_RATIO,
    MIN_COLUMN_BREAK_GAP * 0.25,
  );
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

export function groupLinesByPage(lines: TextLine[]): Map<number, TextLine[]> {
  return lines.reduce((grouped, line) => {
    const pageLines = grouped.get(line.pageIndex) ?? [];
    pageLines.push(line);
    grouped.set(line.pageIndex, pageLines);
    return grouped;
  }, new Map<number, TextLine[]>());
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
