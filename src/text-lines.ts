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
const MULTI_COLUMN_NEAR_ROW_TOP_Y_RATIO = 0.88;
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
const MIN_COLUMN_MAJOR_BODY_LINES_PER_SIDE = 5;
const MIN_COLUMN_MAJOR_VERTICAL_SPAN_RATIO = 0.2;
const CROSS_COLUMN_SPANNING_OVERSHOOT_RATIO = 0.25;
const ADJACENT_RIGHT_BODY_HEADING_LOOKBACK = 6;
const ADJACENT_RIGHT_BODY_HEADING_MAX_Y_DELTA_FONT_RATIO = 2.8;
const FIRST_TOP_LEVEL_HEADING_RIGHT_BODY_REORDER_LOOKBACK = 14;
const LEFT_HEADING_BODY_CONTINUATION_LOOKAHEAD = 16;
const LEFT_HEADING_BODY_CONTINUATION_MAX_Y_DELTA_FONT_RATIO = 3.6;
const LEFT_HEADING_RIGHT_BODY_START_PATTERN = /^[a-z]/u;
const LEFT_HEADING_RIGHT_BODY_END_PUNCTUATION_PATTERN = /[.!?]["')\]]?$/;
const RIGHT_HEADING_LEFT_BODY_CONTINUATION_LOOKAHEAD = 8;
const RIGHT_BODY_LEFT_CONTINUATION_LOOKAHEAD = 10;
const LEFT_BODY_CONTINUATION_MAX_Y_DELTA_FONT_RATIO = 2.8;
const LEFT_BODY_CONTINUATION_MAX_LEFT_OFFSET_RATIO = 0.06;
const LEFT_BODY_CONTINUATION_START_PATTERN = /^[a-z0-9(“‘"']/u;
const LEFT_BODY_CONTINUATION_END_PUNCTUATION_PATTERN = /[.!?]["')\]]?$/;
const RIGHT_BODY_MIN_PROSE_WORD_COUNT = 6;
const RIGHT_BODY_MIN_PROSE_CHAR_COUNT = 28;
const RIGHT_BODY_CODE_LIKE_PATTERN = /[#=(){}\[\]<>]|^\d{1,3}\s+\S/u;
const FALLBACK_INTERLEAVED_COLUMN_MIN_BODY_LINES_PER_SIDE = 20;
const FALLBACK_INTERLEAVED_COLUMN_MIN_VERTICAL_SPAN_RATIO = 0.5;
const FALLBACK_INTERLEAVED_COLUMN_MIN_SIDE_SWITCHES = 15;
const MAX_COLUMN_BREAK_BRIDGE_LOOKAHEAD = 2;
const COLUMN_BREAK_BRIDGE_MAX_SUBSTANTIVE_CHARS = 1;
const DUPLICATED_SENTENCE_PREFIX_PATTERN = /^([A-Z][^.!?]{1,80}[.!?])\s+\1(\s+.+)$/u;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-column detection + column assignment in one pass.
export function collectTextLines(document: ExtractedDocument): TextLine[] {
  const lines: TextLine[] = [];
  const multiColumnPageIndexes = new Set<number>();
  const columnMajorPageIndexes = new Set<number>();
  const collectedPages: Array<{
    pageIndex: number;
    lines: TextLine[];
    columnSplitX: number | undefined;
    hasRowBasedSplitX: boolean;
    columnGapMidpoints: number[];
  }> = [];
  for (const page of document.pages) {
    const collectedPage = collectPageLines(page);
    lines.push(...collectedPage.lines);
    if (collectedPage.isMultiColumn) {
      multiColumnPageIndexes.add(page.pageIndex);
      collectedPages.push({
        pageIndex: page.pageIndex,
        lines: collectedPage.lines,
        columnSplitX: collectedPage.columnSplitX,
        hasRowBasedSplitX: collectedPage.hasRowBasedSplitX,
        columnGapMidpoints: collectedPage.columnGapMidpoints,
      });
    }
  }

  // Only use row-based columnSplitX values for the document-wide median
  // to avoid spatial-estimated values from skewing the split position.
  const rowBasedPages = collectedPages.filter((p) => p.hasRowBasedSplitX);
  const documentColumnSplitX = computeDocumentColumnSplitX(
    rowBasedPages.length > 0 ? rowBasedPages : collectedPages,
  );
  const pageColumnSplitXs = new Map<number, number>();
  for (const cp of collectedPages) {
    const effectiveSplitX = documentColumnSplitX ?? cp.columnSplitX;
    if (effectiveSplitX !== undefined) {
      pageColumnSplitXs.set(cp.pageIndex, effectiveSplitX);
    }
    if (shouldPreferColumnMajorOrdering(cp.lines, effectiveSplitX)) {
      columnMajorPageIndexes.add(cp.pageIndex);
    }
  }

  // Lower the effective split X for pages where column breaks detected
  // right-column fragments just below the document-level boundary.
  for (const cp of collectedPages) {
    const splitX = pageColumnSplitXs.get(cp.pageIndex);
    if (splitX === undefined || cp.columnGapMidpoints.length === 0) continue;
    const nearBoundary = cp.columnGapMidpoints.filter((x) => x < splitX && splitX - x <= 0.3);
    if (nearBoundary.length === 0) continue;
    pageColumnSplitXs.set(cp.pageIndex, Math.min(...nearBoundary));
  }

  // Assign column classification to each line on multi-column pages
  for (const line of lines) {
    const splitX = pageColumnSplitXs.get(line.pageIndex);
    if (splitX === undefined) continue;
    const col = classifyColumnByDetectedSplit(line, splitX);
    if (col === "left" || col === "right") {
      line.column = col;
    }
  }

  const sorted = lines.sort((left, right) =>
    compareLinesForReadingOrder(
      left,
      right,
      multiColumnPageIndexes,
      columnMajorPageIndexes,
      pageColumnSplitXs,
    ),
  );
  const reordered = applyReadingOrderReorders(sorted, multiColumnPageIndexes, columnMajorPageIndexes, pageColumnSplitXs);
  return mergeInlineFormattingSplits(reordered, document);
}

function mergeInlineFormattingSplits(orderedLines: TextLine[], doc: ExtractedDocument): TextLine[] {
  const rowsWithInlineGaps = findRowsWithInlineFormattingGaps(doc);
  if (rowsWithInlineGaps.size === 0) return orderedLines;
  const result: TextLine[] = [];
  let i = 0;
  while (i < orderedLines.length) {
    const current = orderedLines[i];
    const key = `${current.pageIndex}:${current.y}`;
    if (rowsWithInlineGaps.has(key) && current.column === "right" && i + 1 < orderedLines.length) {
      const next = orderedLines[i + 1];
      if (next.pageIndex === current.pageIndex && next.y === current.y && next.column === "right" && next.x > current.x) {
        result.push({
          ...current,
          text: `${current.text} ${next.text}`,
          estimatedWidth: Math.max(current.estimatedWidth, next.x + next.estimatedWidth - current.x),
        });
        i += 2;
        continue;
      }
    }
    result.push(current);
    i += 1;
  }
  return result;
}

function findRowsWithInlineFormattingGaps(doc: ExtractedDocument): Set<string> {
  const gaps = new Set<string>();
  for (const page of doc.pages) {
    const buckets = bucketFragments(page);
    for (const [yBucket, fragments] of buckets) {
      if (hasInlineFormattingGapInRow(fragments, page.width)) {
        gaps.add(`${page.pageIndex}:${yBucket}`);
      }
    }
  }
  return gaps;
}

function hasInlineFormattingGapInRow(fragments: ExtractedFragment[], pageWidth: number): boolean {
  const sorted = [...fragments].sort((a, b) => a.x - b.x);
  const breakIndexes = findColumnBreakIndexes(sorted, pageWidth);
  for (const idx of breakIndexes) {
    const left = sorted[idx];
    const right = sorted[idx + 1];
    if (left.width == null) continue;
    const visualGap = right.x - (left.x + left.width);
    const fontSize = Math.max(left.fontSize, right.fontSize);
    if (visualGap >= fontSize * 0.5) continue;
    if (left.x <= pageWidth * COLUMN_BREAK_RIGHT_MIN_RATIO) continue;
    return true;
  }
  return false;
}

function computeDocumentColumnSplitX(
  pages: Array<{ columnSplitX: number | undefined }>,
): number | undefined {
  const splitXs = pages.map((p) => p.columnSplitX).filter((x): x is number => x !== undefined);
  return medianOrUndefined(splitXs);
}

function medianOrUndefined(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function applyReadingOrderReorders(
  lines: TextLine[],
  multiColumnPageIndexes: Set<number>,
  columnMajorPageIndexes: Set<number>,
  pageColumnSplitXs: Map<number, number>,
): TextLine[] {
  const reorderSteps: Array<(currentLines: TextLine[]) => TextLine[]> = [
    reorderMisorderedTopLevelHeadings,
    (currentLines) => reorderLeftColumnTopLevelHeadings(currentLines, multiColumnPageIndexes),
    (currentLines) =>
      reorderMisorderedNumberedHeadings(currentLines, multiColumnPageIndexes, columnMajorPageIndexes),
    (currentLines) =>
      deferRightColumnHeadingsOnColumnMajorPages(currentLines, columnMajorPageIndexes, pageColumnSplitXs),
    reorderDescendingSequentialSiblingNumberedHeadings,
    reorderRightColumnHeadingsAfterLeftBodyContinuations,
    (currentLines) =>
      reorderRightColumnBodyAfterLeftBodyContinuations(currentLines, multiColumnPageIndexes),
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
    (currentLines) =>
      reorderRightColumnBodyBeforeFirstTopLevelHeading(currentLines, multiColumnPageIndexes),
    (currentLines) =>
      reorderBottomOfPageInterleavedLines(currentLines, columnMajorPageIndexes),
  ];
  return reorderSteps.reduce((currentLines, reorderStep) => reorderStep(currentLines), lines);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-column detection + fragment grouping in one pass.
function collectPageLines(
  page: ExtractedPage,
): { lines: TextLine[]; isMultiColumn: boolean; columnSplitX: number | undefined; hasRowBasedSplitX: boolean; columnGapMidpoints: number[] } {
  const buckets = bucketFragments(page);
  const rowBasedMultiColumn = hasRowBasedMultiColumnEvidence(buckets, page.width);
  const spatialMultiColumn = !rowBasedMultiColumn && hasColumnGapFromSpatialDistribution(buckets, page.width);
  const isMultiColumn = rowBasedMultiColumn || spatialMultiColumn;
  // Only use row-based detection for fragment splitting (midpoint fallback).
  // Spatial detection indicates two-column layout for reading order purposes
  // but doesn't provide reliable enough evidence for row-level fragment splitting.
  const splitByColumn = rowBasedMultiColumn;
  const lines: TextLine[] = [];
  const columnGapMidpoints: number[] = [];

  for (const [bucket, bucketFragments] of buckets) {
    const sorted = [...bucketFragments].sort((left, right) => left.x - right.x);
    const { groups, breakIndexes } = splitRowIntoGroups(sorted, page.width, splitByColumn);

    if (splitByColumn) {
      for (const breakIndex of breakIndexes) {
        const rightFragment = sorted[breakIndex + 1];
        if (rightFragment) columnGapMidpoints.push(rightFragment.x);
      }
    }

    for (const fragments of groups) {
      const text = collapseDuplicatedSentencePrefix(
        normalizeSpacing(fragments.map((f) => f.text).join(" ")),
      );
      if (text.length === 0) continue;

      lines.push({
        pageIndex: page.pageIndex,
        pageHeight: page.height,
        pageWidth: page.width,
        estimatedWidth: estimateLineWidth(fragments),
        x: estimateLineStartX(fragments),
        y: bucket,
        fontSize: Math.max(...fragments.map((f) => f.fontSize)),
        text,
      });
    }
  }

  const rowBasedSplitX = medianOrUndefined(columnGapMidpoints);
  let columnSplitX = rowBasedSplitX;
  if (isMultiColumn && columnSplitX === undefined) {
    columnSplitX = estimateColumnSplitXFromLines(lines, page.width);
  }

  return { lines, isMultiColumn, columnSplitX, hasRowBasedSplitX: rowBasedSplitX !== undefined, columnGapMidpoints };
}

/**
 * Estimates the column split X position by finding the gap between
 * left-column right edges and right-column left edges.
 * Used when row-based column break detection doesn't yield gap midpoints
 * but the page was detected as multi-column by spatial distribution.
 */
function estimateColumnSplitXFromLines(lines: TextLine[], pageWidth: number): number | undefined {
  const midX = pageWidth * MULTI_COLUMN_SPLIT_RATIO;
  const leftEdges: number[] = [];
  const rightEdges: number[] = [];
  for (const line of lines) {
    const rightEdge = line.x + line.estimatedWidth;
    const lineCenter = line.x + line.estimatedWidth / 2;
    if (line.estimatedWidth > pageWidth * MULTI_COLUMN_SPANNING_LINE_WIDTH_RATIO) continue;
    if (lineCenter < midX) {
      leftEdges.push(rightEdge);
    } else {
      rightEdges.push(line.x);
    }
  }
  if (leftEdges.length === 0 || rightEdges.length === 0) return undefined;
  leftEdges.sort((a, b) => a - b);
  rightEdges.sort((a, b) => a - b);
  const leftP75 = leftEdges[Math.floor(leftEdges.length * 0.75)];
  const rightP25 = rightEdges[Math.floor(rightEdges.length * 0.25)];
  return (leftP75 + rightP25) / 2;
}

function splitRowIntoGroups(
  sorted: ExtractedFragment[],
  pageWidth: number,
  splitByColumn: boolean,
): { groups: ExtractedFragment[][]; breakIndexes: number[] } {
  const breakIndexes = findColumnBreakIndexes(sorted, pageWidth);
  const bridgedBreakIndexes = findBridgedColumnBreakIndexes(sorted, pageWidth);
  const effectiveBreakIndexes = mergeColumnBreakIndexes(breakIndexes, bridgedBreakIndexes);
  const shouldSplit =
    splitByColumn ||
    shouldForceSplitHeadingPrefixedRow(sorted, effectiveBreakIndexes) ||
    bridgedBreakIndexes.length > 0;
  const groups = shouldSplit
    ? splitFragmentsByColumnBreaks(sorted, pageWidth, effectiveBreakIndexes, {
        allowMidpointFallback: splitByColumn,
      })
    : [sorted];
  return { groups, breakIndexes };
}

function compareLinesForReadingOrder(
  left: TextLine,
  right: TextLine,
  multiColumnPageIndexes: Set<number>,
  columnMajorPageIndexes: Set<number>,
  pageColumnSplitXs: Map<number, number>,
): number {
  if (left.pageIndex !== right.pageIndex) return left.pageIndex - right.pageIndex;

  if (multiColumnPageIndexes.has(left.pageIndex)) {
    const columnOrder = compareMultiColumnLineOrder(
      left,
      right,
      columnMajorPageIndexes.has(left.pageIndex),
      pageColumnSplitXs.get(left.pageIndex),
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
  columnSplitX: number | undefined,
): number {
  if (isLikelyColumnHeadingLine(left.text) && isLikelyColumnHeadingLine(right.text)) {
    return compareByMultiColumnSide(classifyMultiColumnLine(left), classifyMultiColumnLine(right));
  }

  if (preferColumnMajor) {
    const columnMajorOrder = compareColumnMajorLineOrder(left, right, columnSplitX);
    if (columnMajorOrder !== 0) return columnMajorOrder;
  }

  if (!isLikelyNearRowBodyPair(left, right)) return 0;
  return compareByNearRowBodyColumn(left, right);
}

function compareColumnMajorLineOrder(
  left: TextLine,
  right: TextLine,
  columnSplitX: number | undefined,
): number {
  const leftColumn = resolveColumnForColumnMajorOrdering(left, columnSplitX);
  const rightColumn = resolveColumnForColumnMajorOrdering(right, columnSplitX);
  return compareByMultiColumnSide(
    leftColumn,
    rightColumn,
  );
}

function resolveColumnForColumnMajorOrdering(
  line: TextLine,
  columnSplitX: number | undefined,
): "left" | "right" | "spanning" {
  const detected = classifyColumnByDetectedSplit(line, columnSplitX);
  if (detected !== "spanning") return detected;
  return classifyNearRowBodyColumn(line);
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

/** On column-major pages, body text near the page bottom (relativeY <= 0.1)
 *  escapes column-major sorting and falls back to Y-position ordering, which
 *  interleaves left and right column lines. This post-sort step groups such
 *  bottom-of-page runs so that all left-column lines precede right-column lines. */
function reorderBottomOfPageInterleavedLines(
  lines: TextLine[],
  columnMajorPageIndexes: Set<number>,
): TextLine[] {
  const result = [...lines];
  let i = 0;
  while (i < result.length) {
    const line = result[i];
    if (!columnMajorPageIndexes.has(line.pageIndex) || !isNearPageBottom(line)) {
      i++;
      continue;
    }
    // Collect the contiguous run of bottom-of-page lines on the same page
    let runEnd = i + 1;
    while (runEnd < result.length &&
      result[runEnd].pageIndex === line.pageIndex &&
      isNearPageBottom(result[runEnd])) {
      runEnd++;
    }
    if (runEnd - i <= 1) { i = runEnd; continue; }
    const run = result.slice(i, runEnd);
    const leftLines = run.filter((l) => l.column === "left");
    const rightLines = run.filter((l) => l.column === "right");
    const otherLines = run.filter((l) => l.column !== "left" && l.column !== "right");
    // Only reorder if there are both left and right column lines interleaved
    if (leftLines.length > 0 && rightLines.length > 0) {
      result.splice(i, runEnd - i, ...leftLines, ...rightLines, ...otherLines);
    }
    i = runEnd;
  }
  return result;
}

function isNearPageBottom(line: TextLine): boolean {
  if (line.pageHeight <= 0) return false;
  return line.y / line.pageHeight <= MULTI_COLUMN_NEAR_ROW_BOTTOM_Y_RATIO;
}

function shouldPreferColumnMajorOrdering(
  lines: TextLine[],
  columnSplitX: number | undefined,
): boolean {
  const bodyLines = lines.filter((line) => isLikelyColumnMajorBodyLine(line));
  const classify = (line: TextLine) => classifyColumnByDetectedSplit(line, columnSplitX);
  const leftLines = bodyLines.filter((line) => classify(line) === "left");
  const rightLines = bodyLines.filter((line) => classify(line) === "right");
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
  return reorderLinesByForwardPromotion(
    lines,
    (reordered, index) => findTopLevelHeadingPromotionIndex(reordered, index),
    { skipNextAfterPromotion: true },
  );
}

function reorderMisorderedNumberedHeadings(
  lines: TextLine[],
  multiColumnPageIndexes: Set<number>,
  columnMajorPageIndexes: Set<number>,
): TextLine[] {
  return reorderLinesByForwardPromotion(lines, (reordered, index) =>
    findNumberedHeadingPromotionIndex(reordered, index, multiColumnPageIndexes, columnMajorPageIndexes),
  );
}

/**
 * On column-major pages, a right-column numbered heading may appear before
 * left-column body text due to row-based Y-position sorting.  This step
 * finds such headings and moves them to just after the last left-column body
 * line on the same page.
 *
 * @remarks biome-ignore below: heading deferral with continuation detection requires nested loops.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: heading deferral with continuation detection requires nested loops.
function deferRightColumnHeadingsOnColumnMajorPages(
  lines: TextLine[],
  columnMajorPageIndexes: Set<number>,
  pageColumnSplitXs: Map<number, number>,
): TextLine[] {
  const result = [...lines];
  for (let i = 0; i < result.length; i++) {
    const line = result[i];
    if (!columnMajorPageIndexes.has(line.pageIndex)) continue;
    if (!isLikelyColumnHeadingLine(line.text)) continue;
    const columnSplitX = pageColumnSplitXs.get(line.pageIndex);
    if (classifyColumnByDetectedSplit(line, columnSplitX) !== "right") continue;

    // Skip headings that have a nearby same-column continuation line.
    // The continuation may not be the immediate neighbor in the sorted array
    // because short lines (e.g., "DESIGN") can be scattered by the column-major
    // body sort. Search both forward and backward for any same-page,
    // same-column, vertically adjacent line.
    let hasNearbyContinuation = false;
    for (let k = 0; k < result.length; k++) {
      if (k === i) continue;
      const candidate = result[k];
      if (candidate.pageIndex !== line.pageIndex) continue;
      if (classifyColumnByDetectedSplit(candidate, columnSplitX) !== "right") continue;
      if (Math.abs(candidate.y - line.y) <= line.fontSize * 2) {
        hasNearbyContinuation = true;
        break;
      }
    }
    if (hasNearbyContinuation) continue;

    // Find the last left-column line for this page after this heading.
    // Use column classification directly (not isLikelyColumnMajorBodyLine)
    // because lines near the page bottom are still real left-column content
    // even if they fail the near-row-body Y-range check.
    let lastLeftBodyIndex = -1;
    for (let j = i + 1; j < result.length; j++) {
      if (result[j].pageIndex !== line.pageIndex) break;
      if (classifyColumnByDetectedSplit(result[j], columnSplitX) === "left" &&
        !isLikelyColumnHeadingLine(result[j].text)) {
        lastLeftBodyIndex = j;
      }
    }
    if (lastLeftBodyIndex <= i) continue;

    // Move the heading to after the last left-column body line
    const [heading] = result.splice(i, 1);
    result.splice(lastLeftBodyIndex, 0, heading);
    // Re-check the same position (a new line is now at index i)
    i--;
  }
  return result;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sibling heading repair requires combined guards.
function reorderDescendingSequentialSiblingNumberedHeadings(lines: TextLine[]): TextLine[] {
  const reordered = [...lines];
  for (let index = 0; index < reordered.length - 1; index += 1) {
    const current = reordered[index];
    const next = reordered[index + 1];
    if (current.pageIndex !== next.pageIndex) continue;

    const currentPath = parseNumberedHeadingPathForReorder(current.text);
    const nextPath = parseNumberedHeadingPathForReorder(next.text);
    if (!currentPath || !nextPath) continue;
    if (!isSequentialSiblingSubsectionPair(nextPath, currentPath)) continue;

    const currentColumn = classifyMultiColumnLine(current);
    const nextColumn = classifyMultiColumnLine(next);
    if (currentColumn === "spanning" || nextColumn === "spanning") continue;
    if (currentColumn !== nextColumn) continue;
    if (next.y <= current.y) continue;

    promoteLine(reordered, index + 1, index);
    if (index > 0) index -= 1;
  }
  return reordered;
}

function reorderLeftColumnTopLevelHeadings(
  lines: TextLine[],
  multiColumnPageIndexes: Set<number>,
): TextLine[] {
  return reorderLinesByBackwardPromotion(lines, 1, (reordered, index) =>
    findLeftColumnTopLevelHeadingPromotionIndex(reordered, index, multiColumnPageIndexes),
  );
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
    if (!isLikelyColumnHeadingLine(leftHeading.text)) continue;
    if (!isLikelyColumnHeadingLine(rightHeading.text)) continue;
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
      if (
        !isValidLeftHeadingPairContinuationVerticalOrder(
          continuationLine,
          leftHeading,
          rightHeading,
          continuationInsertionIndex,
          index,
        )
      ) {
        break;
      }
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
  return reorderRightColumnLinesAfterLeftBodyContinuations(lines, {
    lookahead: RIGHT_HEADING_LEFT_BODY_CONTINUATION_LOOKAHEAD,
    isDeferredRightLine: isRightColumnHeadingEligibleForLeftContinuationDeferral,
    isLeftLineBeforeDeferredRightLine: isLeftBodyLineBeforeDeferredRightHeading,
    isLeftContinuationAfterDeferredRightLine: isLeftBodyContinuationAfterDeferredRightHeading,
  });
}

function reorderRightColumnBodyAfterLeftBodyContinuations(
  lines: TextLine[],
  multiColumnPageIndexes: Set<number>,
): TextLine[] {
  const fallbackInterleavedColumnPageIndexes = findFallbackInterleavedColumnPageIndexes(lines);
  const isDeferredRightBodyLine = (line: TextLine): boolean =>
    isRightColumnBodyEligibleForLeftContinuationDeferral(
      line,
      multiColumnPageIndexes,
      fallbackInterleavedColumnPageIndexes,
    );

  const reordered = [...lines];
  for (let index = 1; index < reordered.length - 1; index += 1) {
    const deferredRightLine = reordered[index];
    if (!isDeferredRightBodyLine(deferredRightLine)) continue;

    const previousLeftLine = reordered[index - 1];
    if (!isLeftProseBodyLineBeforeDeferredRightBody(previousLeftLine, deferredRightLine)) continue;

    const deferredRightBlock = collectDeferredRightBodyBlock(
      reordered,
      index,
      previousLeftLine,
      deferredRightLine,
      isDeferredRightBodyLine,
    );
    if (deferredRightBlock === undefined) continue;

    index = moveIndexedLinesAfterHeading(
      reordered,
      deferredRightBlock.deferredRightIndexes,
      deferredRightBlock.insertAfterIndex,
    );
  }
  return reordered;
}

interface RightLineDeferralRule {
  lookahead: number;
  isDeferredRightLine: (line: TextLine) => boolean;
  isLeftLineBeforeDeferredRightLine: (
    candidate: TextLine | undefined,
    deferredRightLine: TextLine,
  ) => candidate is TextLine;
  isLeftContinuationAfterDeferredRightLine: (
    candidate: TextLine | undefined,
    previousLeftLine: TextLine,
    deferredRightLine: TextLine,
  ) => candidate is TextLine;
}

function reorderRightColumnLinesAfterLeftBodyContinuations(
  lines: TextLine[],
  rule: RightLineDeferralRule,
): TextLine[] {
  const reordered = [...lines];
  for (let index = 1; index < reordered.length - 1; index += 1) {
    const deferredRightLine = reordered[index];
    if (!rule.isDeferredRightLine(deferredRightLine)) continue;

    const previousLeftLine = reordered[index - 1];
    if (!rule.isLeftLineBeforeDeferredRightLine(previousLeftLine, deferredRightLine)) continue;

    const insertionIndex = findDeferredRightLineInsertionIndex(
      reordered,
      index,
      previousLeftLine,
      deferredRightLine,
      rule,
    );
    if (insertionIndex === undefined) continue;

    promoteLine(reordered, index, insertionIndex - 1);
    index = insertionIndex - 1;
  }
  return reordered;
}

function findDeferredRightLineInsertionIndex(
  lines: TextLine[],
  deferredRightLineIndex: number,
  previousLeftLine: TextLine,
  deferredRightLine: TextLine,
  rule: RightLineDeferralRule,
): number | undefined {
  let insertionIndex = deferredRightLineIndex + 1;
  let currentLeftLine = previousLeftLine;
  let hasContinuation = false;
  const maxScanIndex = Math.min(lines.length, deferredRightLineIndex + rule.lookahead + 1);

  while (insertionIndex < maxScanIndex) {
    const candidate = lines[insertionIndex];
    if (
      !rule.isLeftContinuationAfterDeferredRightLine(candidate, currentLeftLine, deferredRightLine)
    ) {
      break;
    }
    hasContinuation = true;
    currentLeftLine = candidate;
    insertionIndex += 1;
    if (isLeftBodyContinuationTerminal(currentLeftLine)) break;
  }

  return hasContinuation ? insertionIndex : undefined;
}

interface DeferredRightBodyBlock {
  deferredRightIndexes: number[];
  insertAfterIndex: number;
}

interface FallbackInterleavedColumnPageStat {
  leftCount: number;
  rightCount: number;
  leftMinY: number;
  leftMaxY: number;
  pageHeight: number;
  rightMinY: number;
  rightMaxY: number;
  sideSwitches: number;
  lastSide?: "left" | "right";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fallback page classification combines geometry and prose-signal guards.
function findFallbackInterleavedColumnPageIndexes(lines: TextLine[]): Set<number> {
  const statsByPage = new Map<number, FallbackInterleavedColumnPageStat>();

  for (const line of lines) {
    if (!isLikelyNearRowBodyLine(line)) continue;
    if (isLikelyColumnHeadingLine(line.text)) continue;
    if (!isLikelyProseBodyText(line.text)) continue;

    const side = classifyMultiColumnLine(line);
    if (side === "spanning") continue;
    const stat = statsByPage.get(line.pageIndex) ?? {
      leftCount: 0,
      rightCount: 0,
      leftMinY: Number.POSITIVE_INFINITY,
      leftMaxY: Number.NEGATIVE_INFINITY,
      pageHeight: line.pageHeight,
      rightMinY: Number.POSITIVE_INFINITY,
      rightMaxY: Number.NEGATIVE_INFINITY,
      sideSwitches: 0,
    };

    if (stat.lastSide && stat.lastSide !== side) {
      stat.sideSwitches += 1;
    }
    stat.lastSide = side;

    if (side === "left") {
      stat.leftCount += 1;
      stat.leftMinY = Math.min(stat.leftMinY, line.y);
      stat.leftMaxY = Math.max(stat.leftMaxY, line.y);
    } else {
      stat.rightCount += 1;
      stat.rightMinY = Math.min(stat.rightMinY, line.y);
      stat.rightMaxY = Math.max(stat.rightMaxY, line.y);
    }
    statsByPage.set(line.pageIndex, stat);
  }

  const fallbackPageIndexes = new Set<number>();
  for (const [pageIndex, stat] of statsByPage) {
    if (stat.leftCount < FALLBACK_INTERLEAVED_COLUMN_MIN_BODY_LINES_PER_SIDE) continue;
    if (stat.rightCount < FALLBACK_INTERLEAVED_COLUMN_MIN_BODY_LINES_PER_SIDE) continue;
    if (stat.sideSwitches < FALLBACK_INTERLEAVED_COLUMN_MIN_SIDE_SWITCHES) continue;

    const leftSpan = stat.leftMaxY - stat.leftMinY;
    const rightSpan = stat.rightMaxY - stat.rightMinY;
    const pageHeight = Math.max(stat.pageHeight, 1);
    if (leftSpan / pageHeight < FALLBACK_INTERLEAVED_COLUMN_MIN_VERTICAL_SPAN_RATIO) continue;
    if (rightSpan / pageHeight < FALLBACK_INTERLEAVED_COLUMN_MIN_VERTICAL_SPAN_RATIO) continue;

    fallbackPageIndexes.add(pageIndex);
  }
  return fallbackPageIndexes;
}

function collectDeferredRightBodyBlock(
  lines: TextLine[],
  deferredRightStartIndex: number,
  previousLeftLine: TextLine,
  deferredRightLine: TextLine,
  isDeferredRightBodyLine: (line: TextLine) => boolean,
): DeferredRightBodyBlock | undefined {
  const deferredRightIndexes = [deferredRightStartIndex];
  const leftContinuationIndexes: number[] = [];
  let currentLeftLine = previousLeftLine;
  const maxScanIndex = Math.min(
    lines.length,
    deferredRightStartIndex + RIGHT_BODY_LEFT_CONTINUATION_LOOKAHEAD + 1,
  );

  for (let scanIndex = deferredRightStartIndex + 1; scanIndex < maxScanIndex; scanIndex += 1) {
    const candidate = lines[scanIndex];
    if (
      isLeftProseBodyContinuationAfterDeferredRightBody(
        candidate,
        currentLeftLine,
        deferredRightLine,
      )
    ) {
      leftContinuationIndexes.push(scanIndex);
      currentLeftLine = candidate;
      if (isLeftBodyContinuationTerminal(currentLeftLine)) break;
      continue;
    }

    if (isDeferredRightBodyLine(candidate)) {
      deferredRightIndexes.push(scanIndex);
      continue;
    }
    break;
  }

  const insertAfterIndex = leftContinuationIndexes[leftContinuationIndexes.length - 1];
  if (insertAfterIndex === undefined) return undefined;
  return { deferredRightIndexes, insertAfterIndex };
}

function isRightColumnBodyEligibleForLeftContinuationDeferral(
  bodyLine: TextLine,
  multiColumnPageIndexes: Set<number>,
  fallbackInterleavedColumnPageIndexes: Set<number>,
): boolean {
  const isEligiblePage =
    multiColumnPageIndexes.has(bodyLine.pageIndex) ||
    fallbackInterleavedColumnPageIndexes.has(bodyLine.pageIndex);
  if (!isEligiblePage) return false;
  if (classifyMultiColumnLine(bodyLine) !== "right") return false;
  if (!isLikelyNearRowBodyLine(bodyLine)) return false;
  if (isLikelyColumnHeadingLine(bodyLine.text)) return false;
  return isLikelyProseBodyText(bodyLine.text);
}

function isLeftProseBodyLineBeforeDeferredRightBody(
  candidate: TextLine | undefined,
  rightBody: TextLine,
): candidate is TextLine {
  if (!candidate) return false;
  if (candidate.pageIndex !== rightBody.pageIndex) return false;
  if (classifyMultiColumnLine(candidate) !== "left") return false;
  if (!isLikelyNearRowBodyLine(candidate)) return false;
  if (isLikelyColumnHeadingLine(candidate.text)) return false;
  if (!isLikelyProseBodyText(candidate.text)) return false;

  const normalized = normalizeSpacing(candidate.text);
  if (normalized.length === 0) return false;
  if (LEFT_BODY_CONTINUATION_END_PUNCTUATION_PATTERN.test(normalized)) return false;

  const verticalDelta = Math.abs(candidate.y - rightBody.y);
  const maxVerticalDelta = computeVerticalDeltaThreshold(
    candidate.fontSize,
    rightBody.fontSize,
    LEFT_BODY_CONTINUATION_MAX_Y_DELTA_FONT_RATIO,
    10,
  );
  return verticalDelta <= maxVerticalDelta;
}

function isLeftProseBodyContinuationAfterDeferredRightBody(
  candidate: TextLine | undefined,
  previousLeftLine: TextLine,
  rightBody: TextLine,
): candidate is TextLine {
  if (!candidate) return false;
  if (candidate.pageIndex !== rightBody.pageIndex) return false;
  if (classifyMultiColumnLine(candidate) !== "left") return false;
  if (!isLikelyNearRowBodyLine(candidate)) return false;
  if (isLikelyColumnHeadingLine(candidate.text)) return false;
  if (!isLikelyProseBodyText(candidate.text)) return false;

  const normalized = normalizeSpacing(candidate.text);
  if (
    !LEFT_BODY_CONTINUATION_START_PATTERN.test(normalized) &&
    !isUppercaseAcronymLikeContinuationStart(normalized, previousLeftLine)
  ) {
    return false;
  }

  const verticalDelta = previousLeftLine.y - candidate.y;
  const maxVerticalDelta = computeVerticalDeltaThreshold(
    previousLeftLine.fontSize,
    candidate.fontSize,
    LEFT_BODY_CONTINUATION_MAX_Y_DELTA_FONT_RATIO,
    10,
  );
  if (verticalDelta <= 0 || verticalDelta > maxVerticalDelta) return false;

  return (
    Math.abs(candidate.x - previousLeftLine.x) <=
    candidate.pageWidth * LEFT_BODY_CONTINUATION_MAX_LEFT_OFFSET_RATIO
  );
}

function isUppercaseAcronymLikeContinuationStart(
  normalized: string,
  previousLeftLine: TextLine,
): boolean {
  const previousNormalized = normalizeSpacing(previousLeftLine.text);
  if (LEFT_BODY_CONTINUATION_END_PUNCTUATION_PATTERN.test(previousNormalized)) return false;

  const [firstToken = ""] = normalized.split(/\s+/);
  const normalizedToken = firstToken.replace(/[^A-Za-z0-9-]/g, "");
  if (normalizedToken.length < 2) return false;
  if (!/^[A-Z]/.test(normalizedToken)) return false;

  const hasDigitOrHyphen = /[0-9-]/.test(normalizedToken);
  const alphabetic = normalizedToken.replace(/[^A-Za-z]/g, "");
  const isAllCaps = alphabetic.length >= 2 && alphabetic === alphabetic.toUpperCase();
  return hasDigitOrHyphen || isAllCaps;
}

function isLikelyProseBodyText(text: string): boolean {
  const normalized = normalizeSpacing(text);
  if (normalized.length < RIGHT_BODY_MIN_PROSE_CHAR_COUNT) return false;
  if (RIGHT_BODY_CODE_LIKE_PATTERN.test(normalized)) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;
  return splitWords(normalized).length >= RIGHT_BODY_MIN_PROSE_WORD_COUNT;
}

function isRightColumnHeadingEligibleForLeftContinuationDeferral(
  heading: TextLine,
): boolean {
  if (classifyMultiColumnLine(heading) !== "right") return false;
  return isLikelyColumnHeadingLine(heading.text);
}

function computeVerticalDeltaThreshold(
  leftFontSize: number,
  rightFontSize: number,
  maxDeltaFontRatio: number,
  minAbsolutePadding: number,
): number {
  const maxFontSize = Math.max(leftFontSize, rightFontSize);
  return Math.max(maxFontSize * maxDeltaFontRatio, maxFontSize + minAbsolutePadding);
}

function isLeftBodyContinuationTerminal(line: TextLine): boolean {
  return LEFT_BODY_CONTINUATION_END_PUNCTUATION_PATTERN.test(normalizeSpacing(line.text));
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
  if (LEFT_BODY_CONTINUATION_END_PUNCTUATION_PATTERN.test(normalized)) return false;

  const verticalDelta = Math.abs(candidate.y - heading.y);
  const maxVerticalDelta = computeVerticalDeltaThreshold(
    candidate.fontSize,
    heading.fontSize,
    LEFT_BODY_CONTINUATION_MAX_Y_DELTA_FONT_RATIO,
    10,
  );
  return verticalDelta <= maxVerticalDelta;
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
  if (!LEFT_BODY_CONTINUATION_START_PATTERN.test(normalized)) return false;

  const verticalDelta = previousLeftLine.y - candidate.y;
  const maxVerticalDelta = computeVerticalDeltaThreshold(
    previousLeftLine.fontSize,
    candidate.fontSize,
    LEFT_BODY_CONTINUATION_MAX_Y_DELTA_FONT_RATIO,
    10,
  );
  if (verticalDelta <= 0 || verticalDelta > maxVerticalDelta) return false;

  return (
    Math.abs(candidate.x - previousLeftLine.x) <=
    candidate.pageWidth * LEFT_BODY_CONTINUATION_MAX_LEFT_OFFSET_RATIO
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

function isValidLeftHeadingPairContinuationVerticalOrder(
  continuationLine: TextLine,
  leftHeading: TextLine,
  rightHeading: TextLine,
  continuationInsertionIndex: number,
  leftHeadingIndex: number,
): boolean {
  if (continuationInsertionIndex === leftHeadingIndex + 1) {
    const rightHeadingDelta = rightHeading.y - leftHeading.y;
    const continuationDelta = continuationLine.y - leftHeading.y;
    if (rightHeadingDelta === 0) {
      return continuationDelta < 0;
    }
    if (continuationDelta === 0) return false;
    return Math.sign(continuationDelta) === Math.sign(rightHeadingDelta);
  }
  return continuationLine.y > leftHeading.y;
}

function isSequentialSiblingSubsectionPair(leftPath: number[], rightPath: number[]): boolean {
  if (leftPath.length < 2 || rightPath.length < 2) return false;
  if (leftPath.length !== rightPath.length) return false;
  if (!isNumberPathPrefix(leftPath.slice(0, -1), rightPath.slice(0, -1))) return false;
  const leftLast = leftPath[leftPath.length - 1] ?? -1;
  const rightLast = rightPath[rightPath.length - 1] ?? -1;
  return leftLast + 1 === rightLast;
}

type PromotionIndexFinder = (lines: TextLine[], currentIndex: number) => number | undefined;

function reorderLinesByForwardPromotion(
  lines: TextLine[],
  findPromotionIndex: PromotionIndexFinder,
  options?: { startIndex?: number; skipNextAfterPromotion?: boolean },
): TextLine[] {
  const reordered = [...lines];
  for (let index = options?.startIndex ?? 0; index < reordered.length; index += 1) {
    const promotionIndex = findPromotionIndex(reordered, index);
    if (promotionIndex === undefined) continue;
    promoteLine(reordered, promotionIndex, index);
    if (options?.skipNextAfterPromotion) index += 1;
  }
  return reordered;
}

function reorderLinesByBackwardPromotion(
  lines: TextLine[],
  startIndex: number,
  findPromotionIndex: PromotionIndexFinder,
): TextLine[] {
  const reordered = [...lines];
  for (let index = startIndex; index < reordered.length; index += 1) {
    const promotionIndex = findPromotionIndex(reordered, index);
    if (promotionIndex === undefined) continue;
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

function reorderRightColumnBodyBeforeFirstTopLevelHeading(
  lines: TextLine[],
  multiColumnPageIndexes: Set<number>,
): TextLine[] {
  const reordered = [...lines];
  for (let index = 1; index < reordered.length; index += 1) {
    const heading = reordered[index];
    if (!isFirstTopLevelLeftColumnHeadingOnFirstPage(heading, multiColumnPageIndexes)) continue;
    const rightBodyIndexes = findRightBodyIndexesBeforeHeading(reordered, index, heading);
    if (rightBodyIndexes === undefined) continue;
    index = moveIndexedLinesAfterHeading(reordered, rightBodyIndexes, index);
  }
  return reordered;
}

function findRightBodyIndexesBeforeHeading(
  lines: TextLine[],
  headingIndex: number,
  heading: TextLine,
): number[] | undefined {
  const scanStart = Math.max(0, headingIndex - FIRST_TOP_LEVEL_HEADING_RIGHT_BODY_REORDER_LOOKBACK);
  const rightBodyIndexes: number[] = [];
  let hasLeftBodyLine = false;
  for (let scanIndex = scanStart; scanIndex < headingIndex; scanIndex += 1) {
    const candidateColumn = classifyNearRowBodyColumnBeforeHeading(lines[scanIndex], heading);
    if (candidateColumn === undefined) continue;
    if (candidateColumn === "right") {
      rightBodyIndexes.push(scanIndex);
      continue;
    }
    hasLeftBodyLine = true;
  }

  if (rightBodyIndexes.length === 0 || !hasLeftBodyLine) return undefined;
  return rightBodyIndexes;
}

function classifyNearRowBodyColumnBeforeHeading(
  candidate: TextLine,
  heading: TextLine,
): "left" | "right" | undefined {
  if (candidate.pageIndex !== heading.pageIndex) return undefined;
  if (candidate.y <= heading.y) return undefined;
  if (isLikelyColumnHeadingLine(candidate.text)) return undefined;
  if (!isLikelyNearRowBodyLine(candidate)) return undefined;
  const candidateColumn = classifyMultiColumnLine(candidate);
  return candidateColumn === "spanning" ? undefined : candidateColumn;
}

function moveIndexedLinesAfterHeading(
  lines: TextLine[],
  lineIndexes: number[],
  headingIndex: number,
): number {
  const linesToMove = lineIndexes.map((lineIndex) => lines[lineIndex]);
  let adjustedHeadingIndex = headingIndex;
  for (let index = lineIndexes.length - 1; index >= 0; index -= 1) {
    const removeIndex = lineIndexes[index];
    if (removeIndex < adjustedHeadingIndex) adjustedHeadingIndex -= 1;
    lines.splice(removeIndex, 1);
  }

  const insertIndex = adjustedHeadingIndex + 1;
  lines.splice(insertIndex, 0, ...linesToMove);
  return insertIndex + linesToMove.length;
}

function isFirstTopLevelLeftColumnHeadingOnFirstPage(
  line: TextLine,
  multiColumnPageIndexes: Set<number>,
): boolean {
  if (line.pageIndex !== 0) return false;
  if (!multiColumnPageIndexes.has(line.pageIndex)) return false;
  if (classifyMultiColumnLine(line) !== "left") return false;
  if (getTopLevelHeadingNumber(line.text) !== 1) return false;
  return isAllCapsTopLevelHeading(line.text);
}

function isAllCapsTopLevelHeading(text: string): boolean {
  const parsed = parseMultiColumnHeading(text);
  if (!parsed) return false;
  if (!/[A-Z]/.test(parsed.headingText)) return false;
  return !/[a-z]/.test(parsed.headingText);
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
  columnMajorPageIndexes: Set<number>,
): number | undefined {
  const current = lines[currentIndex];
  if (!isRightColumnHeadingCandidate(current)) return undefined;
  // On column-major pages, the sort already placed left-column content before
  // right-column content. Promoting a right-column heading forward would
  // incorrectly insert it into the middle of left-column text.
  if (columnMajorPageIndexes.has(current.pageIndex)) return undefined;
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

function classifyColumnByDetectedSplit(
  line: TextLine,
  columnSplitX: number | undefined,
): "left" | "right" | "spanning" {
  if (columnSplitX === undefined) return classifyNearRowBodyColumn(line);
  const pageWidth = Math.max(line.pageWidth, 1);
  if (line.estimatedWidth / pageWidth >= MULTI_COLUMN_SPANNING_LINE_WIDTH_RATIO) return "spanning";
  const rightEdge = line.x + line.estimatedWidth;
  const rightColumnWidth = pageWidth - columnSplitX;
  if (
    line.x < columnSplitX * 0.5 &&
    rightEdge > columnSplitX + rightColumnWidth * CROSS_COLUMN_SPANNING_OVERSHOOT_RATIO
  )
    return "spanning";
  // Apply a small tolerance so that right-column lines whose x falls
  // just below the detected split (due to PDF coordinate rounding) are
  // still classified as "right".  The split X is the median right-column
  // start position, so a half-font-size tolerance absorbs jitter without
  // any risk of capturing left-column lines (which are far to the left).
  const tolerance = line.fontSize * 0.5;
  return line.x < columnSplitX - tolerance ? "left" : "right";
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
  return splitWords(text);
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

function hasRowBasedMultiColumnEvidence(
  buckets: Map<number, ExtractedFragment[]>,
  pageWidth: number,
): boolean {
  let multiFragmentRows = 0;
  let rowsWithColumnBreak = 0;
  for (const fragments of buckets.values()) {
    if (fragments.length < 2) continue;
    multiFragmentRows += 1;
    const sorted = [...fragments].sort((left, right) => left.x - right.x);
    const directBreaks = findColumnBreakIndexes(sorted, pageWidth);
    if (directBreaks.length > 0) {
      rowsWithColumnBreak += 1;
    } else if (findBridgedColumnBreakIndexes(sorted, pageWidth).length > 0) {
      rowsWithColumnBreak += 1;
    }
  }
  return (
    rowsWithColumnBreak >= MIN_MULTI_COLUMN_BREAK_ROWS &&
    rowsWithColumnBreak / Math.max(multiFragmentRows, 1) >= MIN_MULTI_COLUMN_BREAK_ROW_RATIO
  );
}

/**
 * Fallback multi-column detection based on spatial distribution of text.
 * Groups single-row fragments into "lines" and checks if they cluster into
 * two horizontal bands (left and right) separated by a clear vertical gap.
 * This catches pages where left/right column text lines don't align vertically
 * (so row-based gap detection fails), but the overall spatial layout is clearly
 * two-column.
 */
function hasColumnGapFromSpatialDistribution(
  buckets: Map<number, ExtractedFragment[]>,
  pageWidth: number,
): boolean {
  const midX = pageWidth * MULTI_COLUMN_SPLIT_RATIO;
  const minBodyY = 0.08;
  const maxBodyY = 0.92;
  const minSideLines = 8;
  const maxNarrowLineWidthRatio = 0.55;

  let leftNarrowLines = 0;
  let rightNarrowLines = 0;

  for (const fragments of buckets.values()) {
    const sorted = [...fragments].sort((left, right) => left.x - right.x);
    const startX = sorted[0].x;
    const lastFrag = sorted[sorted.length - 1];
    const endX = lastFrag.x + estimateTextWidth(lastFrag.text, lastFrag.fontSize);
    const lineWidth = endX - startX;
    const lineCenter = (startX + endX) / 2;
    const y = sorted[0].y;

    // Skip header/footer fragments
    if (y < pageWidth * minBodyY || y > pageWidth * maxBodyY) continue;
    // Skip short fragments (page numbers, labels, etc.)
    const totalChars = sorted.reduce((sum, f) => sum + countSubstantiveChars(f.text), 0);
    if (totalChars < MIN_COLUMN_BREAK_TEXT_CHARACTER_COUNT) continue;
    // Skip wide lines that span across columns
    if (lineWidth > pageWidth * maxNarrowLineWidthRatio) continue;

    if (lineCenter < midX) leftNarrowLines++;
    else rightNarrowLines++;
  }

  return leftNarrowLines >= minSideLines && rightNarrowLines >= minSideLines;
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
    const estimatedCenter = estimateFragmentCenterX(fragment);
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

function estimateFragmentCenterX(fragment: ExtractedFragment): number {
  return fragment.x + estimateTextWidth(fragment.text, fragment.fontSize) / 2;
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
    const center = estimateFragmentCenterX(fragment);
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
    const center = estimateFragmentCenterX(fragment);
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

function findBridgedColumnBreakIndexes(
  fragments: ExtractedFragment[],
  pageWidth: number,
): number[] {
  const indexes: number[] = [];
  for (let i = 0; i < fragments.length - 1; i += 1) {
    const bridgedBreakIndex = findBridgedColumnBreakIndex(fragments, i, pageWidth);
    if (bridgedBreakIndex === undefined) continue;
    indexes.push(bridgedBreakIndex);
    i = bridgedBreakIndex;
  }
  return indexes;
}

function mergeColumnBreakIndexes(
  directBreakIndexes: number[],
  bridgedBreakIndexes: number[],
): number[] {
  if (bridgedBreakIndexes.length === 0) return directBreakIndexes;
  const merged = new Set<number>(directBreakIndexes);
  for (const bridgedIndex of bridgedBreakIndexes) {
    merged.add(bridgedIndex);
  }
  return [...merged].sort((left, right) => left - right);
}

function findBridgedColumnBreakIndex(
  fragments: ExtractedFragment[],
  leftIndex: number,
  pageWidth: number,
): number | undefined {
  const maxBridgeSize = Math.min(MAX_COLUMN_BREAK_BRIDGE_LOOKAHEAD, fragments.length - leftIndex - 2);
  if (maxBridgeSize < 1) return undefined;

  const left = fragments[leftIndex];
  for (let bridgeSize = 1; bridgeSize <= maxBridgeSize; bridgeSize += 1) {
    const rightIndex = leftIndex + bridgeSize + 1;
    const right = fragments[rightIndex];
    if (!right) break;
    if (!isLikelyColumnBreak(left, right, pageWidth)) continue;
    if (!isLikelyLeftColumnBreakAnchor(left, pageWidth)) continue;
    if (!isLikelyRightColumnBreakAnchor(right, pageWidth)) continue;

    const bridgeFragments = fragments.slice(leftIndex + 1, rightIndex);
    const isBridgeValid = bridgeFragments.every(isIgnorableColumnBreakBridgeFragment);
    if (isBridgeValid) return rightIndex - 1;
  }
  return undefined;
}

function isLikelyLeftColumnBreakAnchor(fragment: ExtractedFragment, pageWidth: number): boolean {
  const center = estimateFragmentCenterX(fragment);
  return center < pageWidth * MULTI_COLUMN_SPLIT_RATIO;
}

function isLikelyRightColumnBreakAnchor(fragment: ExtractedFragment, pageWidth: number): boolean {
  const center = estimateFragmentCenterX(fragment);
  return center > pageWidth * MULTI_COLUMN_SPLIT_RATIO;
}

function isIgnorableColumnBreakBridgeFragment(fragment: ExtractedFragment): boolean {
  const normalized = normalizeSpacing(fragment.text);
  if (normalized.length === 0) return true;
  if (countSubstantiveChars(normalized) > COLUMN_BREAK_BRIDGE_MAX_SUBSTANTIVE_CHARS) {
    return false;
  }
  return /^[^\p{L}\p{N}]+$/u.test(normalized);
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

function collapseDuplicatedSentencePrefix(text: string): string {
  const match = text.match(DUPLICATED_SENTENCE_PREFIX_PATTERN);
  if (!match) return text;
  const sentence = match[1] ?? "";
  const suffix = match[2] ?? "";
  return normalizeSpacing(`${sentence}${suffix}`);
}

export function normalizeSpacing(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((token) => token.length > 0);
}

export function countWords(text: string): number {
  return splitWords(text).length;
}

export function groupLinesByPage(lines: TextLine[]): Map<number, TextLine[]> {
  return lines.reduce((grouped, line) => {
    const pageLines = grouped.get(line.pageIndex) ?? [];
    pageLines.push(line);
    grouped.set(line.pageIndex, pageLines);
    return grouped;
  }, new Map<number, TextLine[]>());
}

/**
 * Returns the x position of the dominant fragment in a group, using the
 * fragment with the largest font size. This prevents tiny superscript
 * markers (e.g. footnote numbers) from pulling the line's x position away
 * from the actual body text start.
 */
function estimateLineStartX(fragments: ExtractedFragment[]): number {
  if (fragments.length === 1) return fragments[0].x;
  let dominantFragment = fragments[0];
  for (let i = 1; i < fragments.length; i++) {
    if (fragments[i].fontSize > dominantFragment.fontSize) {
      dominantFragment = fragments[i];
    }
  }
  // Only override when the dominant fragment has a significantly larger font
  // and the minimum-x fragment is far from the dominant one.
  const minX = Math.min(...fragments.map((f) => f.x));
  if (dominantFragment.x === minX) return minX;
  const maxFontSize = dominantFragment.fontSize;
  const minFontFragment = fragments.reduce((a, b) => (a.x < b.x ? a : b));
  const fontDelta = maxFontSize - minFontFragment.fontSize;
  if (fontDelta < maxFontSize * 0.2) return minX;
  const gap = dominantFragment.x - (minFontFragment.x + estimateTextWidth(minFontFragment.text, minFontFragment.fontSize));
  if (gap < 30) return minX;
  return dominantFragment.x;
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
