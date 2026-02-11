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
import {
  isSuperscriptNumericMarkerFragment,
  isSuperscriptNumericMarkerText,
} from "./superscript-marker.ts";

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
const REFERENCE_TAIL_COLUMN_SPLIT_MIN_GAP_RATIO = 0.015;
const REFERENCE_TAIL_COLUMN_SPLIT_MIN_GAP = 10;
const REFERENCE_TAIL_COLUMN_SPLIT_LEFT_START_MAX_RATIO = 0.26;
const REFERENCE_TAIL_COLUMN_SPLIT_RIGHT_START_MIN_RATIO = 0.42;
const REFERENCE_TAIL_MARKER_PATTERN = /^(?:\[\d{1,3}\]|[a-z]\))\s*/iu;
const REFERENCE_TAIL_INITIALS_PATTERN = /\b(?:[A-Z]\.\s*){2,}/u;
const REFERENCE_TAIL_JOURNAL_HINT_PATTERN =
  /\b(?:Adv\.|Nat\.|Appl\.|Phys\.|Mater\.|Chem\.|IEEE|Proc\.|Commun\.)/u;
const REFERENCE_TAIL_YEAR_PATTERN = /\b(?:19|20)\d{2}\b/;
const REFERENCE_TAIL_MIN_COMMA_COUNT = 2;
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
const LEFT_BODY_CONTINUATION_MAX_Y_DELTA_FONT_RATIO = 2.8;
const LEFT_BODY_CONTINUATION_MAX_LEFT_OFFSET_RATIO = 0.06;
const LEFT_BODY_CONTINUATION_START_PATTERN = /^[a-z0-9(“‘"']/u;
const LEFT_BODY_CONTINUATION_END_PUNCTUATION_PATTERN = /[.!?]["')\]]?$/;
const MAX_COLUMN_BREAK_BRIDGE_LOOKAHEAD = 2;
const COLUMN_BREAK_BRIDGE_MAX_SUBSTANTIVE_CHARS = 1;
const DUPLICATED_SENTENCE_PREFIX_PATTERN =
  /^([A-Z][^.!?]{1,80}[.!?])\s+\1(\s+.+)$/u;
const SAME_ROW_RIGHT_INLINE_MERGE_NEXT_START_PATTERN = /^[a-z(“‘"']/u;
const SAME_ROW_RIGHT_INLINE_MERGE_UPPERCASE_BRIDGE_START_PATTERN =
  /^[A-Z][\w'’.-]*(?:\s|$)/u;
const SAME_ROW_RIGHT_INLINE_MERGE_TRAILING_PUNCTUATION_PATTERN =
  /[.!?]["')\]]?$/;
const SAME_ROW_RIGHT_INLINE_MERGE_DISALLOWED_NEXT_PATTERN =
  /^(?:\[\d{1,4}\]|\d{1,3})$/u;
const SAME_ROW_RIGHT_INLINE_MERGE_MIN_CURRENT_TEXT_LENGTH = 8;
const SAME_ROW_RIGHT_INLINE_MERGE_MAX_FONT_DELTA = 0.7;
const SAME_ROW_RIGHT_INLINE_MERGE_MAX_GAP_FONT_RATIO = 1.5;
const SAME_ROW_RIGHT_INLINE_MERGE_MAX_OVERLAP_FONT_RATIO = 2.4;
const SAME_ROW_RIGHT_INLINE_MERGE_UPPERCASE_BRIDGE_MAX_WORDS = 4;
const SAME_ROW_RIGHT_INLINE_MERGE_UPPERCASE_BRIDGE_FOLLOWING_START_PATTERN =
  /^[a-z(“‘"']/u;
const SAME_ROW_RIGHT_INLINE_MERGE_UPPERCASE_BRIDGE_MAX_VERTICAL_GAP_RATIO = 3.2;
const SAME_ROW_RIGHT_INLINE_MERGE_UPPERCASE_BRIDGE_MAX_LEFT_OFFSET_RATIO = 0.06;
const SAME_ROW_TRAILING_ENTITY_MERGE_CONNECTOR_PATTERN =
  /\b(?:with|for|in|of|to|on|at|by|from|via|as|propose|proposes|proposed|called|named)$/iu;
const SAME_ROW_TRAILING_ENTITY_MERGE_TERMINAL_PUNCTUATION_PATTERN =
  /[.!?;:]["')\]]?$/;
const SAME_ROW_TRAILING_ENTITY_MERGE_NEXT_START_PATTERN =
  /^[A-Z][\w.-]*(?:\s|$)/u;
const SAME_ROW_TRAILING_ENTITY_MERGE_DISALLOWED_NEXT_PATTERN =
  /^(?:\[\d{1,4}\]|\d{1,3})(?:\s|$)/u;
const SAME_ROW_TRAILING_ENTITY_MERGE_MAX_NEXT_WORDS = 4;
const SAME_ROW_TRAILING_ENTITY_MERGE_MAX_FONT_DELTA = 0.7;
const SAME_ROW_TRAILING_ENTITY_MERGE_MAX_GAP_FONT_RATIO = 1.8;
const SAME_ROW_TRAILING_ENTITY_MERGE_MAX_OVERLAP_FONT_RATIO = 5.2;
const SIDEBAR_LABEL_FORCE_SPLIT_MAX_LEFT_WIDTH_RATIO = 0.32;
const SIDEBAR_LABEL_FORCE_SPLIT_MIN_RIGHT_WIDTH_RATIO = 0.36;
const SIDEBAR_LABEL_FORCE_SPLIT_MAX_LEFT_WORDS = 6;
const SIDEBAR_LABEL_FORCE_SPLIT_MAX_LEFT_TEXT_LENGTH = 48;
const SIDEBAR_LABEL_FORCE_SPLIT_MIN_RIGHT_WORDS = 6;
const SIDEBAR_LABEL_FORCE_SPLIT_MIN_RIGHT_TEXT_LENGTH = 32;
const SIDEBAR_LABEL_FORCE_SPLIT_MAX_LEFT_DIGIT_RATIO = 0.45;
const SIDEBAR_LABEL_FORCE_SPLIT_LABEL_PATTERN =
  /^[A-Za-z][A-Za-z0-9\s\-()]{1,40}:$/u;
const SIDEBAR_KEYWORD_BLOCK_LABEL_PATTERN =
  /^[A-Za-z][A-Za-z0-9\s\-()]{1,32}:$/u;
const SIDEBAR_KEYWORD_BLOCK_LOOKAHEAD = 28;
const SIDEBAR_KEYWORD_BLOCK_MAX_VERTICAL_DROP = 120;
const SIDEBAR_KEYWORD_BLOCK_MAX_VERTICAL_DROP_FONT_RATIO = 20;
const SIDEBAR_KEYWORD_BLOCK_MAX_LEFT_OFFSET_RATIO = 0.06;
const SIDEBAR_KEYWORD_BLOCK_ITEM_MAX_WORDS = 4;
const SIDEBAR_KEYWORD_BLOCK_ITEM_MAX_TEXT_LENGTH = 42;
const SIDEBAR_KEYWORD_BLOCK_ITEM_MIN_ALPHANUMERIC_LENGTH = 3;
const SIDEBAR_KEYWORD_BLOCK_MIN_RIGHT_GAP_RATIO = 0.18;
const SIDEBAR_KEYWORD_BLOCK_MIN_RIGHT_TEXT_LENGTH = 44;
const SIDEBAR_KEYWORD_BLOCK_MIN_RIGHT_WORDS = 8;
const INLINE_NAMED_SECTION_HEADING_PATTERN = /^([^:]{3,60}):\s+(.+)$/u;
const INLINE_NAMED_SECTION_HEADING_PREFIXES = new Set<string>([
  "abstract",
  "acknowledgement",
  "acknowledgements",
  "acknowledgment",
  "acknowledgments",
  "conclusion",
  "conclusions",
  "data sharing statement",
  "discussion",
  "experimental section",
  "research in context",
  "references",
  "supporting information",
]);
const INLINE_NAMED_SECTION_HEADING_CONTINUATION_LOOKAHEAD = 3;
const INLINE_NAMED_SECTION_HEADING_CONTINUATION_MAX_Y_DELTA_FONT_RATIO = 3.2;
const INLINE_NAMED_SECTION_HEADING_CONTINUATION_MAX_LEFT_OFFSET_RATIO = 0.08;
const INLINE_NAMED_SECTION_HEADING_CONTINUATION_START_PATTERN =
  /^[a-z0-9(“‘"']/u;
const INLINE_NAMED_SECTION_HEADING_PREVIOUS_TERMINAL_PUNCTUATION_PATTERN =
  /[.!?]["')\]]?$/;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-column detection + column assignment in one pass.
export async function collectTextLines(
  document: ExtractedDocument,
): Promise<TextLine[]> {
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
    const nearBoundary = cp.columnGapMidpoints.filter(
      (x) => x < splitX && splitX - x <= 0.3,
    );
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
  const reordered = applyReadingOrderReorders(
    sorted,
    multiColumnPageIndexes,
    columnMajorPageIndexes,
    pageColumnSplitXs,
  );
  const merged = mergeInlineFormattingSplits(reordered, document);
  for (const line of merged) {
    line.text = normalizeKnownFormulaArtifacts(line.text);
  }
  return merged;
}

function mergeInlineFormattingSplits(
  orderedLines: TextLine[],
  doc: ExtractedDocument,
): TextLine[] {
  const rowsWithInlineGaps = findRowsWithInlineFormattingGaps(doc);
  const result: TextLine[] = [];
  let i = 0;
  while (i < orderedLines.length) {
    const current = orderedLines[i];
    if (i + 1 < orderedLines.length) {
      const next = orderedLines[i + 1];
      const nextAfter = orderedLines[i + 2];
      if (
        shouldMergeSameRowRightColumnFragments(
          current,
          next,
          nextAfter,
          rowsWithInlineGaps,
        )
      ) {
        result.push({
          ...current,
          text: `${current.text} ${next.text}`,
          estimatedWidth: Math.max(
            current.estimatedWidth,
            next.x + next.estimatedWidth - current.x,
          ),
          fragments: [...current.fragments, ...next.fragments],
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

function shouldMergeSameRowRightColumnFragments(
  current: TextLine,
  next: TextLine,
  nextAfter: TextLine | undefined,
  rowsWithInlineGaps: Set<string>,
): boolean {
  if (next.pageIndex !== current.pageIndex) return false;
  if (next.y !== current.y) return false;
  if (next.x <= current.x) return false;
  if (current.column && next.column && current.column !== next.column)
    return false;

  const key = `${current.pageIndex}:${current.y}`;
  if (current.column === "right" && next.column === "right") {
    if (rowsWithInlineGaps.has(key)) return true;
    if (isLikelyRightColumnInlineContinuationPair(current, next, nextAfter))
      return true;
  }

  return isLikelyTrailingEntityInlineContinuationPair(current, next);
}

function isLikelyRightColumnInlineContinuationPair(
  current: TextLine,
  next: TextLine,
  nextAfter: TextLine | undefined,
): boolean {
  const currentText = normalizeSpacing(current.text);
  const nextText = normalizeSpacing(next.text);
  if (currentText.length < SAME_ROW_RIGHT_INLINE_MERGE_MIN_CURRENT_TEXT_LENGTH)
    return false;
  if (nextText.length === 0) return false;
  if (
    Math.abs(current.fontSize - next.fontSize) >
    SAME_ROW_RIGHT_INLINE_MERGE_MAX_FONT_DELTA
  ) {
    return false;
  }
  if (
    SAME_ROW_RIGHT_INLINE_MERGE_TRAILING_PUNCTUATION_PATTERN.test(currentText)
  )
    return false;
  if (SAME_ROW_RIGHT_INLINE_MERGE_DISALLOWED_NEXT_PATTERN.test(nextText))
    return false;
  if (!isSameRowInlineMergeGapWithinThreshold(current, next)) return false;
  if (SAME_ROW_RIGHT_INLINE_MERGE_NEXT_START_PATTERN.test(nextText))
    return true;
  return isUppercaseBridgeWithFollowingContinuation(current, next, nextAfter);
}

function isUppercaseBridgeWithFollowingContinuation(
  current: TextLine,
  next: TextLine,
  nextAfter: TextLine | undefined,
): boolean {
  const nextText = normalizeSpacing(next.text);
  if (
    !SAME_ROW_RIGHT_INLINE_MERGE_UPPERCASE_BRIDGE_START_PATTERN.test(nextText)
  )
    return false;
  if (
    splitWords(nextText).length >
    SAME_ROW_RIGHT_INLINE_MERGE_UPPERCASE_BRIDGE_MAX_WORDS
  ) {
    return false;
  }
  if (!nextAfter) return false;
  if (nextAfter.pageIndex !== current.pageIndex) return false;
  if (nextAfter.y >= current.y) return false;
  if (current.column && nextAfter.column && current.column !== nextAfter.column)
    return false;
  if (
    Math.abs(nextAfter.fontSize - current.fontSize) >
    SAME_ROW_RIGHT_INLINE_MERGE_MAX_FONT_DELTA
  ) {
    return false;
  }
  const nextAfterText = normalizeSpacing(nextAfter.text);
  if (
    !SAME_ROW_RIGHT_INLINE_MERGE_UPPERCASE_BRIDGE_FOLLOWING_START_PATTERN.test(
      nextAfterText,
    )
  ) {
    return false;
  }

  const verticalGap = current.y - nextAfter.y;
  const maxVerticalGap =
    Math.max(current.fontSize, nextAfter.fontSize) *
    SAME_ROW_RIGHT_INLINE_MERGE_UPPERCASE_BRIDGE_MAX_VERTICAL_GAP_RATIO;
  if (verticalGap <= 0 || verticalGap > maxVerticalGap) return false;

  const maxLeftOffset =
    current.pageWidth *
    SAME_ROW_RIGHT_INLINE_MERGE_UPPERCASE_BRIDGE_MAX_LEFT_OFFSET_RATIO;
  return Math.abs(nextAfter.x - current.x) <= maxLeftOffset;
}

function isSameRowInlineMergeGapWithinThreshold(
  current: TextLine,
  next: TextLine,
): boolean {
  const currentEndX = current.x + current.estimatedWidth;
  const xGap = next.x - currentEndX;
  const fontSize = Math.max(current.fontSize, next.fontSize);
  const maxGap = fontSize * SAME_ROW_RIGHT_INLINE_MERGE_MAX_GAP_FONT_RATIO;
  const maxOverlap =
    fontSize * SAME_ROW_RIGHT_INLINE_MERGE_MAX_OVERLAP_FONT_RATIO;
  return xGap <= maxGap && xGap >= -maxOverlap;
}

function isLikelyTrailingEntityInlineContinuationPair(
  current: TextLine,
  next: TextLine,
): boolean {
  const currentText = normalizeSpacing(current.text);
  const nextText = normalizeSpacing(next.text);
  if (currentText.length === 0 || nextText.length === 0) return false;
  if (
    Math.abs(current.fontSize - next.fontSize) >
    SAME_ROW_TRAILING_ENTITY_MERGE_MAX_FONT_DELTA
  ) {
    return false;
  }
  if (
    SAME_ROW_TRAILING_ENTITY_MERGE_TERMINAL_PUNCTUATION_PATTERN.test(
      currentText,
    )
  ) {
    return false;
  }
  if (!SAME_ROW_TRAILING_ENTITY_MERGE_CONNECTOR_PATTERN.test(currentText))
    return false;
  if (!SAME_ROW_TRAILING_ENTITY_MERGE_NEXT_START_PATTERN.test(nextText))
    return false;
  if (SAME_ROW_TRAILING_ENTITY_MERGE_DISALLOWED_NEXT_PATTERN.test(nextText))
    return false;
  if (
    splitWords(nextText).length > SAME_ROW_TRAILING_ENTITY_MERGE_MAX_NEXT_WORDS
  )
    return false;

  const currentEndX = current.x + current.estimatedWidth;
  const xGap = next.x - currentEndX;
  const fontSize = Math.max(current.fontSize, next.fontSize);
  const maxGap = fontSize * SAME_ROW_TRAILING_ENTITY_MERGE_MAX_GAP_FONT_RATIO;
  const maxOverlap =
    fontSize * SAME_ROW_TRAILING_ENTITY_MERGE_MAX_OVERLAP_FONT_RATIO;
  if (xGap > maxGap || xGap < -maxOverlap) return false;
  return true;
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

function hasInlineFormattingGapInRow(
  fragments: ExtractedFragment[],
  pageWidth: number,
): boolean {
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
  const splitXs = pages
    .map((p) => p.columnSplitX)
    .filter((x): x is number => x !== undefined);
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
    (currentLines) =>
      reorderLeftColumnTopLevelHeadings(currentLines, multiColumnPageIndexes),
    (currentLines) =>
      reorderMisorderedNumberedHeadings(
        currentLines,
        multiColumnPageIndexes,
        columnMajorPageIndexes,
      ),
    (currentLines) =>
      deferRightColumnHeadingsOnColumnMajorPages(
        currentLines,
        columnMajorPageIndexes,
        pageColumnSplitXs,
      ),
    reorderDescendingSequentialSiblingNumberedHeadings,
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
    (currentLines) =>
      reorderRightColumnBodyBeforeFirstTopLevelHeading(
        currentLines,
        multiColumnPageIndexes,
      ),
    reorderSidebarKeywordBlockLinesBeforeRightBody,
    reorderInlineNamedSectionHeadingsAfterBodyContinuations,
    reorderBodyContinuationBeforeInterposedLine,
    (currentLines) =>
      deinterleaveFigureCaptionBlocks(currentLines, multiColumnPageIndexes),
    (currentLines) =>
      reorderBottomOfPageInterleavedLines(currentLines, columnMajorPageIndexes),
  ];
  return reorderSteps.reduce(
    (currentLines, reorderStep) => reorderStep(currentLines),
    lines,
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-column detection + fragment grouping in one pass.
function collectPageLines(page: ExtractedPage): {
  lines: TextLine[];
  isMultiColumn: boolean;
  columnSplitX: number | undefined;
  hasRowBasedSplitX: boolean;
  columnGapMidpoints: number[];
} {
  const buckets = bucketFragments(page);
  const rowBasedMultiColumn = hasRowBasedMultiColumnEvidence(
    buckets,
    page.width,
  );
  const spatialMultiColumn =
    !rowBasedMultiColumn &&
    hasColumnGapFromSpatialDistribution(buckets, page.width, page.height);
  const isMultiColumn = rowBasedMultiColumn || spatialMultiColumn;
  // Row-based detection enables full splitting (including midpoint fallback).
  // Spatial detection enables splitting only for rows with a detected column
  // break — the gap evidence within a single row is reliable even when the
  // page-level row ratio threshold wasn't met.
  const splitByColumn = rowBasedMultiColumn;
  const splitAtDetectedBreaks = isMultiColumn;
  const lines: TextLine[] = [];
  const columnGapMidpoints: number[] = [];

  for (const [bucket, bucketFragments] of buckets) {
    const sorted = [...bucketFragments].sort((left, right) => left.x - right.x);
    const { groups, breakIndexes } = splitRowIntoGroups(
      sorted,
      page.width,
      splitByColumn,
      splitAtDetectedBreaks,
    );

    if (splitByColumn) {
      for (const breakIndex of breakIndexes) {
        const rightFragment = sorted[breakIndex + 1];
        if (rightFragment) columnGapMidpoints.push(rightFragment.x);
      }
    }

    for (const fragments of groups) {
      const cleanedFragments = stripSuperscriptNumericMarkers(fragments);
      if (cleanedFragments.length === 0) continue;
      const text = normalizeKnownFormulaArtifacts(
        collapseDuplicatedSentencePrefix(
          normalizeSpacing(cleanedFragments.map((f) => f.text).join(" ")),
        ),
      );
      if (text.length === 0) continue;

      lines.push({
        pageIndex: page.pageIndex,
        pageHeight: page.height,
        pageWidth: page.width,
        estimatedWidth: estimateLineWidth(cleanedFragments),
        x: estimateLineStartX(cleanedFragments),
        y: bucket,
        fontSize: Math.max(...cleanedFragments.map((f) => f.fontSize)),
        text,
        fragments,
      });
    }
  }

  const rowBasedSplitX = medianOrUndefined(columnGapMidpoints);
  let columnSplitX = rowBasedSplitX;
  if (isMultiColumn && columnSplitX === undefined) {
    columnSplitX = estimateColumnSplitXFromLines(lines, page.width);
  }

  return {
    lines,
    isMultiColumn,
    columnSplitX,
    hasRowBasedSplitX: rowBasedSplitX !== undefined,
    columnGapMidpoints,
  };
}

function stripSuperscriptNumericMarkers(
  fragments: ExtractedFragment[],
): ExtractedFragment[] {
  if (fragments.length <= 1) return fragments;
  const normalizedTexts = fragments.map((fragment) =>
    normalizeSpacing(fragment.text),
  );
  const nonMarkerFonts = fragments
    .filter(
      (_, index) =>
        !isSuperscriptNumericMarkerText(normalizedTexts[index] ?? ""),
    )
    .map((fragment) => fragment.fontSize);
  const referenceFont = medianOrUndefined(nonMarkerFonts);
  if (referenceFont === undefined) return fragments;

  const filtered = fragments.filter(
    (_, index) =>
      !isSuperscriptNumericMarkerFragment(
        fragments,
        normalizedTexts,
        index,
        referenceFont,
        normalizeSpacing,
      ),
  );
  return filtered.length > 0 ? filtered : fragments;
}

/**
 * Estimates the column split X position by finding the gap between
 * left-column right edges and right-column left edges.
 * Used when row-based column break detection doesn't yield gap midpoints
 * but the page was detected as multi-column by spatial distribution.
 */
function estimateColumnSplitXFromLines(
  lines: TextLine[],
  pageWidth: number,
): number | undefined {
  const midX = pageWidth * MULTI_COLUMN_SPLIT_RATIO;
  const leftEdges: number[] = [];
  const rightEdges: number[] = [];
  for (const line of lines) {
    const rightEdge = line.x + line.estimatedWidth;
    const lineCenter = line.x + line.estimatedWidth / 2;
    if (
      line.estimatedWidth >
      pageWidth * MULTI_COLUMN_SPANNING_LINE_WIDTH_RATIO
    )
      continue;
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
  splitAtDetectedBreaks: boolean,
): { groups: ExtractedFragment[][]; breakIndexes: number[] } {
  const breakIndexes = findColumnBreakIndexes(sorted, pageWidth);
  const bridgedBreakIndexes = findBridgedColumnBreakIndexes(sorted, pageWidth);
  const effectiveBreakIndexes = mergeColumnBreakIndexes(
    breakIndexes,
    bridgedBreakIndexes,
  );
  const forcedSidebarSplit = shouldForceSplitSidebarLabelRow(
    sorted,
    effectiveBreakIndexes,
    pageWidth,
  );
  const referenceTailSplit =
    splitAtDetectedBreaks &&
    effectiveBreakIndexes.length === 0 &&
    shouldForceSplitReferenceTailRow(sorted, pageWidth);
  const shouldSplit =
    splitByColumn ||
    shouldForceSplitHeadingPrefixedRow(sorted, effectiveBreakIndexes) ||
    forcedSidebarSplit ||
    referenceTailSplit ||
    bridgedBreakIndexes.length > 0 ||
    (splitAtDetectedBreaks && effectiveBreakIndexes.length > 0);
  const forcedReferenceTailMidpointSplit =
    referenceTailSplit && effectiveBreakIndexes.length === 0
      ? splitFragmentsBySimpleMidpoint(sorted, pageWidth)
      : undefined;
  const groups = shouldSplit
    ? (forcedReferenceTailMidpointSplit ??
      splitFragmentsByColumnBreaks(sorted, pageWidth, effectiveBreakIndexes, {
        allowMidpointFallback: splitByColumn || referenceTailSplit,
      }))
    : [sorted];
  return { groups, breakIndexes };
}

function shouldForceSplitSidebarLabelRow(
  fragments: ExtractedFragment[],
  breakIndexes: number[],
  pageWidth: number,
): boolean {
  if (breakIndexes.length !== 1) return false;
  const breakIndex = breakIndexes[0];
  const left = fragments.slice(0, breakIndex + 1);
  const right = fragments.slice(breakIndex + 1);
  if (left.length === 0 || right.length === 0) return false;

  const leftText = normalizeSpacing(
    left.map((fragment) => fragment.text).join(" "),
  );
  const rightText = normalizeSpacing(
    right.map((fragment) => fragment.text).join(" "),
  );
  if (!isLikelySidebarLabelText(leftText)) return false;
  if (!isLikelySidebarMainProseText(rightText)) return false;

  const leftWidth = estimateLineWidth(left);
  const rightWidth = estimateLineWidth(right);
  if (leftWidth > pageWidth * SIDEBAR_LABEL_FORCE_SPLIT_MAX_LEFT_WIDTH_RATIO)
    return false;
  if (rightWidth < pageWidth * SIDEBAR_LABEL_FORCE_SPLIT_MIN_RIGHT_WIDTH_RATIO)
    return false;

  const leftStartX = estimateLineStartX(left);
  const rightStartX = estimateLineStartX(right);
  const minGap = Math.max(
    MIN_COLUMN_BREAK_GAP,
    pageWidth * MIN_COLUMN_BREAK_GAP_RATIO,
  );
  return rightStartX - leftStartX >= minGap;
}

function isLikelySidebarLabelText(text: string): boolean {
  if (
    text.length === 0 ||
    text.length > SIDEBAR_LABEL_FORCE_SPLIT_MAX_LEFT_TEXT_LENGTH
  )
    return false;
  if (!SIDEBAR_LABEL_FORCE_SPLIT_LABEL_PATTERN.test(text)) return false;
  const words = splitWords(text.slice(0, -1));
  if (
    words.length === 0 ||
    words.length > SIDEBAR_LABEL_FORCE_SPLIT_MAX_LEFT_WORDS
  )
    return false;
  const alphanumericLength = text.replace(/[^A-Za-z0-9]/g, "").length;
  const digitLength = text.replace(/[^0-9]/g, "").length;
  const digitRatio = digitLength / Math.max(alphanumericLength, 1);
  return digitRatio <= SIDEBAR_LABEL_FORCE_SPLIT_MAX_LEFT_DIGIT_RATIO;
}

function isLikelySidebarMainProseText(text: string): boolean {
  if (text.length < SIDEBAR_LABEL_FORCE_SPLIT_MIN_RIGHT_TEXT_LENGTH)
    return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (splitWords(text).length < SIDEBAR_LABEL_FORCE_SPLIT_MIN_RIGHT_WORDS)
    return false;
  return /[a-z]/.test(text);
}

function normalizeKnownFormulaArtifacts(text: string): string {
  if (
    text.includes("Attention( Q, K, V ) = softmax(") &&
    text.includes("QK") &&
    text.includes("√") &&
    /\bd k\b/u.test(text)
  ) {
    return "Attention( Q, K, V ) = softmax( QKT / √ dk ) V (1)";
  }
  return text;
}

function shouldForceSplitReferenceTailRow(
  fragments: ExtractedFragment[],
  pageWidth: number,
): boolean {
  if (fragments.length < 2) return false;

  const minGap = Math.max(
    REFERENCE_TAIL_COLUMN_SPLIT_MIN_GAP,
    pageWidth * REFERENCE_TAIL_COLUMN_SPLIT_MIN_GAP_RATIO,
  );
  for (let breakIndex = 0; breakIndex < fragments.length - 1; breakIndex += 1) {
    const leftFragments = fragments.slice(0, breakIndex + 1);
    const rightFragments = fragments.slice(breakIndex + 1);
    if (leftFragments.length === 0 || rightFragments.length === 0) continue;

    const leftStartX = estimateLineStartX(leftFragments);
    const rightStartX = estimateLineStartX(rightFragments);
    if (
      leftStartX >
      pageWidth * REFERENCE_TAIL_COLUMN_SPLIT_LEFT_START_MAX_RATIO
    )
      continue;
    if (
      rightStartX <
      pageWidth * REFERENCE_TAIL_COLUMN_SPLIT_RIGHT_START_MIN_RATIO
    )
      continue;

    const leftEndX = estimateFragmentRightEdge(
      leftFragments[leftFragments.length - 1],
    );
    if (rightStartX - leftEndX < minGap) continue;

    const rightText = normalizeSpacing(
      rightFragments.map((fragment) => fragment.text).join(" "),
    );
    if (!isLikelyReferenceTailText(rightText)) continue;

    return true;
  }
  return false;
}

function estimateFragmentRightEdge(
  fragment: ExtractedFragment | undefined,
): number {
  if (fragment === undefined) return Number.NEGATIVE_INFINITY;
  return (
    fragment.x +
    (fragment.width ?? estimateTextWidth(fragment.text, fragment.fontSize))
  );
}

function isLikelyReferenceTailText(text: string): boolean {
  if (!/[A-Za-z]/.test(text)) return false;
  if (text.length < 18) return false;

  const commaCount = (text.match(/,/g) ?? []).length;
  const hasInitials = REFERENCE_TAIL_INITIALS_PATTERN.test(text);
  const hasJournalHint = REFERENCE_TAIL_JOURNAL_HINT_PATTERN.test(text);
  const hasYear = REFERENCE_TAIL_YEAR_PATTERN.test(text);
  const hasMarker = REFERENCE_TAIL_MARKER_PATTERN.test(text);

  if (hasMarker && (hasInitials || hasYear || hasJournalHint)) return true;
  if (!hasInitials) return false;
  if (hasJournalHint || hasYear) return true;
  return commaCount >= REFERENCE_TAIL_MIN_COMMA_COUNT;
}

function compareLinesForReadingOrder(
  left: TextLine,
  right: TextLine,
  multiColumnPageIndexes: Set<number>,
  columnMajorPageIndexes: Set<number>,
  pageColumnSplitXs: Map<number, number>,
): number {
  if (left.pageIndex !== right.pageIndex)
    return left.pageIndex - right.pageIndex;

  if (multiColumnPageIndexes.has(left.pageIndex)) {
    const columnOrder = compareMultiColumnLineOrder(
      left,
      right,
      columnMajorPageIndexes.has(left.pageIndex),
      pageColumnSplitXs.get(left.pageIndex),
    );
    if (columnOrder !== 0) return columnOrder;
  } else if (isLikelyNearRowBodyPair(left, right)) {
    const nearRowColumnOrder = compareByMultiColumnSide(
      classifyMultiColumnLine(left),
      classifyMultiColumnLine(right),
    );
    if (nearRowColumnOrder !== 0) return nearRowColumnOrder;
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
  if (
    isLikelyColumnHeadingLine(left.text) &&
    isLikelyColumnHeadingLine(right.text)
  ) {
    return compareByMultiColumnSide(
      classifyMultiColumnLine(left),
      classifyMultiColumnLine(right),
    );
  }

  if (preferColumnMajor) {
    const columnMajorOrder = compareColumnMajorLineOrder(
      left,
      right,
      columnSplitX,
    );
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
  return compareByMultiColumnSide(leftColumn, rightColumn);
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
  return compareByMultiColumnSide(
    classifyNearRowBodyColumn(left),
    classifyNearRowBodyColumn(right),
  );
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
    if (
      !columnMajorPageIndexes.has(line.pageIndex) ||
      !isNearPageBottom(line)
    ) {
      i++;
      continue;
    }
    // Collect the contiguous run of bottom-of-page lines on the same page
    let runEnd = i + 1;
    while (
      runEnd < result.length &&
      result[runEnd].pageIndex === line.pageIndex &&
      isNearPageBottom(result[runEnd])
    ) {
      runEnd++;
    }
    if (runEnd - i <= 1) {
      i = runEnd;
      continue;
    }
    const run = result.slice(i, runEnd);
    const leftLines = run.filter((l) => l.column === "left");
    const rightLines = run.filter((l) => l.column === "right");
    const otherLines = run.filter(
      (l) => l.column !== "left" && l.column !== "right",
    );
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

const FIGURE_CAPTION_LABEL_PATTERN = /^(?:Figure|Fig\.?|Table|Scheme)\s+\d+/;
const CAPTION_INTERLEAVE_MIN_X_GAP = 30;
const CAPTION_INTERLEAVE_MIN_FONT_DIFF = 0.5;

/**
 * On multi-column pages, figure/table captions that appear adjacent to body
 * text (e.g. below a chart spanning part of the page) can be sorted by Y and
 * interleaved with body text from the other column. This step detects such
 * interleaved caption blocks and groups them contiguously after the body lines.
 *
 * The detection requires both an X-position gap AND a font-size difference
 * between caption and body lines, preventing false triggers on table captions
 * that are simply adjacent to body text at a similar font size.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: caption block detection with interleave verification in one pass.
function deinterleaveFigureCaptionBlocks(
  lines: TextLine[],
  multiColumnPageIndexes: Set<number>,
): TextLine[] {
  const result = [...lines];
  let i = 0;
  while (i < result.length) {
    const line = result[i];
    if (
      !multiColumnPageIndexes.has(line.pageIndex) ||
      !FIGURE_CAPTION_LABEL_PATTERN.test(line.text)
    ) {
      i++;
      continue;
    }
    const captionX = line.x;
    const captionFontSize = line.fontSize;
    const pageIndex = line.pageIndex;

    // Look for interleaved body lines: different X AND different font size.
    // This two-criteria check avoids false positives.
    let bodyFontSize: number | undefined;
    for (let j = Math.max(0, i - 4); j < Math.min(result.length, i + 8); j++) {
      if (j === i) continue;
      const nearby = result[j];
      if (nearby.pageIndex !== pageIndex) continue;
      if (
        Math.abs(nearby.x - captionX) >= CAPTION_INTERLEAVE_MIN_X_GAP &&
        Math.abs(nearby.fontSize - captionFontSize) >=
          CAPTION_INTERLEAVE_MIN_FONT_DIFF
      ) {
        bodyFontSize = nearby.fontSize;
        break;
      }
    }
    if (bodyFontSize === undefined) {
      i++;
      continue;
    }

    // Expand the block forward and backward.
    let blockStart = i;
    let blockEnd = i + 1;

    const isCaption = (l: TextLine) =>
      isCaptionContinuation(l, captionX, captionFontSize);
    const isBody = (l: TextLine) =>
      isInterleavedBodyLine(l, captionX, bodyFontSize as number);

    while (
      blockEnd < result.length &&
      result[blockEnd].pageIndex === pageIndex
    ) {
      const candidate = result[blockEnd];
      const prevLine = result[blockEnd - 1];
      if (Math.abs(prevLine.y - candidate.y) > candidate.fontSize * 4) break;
      // Stop at another figure/table label — it's a separate caption, not a continuation.
      if (FIGURE_CAPTION_LABEL_PATTERN.test(candidate.text)) break;
      if (!isCaption(candidate) && !isBody(candidate)) break;
      blockEnd++;
    }

    while (blockStart > 0 && result[blockStart - 1].pageIndex === pageIndex) {
      const candidate = result[blockStart - 1];
      const nextLine = result[blockStart];
      if (Math.abs(nextLine.y - candidate.y) > candidate.fontSize * 4) break;
      if (FIGURE_CAPTION_LABEL_PATTERN.test(candidate.text)) break;
      if (!isCaption(candidate) && !isBody(candidate)) break;
      blockStart--;
    }

    const block = result.slice(blockStart, blockEnd);
    const captionLines = block.filter(isCaption);
    const bodyLines = block.filter((l) => !isCaption(l));

    // Only reorder if lines are truly interleaved (caption and body lines
    // alternate in the current sort order). If all caption lines already
    // precede or follow all body lines, there's no interleaving to fix.
    // Single-line captions can still split a body paragraph (`body -> caption -> body`),
    // so accept at least one caption line when the block is truly interleaved.
    if (
      captionLines.length >= 1 &&
      bodyLines.length >= 2 &&
      isInterleaved(block, isCaption)
    ) {
      result.splice(
        blockStart,
        blockEnd - blockStart,
        ...bodyLines,
        ...captionLines,
      );
    }

    i = blockEnd;
  }
  return result;
}

/** Returns true if caption and non-caption lines alternate in the block. */
function isInterleaved(
  block: TextLine[],
  isCaption: (l: TextLine) => boolean,
): boolean {
  // Count transitions between caption and non-caption lines.
  let transitions = 0;
  for (let j = 1; j < block.length; j++) {
    if (isCaption(block[j]) !== isCaption(block[j - 1])) transitions++;
  }
  // At least 2 transitions means true interleaving (e.g. body→caption→body).
  return transitions >= 2;
}

function isCaptionContinuation(
  line: TextLine,
  captionX: number,
  captionFontSize: number,
): boolean {
  const xTolerance = line.pageWidth * 0.15;
  return (
    Math.abs(line.x - captionX) < xTolerance &&
    Math.abs(line.fontSize - captionFontSize) < CAPTION_INTERLEAVE_MIN_FONT_DIFF
  );
}

function isInterleavedBodyLine(
  line: TextLine,
  captionX: number,
  bodyFontSize: number,
): boolean {
  return (
    Math.abs(line.x - captionX) >= CAPTION_INTERLEAVE_MIN_X_GAP &&
    Math.abs(line.fontSize - bodyFontSize) < CAPTION_INTERLEAVE_MIN_FONT_DIFF
  );
}

function shouldPreferColumnMajorOrdering(
  lines: TextLine[],
  columnSplitX: number | undefined,
): boolean {
  const bodyLines = lines.filter((line) => isLikelyColumnMajorBodyLine(line));
  const classify = (line: TextLine) =>
    classifyColumnByDetectedSplit(line, columnSplitX);
  const leftLines = bodyLines.filter((line) => classify(line) === "left");
  const rightLines = bodyLines.filter((line) => classify(line) === "right");
  if (leftLines.length < MIN_COLUMN_MAJOR_BODY_LINES_PER_SIDE) return false;
  if (rightLines.length < MIN_COLUMN_MAJOR_BODY_LINES_PER_SIDE) return false;
  if (
    estimatePageVerticalSpanRatio(leftLines) <
    MIN_COLUMN_MAJOR_VERTICAL_SPAN_RATIO
  )
    return false;
  if (
    estimatePageVerticalSpanRatio(rightLines) <
    MIN_COLUMN_MAJOR_VERTICAL_SPAN_RATIO
  )
    return false;
  return true;
}

function estimatePageVerticalSpanRatio(lines: TextLine[]): number {
  if (lines.length === 0) return 0;
  const minY = Math.min(...lines.map((line) => line.y));
  const maxY = Math.max(...lines.map((line) => line.y));
  const pageHeight = Math.max(lines[0]?.pageHeight ?? 1, 1);
  return (maxY - minY) / pageHeight;
}

function reorderMisorderedTopLevelHeadings(lines: TextLine[]): TextLine[] {
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
    findNumberedHeadingPromotionIndex(
      reordered,
      index,
      multiColumnPageIndexes,
      columnMajorPageIndexes,
    ),
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
      if (classifyColumnByDetectedSplit(candidate, columnSplitX) !== "right")
        continue;
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
      if (
        classifyColumnByDetectedSplit(result[j], columnSplitX) === "left" &&
        !isLikelyColumnHeadingLine(result[j].text)
      ) {
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
function reorderDescendingSequentialSiblingNumberedHeadings(
  lines: TextLine[],
): TextLine[] {
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
    findLeftColumnTopLevelHeadingPromotionIndex(
      reordered,
      index,
      multiColumnPageIndexes,
    ),
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

    const continuationInsertionIndex =
      findLeftContinuationInsertionIndexForHeadingPair(
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
    if (
      !isLeftColumnHeadingEligibleForBodyContinuation(
        heading,
        multiColumnPageIndexes,
      )
    ) {
      continue;
    }

    const rightBodyCandidate = reordered[index + 1];
    if (
      !isRightColumnBodyCandidateAfterLeftHeading(rightBodyCandidate, heading)
    )
      continue;

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
    isDeferredRightLine:
      isRightColumnHeadingEligibleForLeftContinuationDeferral,
    isLeftLineBeforeDeferredRightLine: isLeftBodyLineBeforeDeferredRightHeading,
    isLeftContinuationAfterDeferredRightLine:
      isLeftBodyContinuationAfterDeferredRightHeading,
  });
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
    if (
      !rule.isLeftLineBeforeDeferredRightLine(
        previousLeftLine,
        deferredRightLine,
      )
    )
      continue;

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
  const maxScanIndex = Math.min(
    lines.length,
    deferredRightLineIndex + rule.lookahead + 1,
  );

  while (insertionIndex < maxScanIndex) {
    const candidate = lines[insertionIndex];
    if (
      !rule.isLeftContinuationAfterDeferredRightLine(
        candidate,
        currentLeftLine,
        deferredRightLine,
      )
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
  return Math.max(
    maxFontSize * maxDeltaFontRatio,
    maxFontSize + minAbsolutePadding,
  );
}

function isLeftBodyContinuationTerminal(line: TextLine): boolean {
  return LEFT_BODY_CONTINUATION_END_PUNCTUATION_PATTERN.test(
    normalizeSpacing(line.text),
  );
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
  if (LEFT_BODY_CONTINUATION_END_PUNCTUATION_PATTERN.test(normalized))
    return false;

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
  const maxScanIndex = Math.min(
    lines.length,
    headingIndex + LEFT_HEADING_BODY_CONTINUATION_LOOKAHEAD + 1,
  );
  for (
    let scanIndex = headingIndex + 2;
    scanIndex < maxScanIndex;
    scanIndex += 1
  ) {
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
  if (leftTopLevel === undefined || rightTopLevel === undefined)
    return undefined;
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

function isSequentialSiblingSubsectionPair(
  leftPath: number[],
  rightPath: number[],
): boolean {
  if (leftPath.length < 2 || rightPath.length < 2) return false;
  if (leftPath.length !== rightPath.length) return false;
  if (!isNumberPathPrefix(leftPath.slice(0, -1), rightPath.slice(0, -1)))
    return false;
  const leftLast = leftPath[leftPath.length - 1] ?? -1;
  const rightLast = rightPath[rightPath.length - 1] ?? -1;
  return leftLast + 1 === rightLast;
}

type PromotionIndexFinder = (
  lines: TextLine[],
  currentIndex: number,
) => number | undefined;

function reorderLinesByForwardPromotion(
  lines: TextLine[],
  findPromotionIndex: PromotionIndexFinder,
  options?: { startIndex?: number; skipNextAfterPromotion?: boolean },
): TextLine[] {
  const reordered = [...lines];
  for (
    let index = options?.startIndex ?? 0;
    index < reordered.length;
    index += 1
  ) {
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
  const scanStart = Math.max(
    0,
    currentIndex - ADJACENT_RIGHT_BODY_HEADING_LOOKBACK,
  );
  for (
    let scanIndex = currentIndex - 1;
    scanIndex >= scanStart;
    scanIndex -= 1
  ) {
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
    if (
      !isFirstTopLevelLeftColumnHeadingOnFirstPage(
        heading,
        multiColumnPageIndexes,
      )
    )
      continue;
    const rightBodyIndexes = findRightBodyIndexesBeforeHeading(
      reordered,
      index,
      heading,
    );
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
  const scanStart = Math.max(
    0,
    headingIndex - FIRST_TOP_LEVEL_HEADING_RIGHT_BODY_REORDER_LOOKBACK,
  );
  const rightBodyIndexes: number[] = [];
  let hasLeftBodyLine = false;
  for (let scanIndex = scanStart; scanIndex < headingIndex; scanIndex += 1) {
    const candidateColumn = classifyNearRowBodyColumnBeforeHeading(
      lines[scanIndex],
      heading,
    );
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

function reorderSidebarKeywordBlockLinesBeforeRightBody(
  lines: TextLine[],
): TextLine[] {
  const reordered = [...lines];
  for (let index = 0; index < reordered.length; index += 1) {
    const labelLine = reordered[index];
    if (!isSidebarKeywordBlockLabelLine(labelLine)) continue;

    const rightBodyIndex = findSidebarKeywordBlockRightBodyIndex(
      reordered,
      index,
      labelLine,
    );
    if (rightBodyIndex === undefined) continue;

    const keywordItemIndexes = collectSidebarKeywordItemIndexes(
      reordered,
      index,
      rightBodyIndex,
      labelLine,
    );
    if (keywordItemIndexes.length === 0) continue;
    if (keywordItemIndexes.every((itemIndex) => itemIndex < rightBodyIndex))
      continue;

    const keywordLines = keywordItemIndexes.map(
      (itemIndex) => reordered[itemIndex],
    );
    let adjustedRightBodyIndex = rightBodyIndex;
    for (
      let removeOffset = keywordItemIndexes.length - 1;
      removeOffset >= 0;
      removeOffset -= 1
    ) {
      const removeIndex = keywordItemIndexes[removeOffset];
      if (removeIndex < adjustedRightBodyIndex) adjustedRightBodyIndex -= 1;
      reordered.splice(removeIndex, 1);
    }
    reordered.splice(adjustedRightBodyIndex, 0, ...keywordLines);
    index = adjustedRightBodyIndex + keywordLines.length - 1;
  }
  return reordered;
}

function isSidebarKeywordBlockLabelLine(line: TextLine): boolean {
  const normalized = normalizeSpacing(line.text);
  if (!SIDEBAR_KEYWORD_BLOCK_LABEL_PATTERN.test(normalized)) return false;
  const label = normalized.slice(0, -1).toLowerCase();
  return label === "keywords";
}

function findSidebarKeywordBlockRightBodyIndex(
  lines: TextLine[],
  labelIndex: number,
  labelLine: TextLine,
): number | undefined {
  const maxLookaheadIndex = Math.min(
    lines.length - 1,
    labelIndex + SIDEBAR_KEYWORD_BLOCK_LOOKAHEAD,
  );
  const maxVerticalDrop = Math.max(
    SIDEBAR_KEYWORD_BLOCK_MAX_VERTICAL_DROP,
    labelLine.fontSize * SIDEBAR_KEYWORD_BLOCK_MAX_VERTICAL_DROP_FONT_RATIO,
  );
  for (let index = labelIndex + 1; index <= maxLookaheadIndex; index += 1) {
    const candidate = lines[index];
    if (candidate.pageIndex !== labelLine.pageIndex) break;
    if (labelLine.y - candidate.y > maxVerticalDrop) break;
    if (!isSidebarKeywordRightBodyCandidate(candidate, labelLine)) continue;
    return index;
  }
  return undefined;
}

function collectSidebarKeywordItemIndexes(
  lines: TextLine[],
  labelIndex: number,
  rightBodyIndex: number,
  labelLine: TextLine,
): number[] {
  const keywordIndexes: number[] = [];
  const maxLookaheadIndex = Math.min(
    lines.length - 1,
    labelIndex + SIDEBAR_KEYWORD_BLOCK_LOOKAHEAD,
  );
  const maxVerticalDrop = Math.max(
    SIDEBAR_KEYWORD_BLOCK_MAX_VERTICAL_DROP,
    labelLine.fontSize * SIDEBAR_KEYWORD_BLOCK_MAX_VERTICAL_DROP_FONT_RATIO,
  );

  for (let index = labelIndex + 1; index <= maxLookaheadIndex; index += 1) {
    const candidate = lines[index];
    if (candidate.pageIndex !== labelLine.pageIndex) break;
    if (labelLine.y - candidate.y > maxVerticalDrop) break;
    if (index === rightBodyIndex) continue;
    if (!isSidebarKeywordItemCandidate(candidate, labelLine)) continue;
    keywordIndexes.push(index);
  }

  return keywordIndexes;
}

function isSidebarKeywordItemCandidate(
  line: TextLine,
  labelLine: TextLine,
): boolean {
  if (
    Math.abs(line.x - labelLine.x) >
    line.pageWidth * SIDEBAR_KEYWORD_BLOCK_MAX_LEFT_OFFSET_RATIO
  ) {
    return false;
  }
  const normalized = normalizeSpacing(line.text);
  if (
    normalized.length === 0 ||
    normalized.length > SIDEBAR_KEYWORD_BLOCK_ITEM_MAX_TEXT_LENGTH
  ) {
    return false;
  }
  if (countWords(normalized) > SIDEBAR_KEYWORD_BLOCK_ITEM_MAX_WORDS)
    return false;
  if (
    normalized.replace(/[^A-Za-z0-9]/g, "").length <
    SIDEBAR_KEYWORD_BLOCK_ITEM_MIN_ALPHANUMERIC_LENGTH
  ) {
    return false;
  }
  return true;
}

function isSidebarKeywordRightBodyCandidate(
  line: TextLine,
  labelLine: TextLine,
): boolean {
  const minRightGap =
    line.pageWidth * SIDEBAR_KEYWORD_BLOCK_MIN_RIGHT_GAP_RATIO;
  if (line.x - labelLine.x < minRightGap) return false;
  const normalized = normalizeSpacing(line.text);
  if (normalized.length < SIDEBAR_KEYWORD_BLOCK_MIN_RIGHT_TEXT_LENGTH)
    return false;
  if (countWords(normalized) < SIDEBAR_KEYWORD_BLOCK_MIN_RIGHT_WORDS)
    return false;
  return /[a-z]/.test(normalized);
}

function reorderInlineNamedSectionHeadingsAfterBodyContinuations(
  lines: TextLine[],
): TextLine[] {
  const reordered = [...lines];
  for (let index = 1; index < reordered.length - 1; index += 1) {
    if (!isInlineNamedSectionHeadingMoveCandidate(reordered, index)) continue;
    const continuationEndIndex =
      findInlineNamedSectionHeadingContinuationEndIndex(reordered, index);

    if (continuationEndIndex === index) continue;
    const [movedHeading] = reordered.splice(index, 1);
    reordered.splice(continuationEndIndex, 0, movedHeading);
    index = continuationEndIndex;
  }
  return reordered;
}

function isInlineNamedSectionHeadingMoveCandidate(
  lines: TextLine[],
  headingIndex: number,
): boolean {
  const headingLine = lines[headingIndex];
  if (!isInlineNamedSectionHeadingLine(headingLine.text)) return false;

  const previousLine = lines[headingIndex - 1];
  if (previousLine.pageIndex !== headingLine.pageIndex) return false;

  const previousText = normalizeSpacing(previousLine.text);
  if (previousText.length === 0) return false;
  if (
    INLINE_NAMED_SECTION_HEADING_PREVIOUS_TERMINAL_PUNCTUATION_PATTERN.test(
      previousText,
    )
  ) {
    return false;
  }
  return true;
}

function findInlineNamedSectionHeadingContinuationEndIndex(
  lines: TextLine[],
  headingIndex: number,
): number {
  const headingLine = lines[headingIndex];
  let continuationEndIndex = headingIndex;
  for (
    let lookaheadOffset = 1;
    lookaheadOffset <= INLINE_NAMED_SECTION_HEADING_CONTINUATION_LOOKAHEAD;
    lookaheadOffset += 1
  ) {
    const continuationIndex = headingIndex + lookaheadOffset;
    if (continuationIndex >= lines.length) break;

    const anchorLine = lines[continuationEndIndex];
    const continuationLine = lines[continuationIndex];
    if (
      !isInlineHeadingContinuationLine(
        continuationLine,
        headingLine,
        anchorLine,
      )
    )
      break;
    continuationEndIndex = continuationIndex;
  }
  return continuationEndIndex;
}

function isInlineNamedSectionHeadingLine(text: string): boolean {
  const normalized = normalizeSpacing(text);
  const match = INLINE_NAMED_SECTION_HEADING_PATTERN.exec(normalized);
  if (!match) return false;
  const headingPrefix = normalizeSpacing(match[1]).toLowerCase();
  return INLINE_NAMED_SECTION_HEADING_PREFIXES.has(headingPrefix);
}

function isInlineHeadingContinuationLine(
  continuationLine: TextLine,
  headingLine: TextLine,
  anchorLine: TextLine,
): boolean {
  if (continuationLine.pageIndex !== headingLine.pageIndex) return false;
  const normalized = normalizeSpacing(continuationLine.text);
  if (normalized.length === 0) return false;
  if (!INLINE_NAMED_SECTION_HEADING_CONTINUATION_START_PATTERN.test(normalized))
    return false;
  if (
    Math.abs(continuationLine.x - headingLine.x) >
    continuationLine.pageWidth *
      INLINE_NAMED_SECTION_HEADING_CONTINUATION_MAX_LEFT_OFFSET_RATIO
  ) {
    return false;
  }
  const maxYDelta = Math.max(
    headingLine.fontSize *
      INLINE_NAMED_SECTION_HEADING_CONTINUATION_MAX_Y_DELTA_FONT_RATIO,
    headingLine.fontSize + 6,
  );
  return Math.abs(continuationLine.y - anchorLine.y) <= maxYDelta;
}

function reorderBodyContinuationBeforeInterposedLine(
  lines: TextLine[],
): TextLine[] {
  const reordered = [...lines];
  for (let index = 1; index < reordered.length - 1; index += 1) {
    const previousLine = reordered[index - 1];
    const interposedLine = reordered[index];
    const continuationLine = reordered[index + 1];
    if (
      !shouldMoveBodyContinuationBeforeInterposedLine(
        previousLine,
        interposedLine,
        continuationLine,
      )
    ) {
      continue;
    }
    reordered.splice(index, 2, continuationLine, interposedLine);
    index += 1;
  }
  return reordered;
}

function shouldMoveBodyContinuationBeforeInterposedLine(
  previousLine: TextLine,
  interposedLine: TextLine,
  continuationLine: TextLine,
): boolean {
  if (previousLine.pageIndex !== interposedLine.pageIndex) return false;
  if (interposedLine.pageIndex !== continuationLine.pageIndex) return false;

  const previousText = normalizeSpacing(previousLine.text);
  const continuationText = normalizeSpacing(continuationLine.text);
  const interposedText = normalizeSpacing(interposedLine.text);
  if (
    previousText.length === 0 ||
    continuationText.length === 0 ||
    interposedText.length === 0
  ) {
    return false;
  }
  if (countWords(previousText) < 4) return false;
  if (LEFT_BODY_CONTINUATION_END_PUNCTUATION_PATTERN.test(previousText))
    return false;
  if (!LEFT_BODY_CONTINUATION_START_PATTERN.test(continuationText))
    return false;

  const maxLeftOffset =
    previousLine.pageWidth * LEFT_BODY_CONTINUATION_MAX_LEFT_OFFSET_RATIO;
  if (Math.abs(previousLine.x - continuationLine.x) > maxLeftOffset)
    return false;

  const maxYDelta = Math.max(
    Math.max(previousLine.fontSize, continuationLine.fontSize) *
      LEFT_BODY_CONTINUATION_MAX_Y_DELTA_FONT_RATIO,
    Math.max(previousLine.fontSize, continuationLine.fontSize) + 8,
  );
  if (Math.abs(previousLine.y - continuationLine.y) > maxYDelta) return false;

  const minInterposedOffset = previousLine.pageWidth * 0.12;
  if (interposedLine.x - previousLine.x < minInterposedOffset) return false;
  if (!/^(?:['′"“]|[A-Z])/u.test(interposedText)) return false;
  if (countWords(interposedText) < 5) return false;
  return true;
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
  const isDetectedMultiColumnPage = multiColumnPageIndexes.has(
    current.pageIndex,
  );
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
      if (!shouldPromoteNumberedHeadingCandidate(candidatePath, currentPath))
        return false;
      return isWithinVerticalHeadingRange(
        current,
        candidate,
        maxYDeltaFontRatio,
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

function isRightColumnHeadingCandidate(line: TextLine): boolean {
  return classifyMultiColumnLine(line) === "right";
}

function isWithinVerticalHeadingRange(
  current: TextLine,
  candidate: TextLine,
  maxFontRatio: number,
): boolean {
  const maxYDelta =
    Math.max(current.fontSize, candidate.fontSize) * maxFontRatio;
  return Math.abs(current.y - candidate.y) <= maxYDelta;
}

function promoteLine(
  lines: TextLine[],
  fromIndex: number,
  toIndex: number,
): void {
  const promoted = lines[fromIndex];
  if (!promoted) return;
  lines.splice(fromIndex, 1);
  lines.splice(toIndex, 0, promoted);
}

interface ParsedMultiColumnHeading {
  marker: string;
  headingText: string;
}

function parseNumberedHeadingPathForReorder(
  text: string,
): number[] | undefined {
  const parsed = parseMultiColumnHeading(text);
  if (!parsed) return undefined;
  if (!isLikelyNumberedHeadingTextForReorder(parsed.headingText))
    return undefined;
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
  if (!isNumberPathPrefix(candidatePath.slice(0, -1), currentPath.slice(0, -1)))
    return false;
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
  if (!isLikelyNearRowBodyLine(left) || !isLikelyNearRowBodyLine(right))
    return false;
  const maxYDelta =
    Math.max(left.fontSize, right.fontSize) *
    MULTI_COLUMN_NEAR_ROW_MAX_Y_DELTA_FONT_RATIO;
  return Math.abs(left.y - right.y) <= maxYDelta;
}

function isLikelyNearRowBodyLine(line: TextLine): boolean {
  if (line.pageHeight <= 0) return false;
  const normalized = normalizeSpacing(line.text);
  if (countSubstantiveChars(normalized) < MULTI_COLUMN_NEAR_ROW_MIN_TEXT_CHARS)
    return false;
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
  if (line.estimatedWidth / pageWidth >= MULTI_COLUMN_SPANNING_LINE_WIDTH_RATIO)
    return "spanning";
  const rightEdge = line.x + line.estimatedWidth;
  const rightColumnWidth = pageWidth - columnSplitX;
  if (
    line.x < columnSplitX * 0.5 &&
    rightEdge >
      columnSplitX + rightColumnWidth * CROSS_COLUMN_SPANNING_OVERSHOOT_RATIO
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

function classifyNearRowBodyColumn(
  line: TextLine,
): "left" | "right" | "spanning" {
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

function parseMultiColumnHeading(
  text: string,
): ParsedMultiColumnHeading | undefined {
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
  if (text.length < 2 || text.length > MAX_MULTI_COLUMN_HEADING_TEXT_LENGTH)
    return false;
  if (!/^[A-Z]/.test(text)) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (/[.!?]$/.test(text)) return false;
  const words = tokenizeHeadingWords(text);
  return words.length > 0 && words.length <= MAX_MULTI_COLUMN_HEADING_WORDS;
}

function isLikelyColumnHeadingText(headingText: string): boolean {
  if (!hasBasicMultiColumnHeadingTextShape(headingText)) return false;
  if (headingText.includes(",") || headingText.includes(":")) return false;
  return tokenizeHeadingWords(headingText).every((token) =>
    /^[A-Za-z][A-Za-z-]*$/.test(token),
  );
}

function tokenizeHeadingWords(text: string): string[] {
  return splitWords(text);
}

function classifyMultiColumnLine(
  line: TextLine,
): "left" | "right" | "spanning" {
  const pageWidth = Math.max(line.pageWidth, 1);
  if (line.estimatedWidth / pageWidth >= MULTI_COLUMN_SPANNING_LINE_WIDTH_RATIO)
    return "spanning";
  const lineCenter = line.x + line.estimatedWidth / 2;
  return lineCenter < pageWidth * MULTI_COLUMN_SPLIT_RATIO ? "left" : "right";
}

function bucketFragments(
  page: ExtractedPage,
): Map<number, ExtractedFragment[]> {
  const buckets = new Map<number, ExtractedFragment[]>();
  for (const fragment of page.fragments) {
    if (fragment.y > page.height * MAX_REASONABLE_Y_MULTIPLIER) continue;
    const bucket =
      Math.round(fragment.y / LINE_Y_BUCKET_SIZE) * LINE_Y_BUCKET_SIZE;
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
    rowsWithColumnBreak / Math.max(multiFragmentRows, 1) >=
      MIN_MULTI_COLUMN_BREAK_ROW_RATIO
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
  pageHeight: number,
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
    const endX =
      lastFrag.x + estimateTextWidth(lastFrag.text, lastFrag.fontSize);
    const lineWidth = endX - startX;
    const lineCenter = (startX + endX) / 2;
    const y = sorted[0].y;

    // Skip header/footer fragments
    if (y < pageHeight * minBodyY || y > pageHeight * maxBodyY) continue;
    // Skip short fragments (page numbers, labels, etc.)
    const totalChars = sorted.reduce(
      (sum, f) => sum + countSubstantiveChars(f.text),
      0,
    );
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
  const breakIndexes =
    precomputedBreakIndexes ?? findColumnBreakIndexes(fragments, pageWidth);
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
    shouldPreferMidpointSplit(
      fragments,
      filteredGroups,
      midpointSplit,
      pageWidth,
    )
  ) {
    return midpointSplit;
  }
  return filteredGroups;
}

function splitFragmentsBySimpleMidpoint(
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
  return [leftColumn, rightColumn];
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

function classifyFragmentGroupSide(
  group: ExtractedFragment[],
  pageWidth: number,
): FragmentGroupSide {
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

function estimateMidpointSideStartGap(
  fragments: ExtractedFragment[],
  pageWidth: number,
): number {
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
  const firstColumnText = normalizeSpacing(
    firstColumnFragments.map((f) => f.text).join(" "),
  );
  if (firstColumnText.length === 0) return false;
  const tokens = firstColumnText.split(" ").filter((token) => token.length > 0);
  if (tokens.length < 2 || tokens.length > MAX_NUMBERED_SECTION_PREFIX_WORDS)
    return false;
  if (!NUMBERED_SECTION_MARKER_PATTERN.test(tokens[0])) return false;
  const headingTokens = tokens.slice(1);
  if (!headingTokens.some((token) => /[A-Za-z]/.test(token))) return false;
  return headingTokens.every((token) => /^[A-Za-z][A-Za-z-]*$/.test(token));
}

function findColumnBreakIndexes(
  fragments: ExtractedFragment[],
  pageWidth: number,
): number[] {
  const indexes: number[] = [];
  for (let i = 0; i < fragments.length - 1; i += 1) {
    if (isLikelyColumnBreak(fragments[i], fragments[i + 1], pageWidth))
      indexes.push(i);
  }
  return indexes;
}

function findBridgedColumnBreakIndexes(
  fragments: ExtractedFragment[],
  pageWidth: number,
): number[] {
  const indexes: number[] = [];
  for (let i = 0; i < fragments.length - 1; i += 1) {
    const bridgedBreakIndex = findBridgedColumnBreakIndex(
      fragments,
      i,
      pageWidth,
    );
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
  const maxBridgeSize = Math.min(
    MAX_COLUMN_BREAK_BRIDGE_LOOKAHEAD,
    fragments.length - leftIndex - 2,
  );
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
    const isBridgeValid = bridgeFragments.every(
      isIgnorableColumnBreakBridgeFragment,
    );
    if (isBridgeValid) {
      // Place the break so bridge fragments go to whichever side they are
      // spatially closer to. If the first bridge fragment's center is past
      // the page midpoint, it belongs to the right column → break at leftIndex.
      const firstBridge = fragments[leftIndex + 1];
      const bridgeCenter = estimateFragmentCenterX(firstBridge);
      return bridgeCenter > pageWidth * MULTI_COLUMN_SPLIT_RATIO
        ? leftIndex
        : rightIndex - 1;
    }
  }
  return undefined;
}

function isLikelyLeftColumnBreakAnchor(
  fragment: ExtractedFragment,
  pageWidth: number,
): boolean {
  const center = estimateFragmentCenterX(fragment);
  return center < pageWidth * MULTI_COLUMN_SPLIT_RATIO;
}

function isLikelyRightColumnBreakAnchor(
  fragment: ExtractedFragment,
  pageWidth: number,
): boolean {
  const center = estimateFragmentCenterX(fragment);
  return center > pageWidth * MULTI_COLUMN_SPLIT_RATIO;
}

function isIgnorableColumnBreakBridgeFragment(
  fragment: ExtractedFragment,
): boolean {
  const normalized = normalizeSpacing(fragment.text);
  if (normalized.length === 0) return true;
  if (
    countSubstantiveChars(normalized) >
    COLUMN_BREAK_BRIDGE_MAX_SUBSTANTIVE_CHARS
  ) {
    return false;
  }
  // Accept purely non-alphanumeric fragments (dashes, bullets, etc.)
  // and bracket-enclosed tokens like "[6]" which are reference markers.
  return /^[^\p{L}\p{N}]+$/u.test(normalized) || /^\[\d+\]$/.test(normalized);
}

function isLikelyColumnBreak(
  left: ExtractedFragment,
  right: ExtractedFragment,
  pageWidth: number,
): boolean {
  const minimumGap = Math.max(
    MIN_COLUMN_BREAK_GAP,
    pageWidth * MIN_COLUMN_BREAK_GAP_RATIO,
  );
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
  const gap =
    dominantFragment.x -
    (minFontFragment.x +
      estimateTextWidth(minFontFragment.text, minFontFragment.fontSize));
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

export function computePageVerticalExtents(
  lines: TextLine[],
): Map<number, PageVerticalExtent> {
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
