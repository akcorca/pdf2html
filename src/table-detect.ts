// biome-ignore lint/nursery/noExcessiveLinesPerFile: table detection heuristics stay together for row-shape tuning.
import type { ExtractedDocument, ExtractedFragment, TextLine } from "./pdf-types.ts";
import { LINE_Y_BUCKET_SIZE } from "./pdf-types.ts";

const TABLE_CAPTION_PATTERN = /^Table\s+\d+[A-Za-z]?\s*[:.]?/iu;
const TABLE_CAPTION_MAX_FONT_DELTA = 1.5;

/** Minimum data rows (excluding header) to confirm a table. */
const MIN_TABLE_DATA_ROWS = 2;

/** Max vertical gap between consecutive table lines (in font-size multiples). */
const TABLE_MAX_VERTICAL_GAP_FONT_RATIO = 3.0;

/** Max vertical gap between caption end and first table body line. */
const TABLE_CAPTION_TO_BODY_MAX_GAP_FONT_RATIO = 4.0;

/** Minimum gap between fragment groups to count as a column separator (in pts). */
const MIN_COLUMN_GAP = 12;

/** Minimum number of rows with 2+ fragment-groups to consider tabular. */
const MIN_MULTI_GROUP_ROWS = 2;
const MIN_DATA_ROW_TEXT_CHARS = 10;

interface DetectedTable {
  captionStartIndex: number;
  captionText: string;
  captionLineIndexes: number[];
  headerRows: string[][];
  dataRows: string[][];
  nextIndex: number;
}

interface HorizontalBounds {
  minX: number;
  maxX: number;
}

/**
 * Detect a table starting at `startIndex`. Uses raw fragment x-positions
 * from the ExtractedDocument to identify column boundaries.
 */
export function detectTable(
  lines: TextLine[],
  startIndex: number,
  bodyFontSize: number,
  document?: ExtractedDocument,
): DetectedTable | undefined {
  if (!document) return undefined;

  const firstLine = lines[startIndex];
  const captionPage = firstLine.pageIndex;
  const page = document.pages[captionPage];
  if (!page) return undefined;

  if (TABLE_CAPTION_PATTERN.test(firstLine.text)) {
    return detectTableWithLeadingCaption(
      lines,
      startIndex,
      captionPage,
      firstLine,
      bodyFontSize,
      page.fragments,
    );
  }
  return detectTableWithTrailingCaption(
    lines,
    startIndex,
    captionPage,
    firstLine,
    bodyFontSize,
    page.fragments,
  );
}

// --- Caption collection ---

function detectTableWithLeadingCaption(
  lines: TextLine[],
  startIndex: number,
  captionPage: number,
  firstLine: TextLine,
  bodyFontSize: number,
  fragments: ExtractedFragment[],
): DetectedTable | undefined {
  const { captionText, captionLineIndexes, nextBodyIndex } =
    collectCaptionLines(lines, startIndex, captionPage, firstLine, fragments);
  const { bodyEntries, nextIndex } =
    collectTableBodyLines(lines, nextBodyIndex, captionPage, firstLine, fragments);

  const result = finalizeDetectedTable({
    startIndex,
    captionText,
    captionLineIndexes,
    bodyEntries,
    nextIndex,
    bodyFontSize,
    fragments,
  });
  return result;
}

function detectTableWithTrailingCaption(
  lines: TextLine[],
  startIndex: number,
  captionPage: number,
  firstLine: TextLine,
  bodyFontSize: number,
  fragments: ExtractedFragment[],
): DetectedTable | undefined {
  if (isLikelySectionHeading(firstLine.text)) return undefined;

  const firstRowGroups = getFragmentGroupsForRow(
    fragments,
    firstLine.y,
    firstLine.fontSize,
  );
  if (firstRowGroups.length < 2) return undefined;

  const { bodyEntries, nextIndex: captionStartIndex } = collectTableBodyLines(
    lines,
    startIndex,
    captionPage,
    firstLine,
    fragments,
  );
  if (bodyEntries.length < MIN_TABLE_DATA_ROWS) return undefined;

  const captionLine = lines[captionStartIndex];
  if (!captionLine || captionLine.pageIndex !== captionPage) return undefined;
  if (!TABLE_CAPTION_PATTERN.test(captionLine.text)) return undefined;

  const lastBodyLine = bodyEntries[bodyEntries.length - 1]?.line;
  if (!lastBodyLine) return undefined;
  const captionGap =
    Math.abs(lastBodyLine.y - captionLine.y) / Math.max(lastBodyLine.fontSize, 1);
  if (captionGap > TABLE_CAPTION_TO_BODY_MAX_GAP_FONT_RATIO) return undefined;

  const { captionText, captionLineIndexes, nextBodyIndex } = collectCaptionLines(
    lines,
    captionStartIndex,
    captionPage,
    captionLine,
    fragments,
  );

  return finalizeDetectedTable({
    startIndex,
    captionText,
    captionLineIndexes,
    bodyEntries,
    nextIndex: nextBodyIndex,
    bodyFontSize,
    fragments,
  });
}

function finalizeDetectedTable(input: {
  startIndex: number;
  captionText: string;
  captionLineIndexes: number[];
  bodyEntries: Array<{ index: number; line: TextLine }>;
  nextIndex: number;
  bodyFontSize: number;
  fragments: ExtractedFragment[];
}): DetectedTable | undefined {
  const {
    startIndex,
    captionText,
    captionLineIndexes,
    bodyEntries,
    nextIndex,
    bodyFontSize,
    fragments,
  } = input;
  if (bodyEntries.length < MIN_TABLE_DATA_ROWS) return undefined;

  const dedupeFontSize = bodyEntries[0]?.line.fontSize ?? bodyFontSize;
  const deduped = deduplicateByY(bodyEntries, dedupeFontSize);
  if (deduped.length < MIN_TABLE_DATA_ROWS) return undefined;

  const allParsedRows = removeCompletelyEmptyColumns(
    buildTableRows(deduped, bodyEntries, fragments, bodyFontSize),
  );
  if (allParsedRows.length < MIN_TABLE_DATA_ROWS + 1) return undefined;

  const [headerRow, ...parsedRows] = allParsedRows;
  if (!headerRow || parsedRows.length === 0) return undefined;

  const { headerRows, dataRows } = splitHeaderAndDataRows(headerRow, parsedRows);
  if (dataRows.length === 0) return undefined;

  realignSingleHeaderGapColumns(headerRows, dataRows);

  const compactedRows = removeCompletelyEmptyColumns([...headerRows, ...dataRows]);
  const headerRowCount = headerRows.length;
  const normalizedHeaderRows = compactedRows.slice(0, headerRowCount);
  const normalizedDataRows = compactedRows.slice(headerRowCount);
  if (normalizedDataRows.length === 0) return undefined;

  normalizeColumnCount([...normalizedHeaderRows, ...normalizedDataRows]);

  return {
    captionStartIndex: startIndex,
    captionText: captionText.trim(),
    captionLineIndexes,
    headerRows: normalizedHeaderRows,
    dataRows: normalizedDataRows,
    nextIndex,
  };
}

function splitHeaderAndDataRows(
  headerRow: string[],
  parsedRows: string[][],
): { headerRows: string[][]; dataRows: string[][] } {
  const { subHeaderRows, dataRows } = collectLeadingSubHeaderRows(parsedRows);
  const normalizedHeaderRows = collapseComplementaryHeaderRows([
    sanitizeHeaderCells(headerRow),
    ...subHeaderRows,
  ]);
  const filteredDataRows = removeHeaderDuplicateDataRows(dataRows, normalizedHeaderRows);
  return promoteWrappedLeadingDataRowsIntoHeader(
    normalizedHeaderRows,
    filteredDataRows,
  );
}

function collectLeadingSubHeaderRows(parsedRows: string[][]): {
  subHeaderRows: string[][];
  dataRows: string[][];
} {
  let subHeaderCount = 0;
  while (
    subHeaderCount + 1 < parsedRows.length &&
    isLikelySubHeaderRow(parsedRows[subHeaderCount], parsedRows[subHeaderCount + 1])
  ) {
    subHeaderCount += 1;
  }

  return {
    subHeaderRows: parsedRows.slice(0, subHeaderCount).map(sanitizeHeaderCells),
    dataRows: parsedRows.slice(subHeaderCount),
  };
}

function removeHeaderDuplicateDataRows(
  dataRows: string[][],
  headerRows: string[][],
): string[][] {
  const headerRowKeys = new Set(headerRows.map(buildComparableRowKey));
  return dataRows.filter((row) => {
    if (isLikelyNumericDataRow(row)) return true;
    return !headerRowKeys.has(buildComparableRowKey(sanitizeHeaderCells(row)));
  });
}

function promoteWrappedLeadingDataRowsIntoHeader(
  headerRows: string[][],
  dataRows: string[][],
): { headerRows: string[][]; dataRows: string[][] } {
  if (!shouldPromoteWrappedLeadingDataRows(headerRows, dataRows)) {
    return { headerRows, dataRows };
  }

  const leadingHeader =
    getSingleNonEmptyHeaderCellText(headerRows[0] ?? []) ?? "";
  const mergedWrappedHeaderRow = mergeWrappedHeaderRows(dataRows[0], dataRows[1]);
  const promotedHeaderRow = sanitizeHeaderCells([
    leadingHeader,
    ...mergedWrappedHeaderRow,
  ]);
  const alignedDataRows = dataRows.slice(2).map((row) => ["", ...row]);
  return { headerRows: [promotedHeaderRow], dataRows: alignedDataRows };
}

function shouldPromoteWrappedLeadingDataRows(
  headerRows: string[][],
  dataRows: string[][],
): boolean {
  if (headerRows.length !== 1 || dataRows.length < 3) return false;

  const baseHeaderRow = headerRows[0] ?? [];
  const headerLead = getSingleNonEmptyHeaderCellText(baseHeaderRow);
  if (headerLead === undefined) return false;

  const wrappedHeaderRow = dataRows[0];
  const wrappedContinuationRow = dataRows[1];
  const firstBodyRow = dataRows[2];
  if (!wrappedHeaderRow || !wrappedContinuationRow || !firstBodyRow) return false;
  if (wrappedHeaderRow.length < 4) return false;
  if (wrappedHeaderRow.length !== wrappedContinuationRow.length) return false;

  if (normalizeTableCell(wrappedHeaderRow[0] ?? "").length > 0) return false;
  if (normalizeTableCell(wrappedContinuationRow[0] ?? "").length > 0)
    return false;

  if (wrappedHeaderRow.slice(1).some(isNumericLikeDataCell)) return false;
  if (wrappedContinuationRow.slice(1).some(isNumericLikeDataCell)) return false;

  return hasMostlyNumericBodyCells(firstBodyRow.slice(1));
}

function getSingleNonEmptyHeaderCellText(row: string[]): string | undefined {
  const nonEmptyCells = row
    .map((cell) => normalizeTableCell(cell))
    .filter((cell) => cell.length > 0);
  if (nonEmptyCells.length !== 1) return undefined;
  return nonEmptyCells[0];
}

function hasMostlyNumericBodyCells(cells: string[]): boolean {
  const nonEmptyCells = cells.filter((cell) => cell.trim().length > 0);
  if (nonEmptyCells.length < 3) return false;

  const numericLikeCellCount = nonEmptyCells.filter(isNumericLikeDataCell).length;
  return numericLikeCellCount >= Math.max(2, nonEmptyCells.length - 1);
}

function mergeWrappedHeaderRows(firstRow: string[], secondRow: string[]): string[] {
  const merged: string[] = [];
  const maxColumnCount = Math.max(firstRow.length, secondRow.length);

  for (let index = 0; index < maxColumnCount; index += 1) {
    const topCell = normalizeTableCell(firstRow[index] ?? "");
    const bottomCell = normalizeTableCell(secondRow[index] ?? "");
    merged.push(mergeWrappedHeaderCellPair(topCell, bottomCell));
  }

  return merged;
}

function mergeWrappedHeaderCellPair(topCell: string, bottomCell: string): string {
  if (topCell.length === 0) return bottomCell;
  if (bottomCell.length === 0) return topCell;
  if (topCell.endsWith("-")) return `${topCell}${bottomCell}`;
  return `${topCell} ${bottomCell}`;
}

function normalizeTableCell(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function collapseComplementaryHeaderRows(headerRows: string[][]): string[][] {
  if (headerRows.length < 2) return headerRows;

  const maxCols = Math.max(...headerRows.map((row) => row.length));
  if (maxCols < 2) return headerRows;

  const nonEmptyCountByRow = countNonEmptyCellsByRow(headerRows);
  if (nonEmptyCountByRow.some((count) => count === 0)) return headerRows;
  if (nonEmptyCountByRow.some((count) => count >= maxCols)) return headerRows;
  if (hasOverlappingNonEmptyColumns(headerRows, maxCols)) return headerRows;

  const collapsedRow = buildCollapsedHeaderRow(headerRows, maxCols);

  const collapsedNonEmptyCount = countNonEmptyCells(collapsedRow);
  const maxRowNonEmptyCount = Math.max(...nonEmptyCountByRow);
  if (collapsedNonEmptyCount <= maxRowNonEmptyCount) return headerRows;
  if (!collapsedRow.some((cell) => isHeaderTextLikeCell(cell))) return headerRows;
  return [collapsedRow];
}

function countNonEmptyCells(row: string[]): number {
  return row.filter((cell) => cell.trim().length > 0).length;
}

function countNonEmptyCellsByRow(rows: string[][]): number[] {
  return rows.map(countNonEmptyCells);
}

function hasOverlappingNonEmptyColumns(rows: string[][], maxCols: number): boolean {
  const nonEmptyCountByColumn = new Array(maxCols).fill(0);
  for (const row of rows) {
    for (let columnIndex = 0; columnIndex < maxCols; columnIndex += 1) {
      const value = row[columnIndex]?.trim() ?? "";
      if (value.length === 0) continue;
      nonEmptyCountByColumn[columnIndex] += 1;
    }
  }
  return nonEmptyCountByColumn.some((count) => count > 1);
}

function buildCollapsedHeaderRow(rows: string[][], maxCols: number): string[] {
  const collapsedRow = new Array(maxCols).fill("");
  for (let columnIndex = 0; columnIndex < maxCols; columnIndex += 1) {
    for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
      const value = rows[rowIndex]?.[columnIndex]?.trim() ?? "";
      if (value.length === 0) continue;
      collapsedRow[columnIndex] = value;
      break;
    }
  }
  return collapsedRow;
}

function removeCompletelyEmptyColumns(rows: string[][]): string[][] {
  if (rows.length < 2) return rows;

  const colCount = Math.max(...rows.map((row) => row.length));
  if (colCount === 0) return rows;

  const nonEmptyColumns = new Array(colCount).fill(false);
  for (const row of rows) {
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (row[columnIndex]?.trim()) nonEmptyColumns[columnIndex] = true;
    }
  }

  if (nonEmptyColumns.every(Boolean)) return rows;
  return rows.map((row) => row.filter((_, columnIndex) => nonEmptyColumns[columnIndex]));
}

function isLikelySubHeaderRow(row: string[], nextRow: string[]): boolean {
  const nonEmptyCells = row.filter((cell) => cell.trim().length > 0);
  if (nonEmptyCells.length < 2) return false;

  const textLikeCellCount = nonEmptyCells.filter(isHeaderTextLikeCell).length;
  if (textLikeCellCount < 2) return false;

  const numericLikeCellCount = nonEmptyCells.length - textLikeCellCount;
  if (numericLikeCellCount > 1) return false;

  return isLikelyNumericDataRow(nextRow);
}

function isLikelyNumericDataRow(row: string[]): boolean {
  const nonEmptyCells = row.filter((cell) => cell.trim().length > 0);
  if (nonEmptyCells.length < 2) return false;
  const numericLikeCount = nonEmptyCells.filter(isNumericLikeDataCell).length;
  return numericLikeCount >= Math.max(2, Math.floor(nonEmptyCells.length * 0.6));
}

function isHeaderTextLikeCell(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return /[A-Za-z]/u.test(trimmed) && !isNumericLikeDataCell(trimmed);
}

function isNumericLikeDataCell(value: string): boolean {
  return /^[+-]?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?%?$/u.test(value.trim());
}

function buildComparableRowKey(row: string[]): string {
  return row.map((cell) => cell.trim().toLowerCase()).join("\u241f");
}

function sanitizeHeaderCells(row: string[]): string[] {
  return row.map((cell) => {
    const trimmed = cell.trim();
    if (!/[A-Za-z]/u.test(trimmed)) return trimmed;
    return trimmed.replace(/(?:\s+\d{1,2})+$/u, "");
  });
}

function realignSingleHeaderGapColumns(
  headerRows: string[][],
  dataRows: string[][],
): void {
  if (headerRows.length !== 1 || dataRows.length < MIN_TABLE_DATA_ROWS) return;

  const mergedRows = [...headerRows, ...dataRows];
  normalizeColumnCount(mergedRows);
  const headerRow = headerRows[0];
  const columnCount = headerRow.length;
  if (columnCount < 4) return;

  const sparseThreshold = Math.max(1, Math.floor(dataRows.length * 0.15));
  const denseThreshold = Math.max(2, Math.ceil(dataRows.length * 0.6));

  for (let columnIndex = 1; columnIndex <= columnCount - 3; columnIndex += 1) {
    if (!isSingleGapHeaderShiftCandidate(headerRow, columnIndex)) continue;
    if (
      !hasShiftedDataDensityPattern(
        dataRows,
        columnIndex,
        sparseThreshold,
        denseThreshold,
      )
    ) {
      continue;
    }
    moveHeaderCellRight(headerRow, columnIndex);
  }
}

function countNonEmptyCellsInColumn(rows: string[][], columnIndex: number): number {
  let count = 0;
  for (const row of rows) {
    if ((row[columnIndex]?.trim().length ?? 0) > 0) {
      count += 1;
    }
  }
  return count;
}

function isSingleGapHeaderShiftCandidate(
  headerRow: string[],
  columnIndex: number,
): boolean {
  const previousHeader = headerRow[columnIndex - 1]?.trim() ?? "";
  const headerCell = headerRow[columnIndex]?.trim() ?? "";
  const nextHeader = headerRow[columnIndex + 1]?.trim() ?? "";
  const afterNextHeader = headerRow[columnIndex + 2]?.trim() ?? "";

  return (
    previousHeader.length > 0 &&
    headerCell.length > 0 &&
    nextHeader.length === 0 &&
    afterNextHeader.length > 0 &&
    isHeaderTextLikeCell(headerCell)
  );
}

function hasShiftedDataDensityPattern(
  dataRows: string[][],
  columnIndex: number,
  sparseThreshold: number,
  denseThreshold: number,
): boolean {
  const currentColumnFill = countNonEmptyCellsInColumn(dataRows, columnIndex);
  const nextColumnFill = countNonEmptyCellsInColumn(dataRows, columnIndex + 1);
  const afterNextColumnFill = countNonEmptyCellsInColumn(dataRows, columnIndex + 2);

  return (
    currentColumnFill <= sparseThreshold &&
    nextColumnFill >= denseThreshold &&
    afterNextColumnFill >= denseThreshold
  );
}

function moveHeaderCellRight(headerRow: string[], columnIndex: number): void {
  const headerCell = headerRow[columnIndex]?.trim() ?? "";
  if (headerCell.length === 0) return;
  headerRow[columnIndex] = "";
  headerRow[columnIndex + 1] = headerCell;
}

function normalizeColumnCount(rows: string[][]): void {
  const maxCols = Math.max(...rows.map((row) => row.length));
  for (const row of rows) {
    while (row.length < maxCols) row.push("");
  }
}

function collectCaptionLines(
  lines: TextLine[],
  startIndex: number,
  captionPage: number,
  firstLine: TextLine,
  fragments: ExtractedFragment[],
): { captionText: string; captionLineIndexes: number[]; nextBodyIndex: number } {
  const captionLineIndexes: number[] = [startIndex];
  const captionParts: string[] = [firstLine.text];
  let nextIdx = startIndex + 1;
  const captionBounds = firstLine.column !== undefined ? getCaptionBounds(firstLine) : undefined;

  while (nextIdx < lines.length) {
    const line = lines[nextIdx];
    const previousLine = lines[nextIdx - 1];
    if (
      !isCaptionContinuationLine({
        line,
        previousLine,
        captionPage,
        firstLine,
        fragments,
        captionBounds,
      })
    ) {
      break;
    }

    captionLineIndexes.push(nextIdx);
    captionParts.push(line.text);
    nextIdx += 1;
  }

  return {
    captionText: captionParts.join(" "),
    captionLineIndexes,
    nextBodyIndex: nextIdx,
  };
}

function isCaptionContinuationLine(input: {
  line: TextLine;
  previousLine: TextLine;
  captionPage: number;
  firstLine: TextLine;
  fragments: ExtractedFragment[];
  captionBounds: HorizontalBounds | undefined;
}): boolean {
  const { line, previousLine, captionPage, firstLine, fragments, captionBounds } = input;

  if (line.pageIndex !== captionPage) return false;

  const verticalGap = Math.abs(previousLine.y - line.y) / firstLine.fontSize;
  if (verticalGap > TABLE_CAPTION_TO_BODY_MAX_GAP_FONT_RATIO) return false;
  if (!isCaptionLineHorizontallyAligned(firstLine, line)) return false;

  const fragmentGroups = getFragmentGroupsForRow(
    fragments,
    line.y,
    line.fontSize,
    captionBounds,
  );
  if (fragmentGroups.length >= 2) return false;

  return Math.abs(line.fontSize - firstLine.fontSize) < TABLE_CAPTION_MAX_FONT_DELTA;
}

function isCaptionLineHorizontallyAligned(firstLine: TextLine, line: TextLine): boolean {
  if (firstLine.column === undefined || line.column !== firstLine.column) return true;
  const leftOffset = Math.abs(line.x - firstLine.x);
  return leftOffset <= Math.max(firstLine.fontSize * 3, 24);
}

// --- Table body collection ---

function collectTableBodyLines(
  lines: TextLine[],
  startIdx: number,
  captionPage: number,
  firstLine: TextLine,
  fragments: ExtractedFragment[],
): { bodyEntries: Array<{ index: number; line: TextLine }>; nextIndex: number } {
  const bodyEntries: Array<{ index: number; line: TextLine }> = [];
  const previousLine = startIdx > 0 ? lines[startIdx - 1] : undefined;
  let lastY = previousLine?.pageIndex === captionPage ? previousLine.y : firstLine.y;
  let nextIdx = startIdx;

  while (nextIdx < lines.length) {
    const line = lines[nextIdx];
    if (shouldStopCollectingTableBodyLine(line, captionPage, lastY, firstLine, fragments)) break;

    bodyEntries.push({ index: nextIdx, line });
    lastY = line.y;
    nextIdx++;
  }

  return { bodyEntries, nextIndex: nextIdx };
}

function shouldStopCollectingTableBodyLine(
  line: TextLine,
  captionPage: number,
  lastY: number,
  firstLine: TextLine,
  fragments: ExtractedFragment[],
): boolean {
  if (line.pageIndex !== captionPage) return true;

  const vertGap = Math.abs(lastY - line.y) / firstLine.fontSize;
  if (vertGap > TABLE_MAX_VERTICAL_GAP_FONT_RATIO) return true;

  if (isLikelySectionHeading(line.text)) return true;
  if (TABLE_CAPTION_PATTERN.test(line.text)) return true;

  if (line.estimatedWidth <= line.pageWidth * 0.65) return false;
  const rowFragGroups = getFragmentGroupsForRow(fragments, line.y, line.fontSize);
  return rowFragGroups.length < 2;
}

// --- Row building from fragment analysis ---

function buildTableRows(
  deduped: Array<{ index: number; line: TextLine }>,
  allEntries: Array<{ index: number; line: TextLine }>,
  fragments: ExtractedFragment[],
  bodyFontSize: number,
): string[][] {
  // Get fragment groups for each row
  const rowFragGroupsList: Array<{ groups: FragmentGroup[]; line: TextLine }> = [];
  for (const { line } of deduped) {
    rowFragGroupsList.push({
      groups: getRowFragmentGroups(fragments, line, allEntries),
      line,
    });
  }

  // Need enough multi-column rows
  const multiGroupRows = rowFragGroupsList.filter((r) => r.groups.length >= 2);
  if (multiGroupRows.length < MIN_MULTI_GROUP_ROWS) return [];

  // Determine column boundaries from fragment x-positions
  const allGroupStartXs: number[] = [];
  const rowsToDetermineColumns = chooseRowsForColumnDetection(multiGroupRows);
  for (const { groups } of rowsToDetermineColumns) {
    for (const g of groups) {
      allGroupStartXs.push(g.startX);
    }
  }

  const columnXs = clusterValues(allGroupStartXs, MIN_COLUMN_GAP * 0.7);
  if (columnXs.length < 2) return [];

  // Parse rows into cells, merging superscript lines
  return mergeHeaderContinuationRows(
    parseRowCells(refineFragmentGroups(rowFragGroupsList, columnXs), columnXs, bodyFontSize),
  );
}

function getRowFragmentGroups(
  fragments: ExtractedFragment[],
  line: TextLine,
  allEntries: Array<{ index: number; line: TextLine }>,
): FragmentGroup[] {
  const allGroups = getFragmentGroupsForRow(fragments, line.y, line.fontSize);
  if (line.column === undefined) return allGroups;

  const rowBounds = estimateRowBounds(allEntries, line);
  if (!rowBounds) return allGroups;

  const boundedGroups = getFragmentGroupsForRow(
    fragments,
    line.y,
    line.fontSize,
    rowBounds,
  );
  return boundedGroups.length > 0 ? boundedGroups : allGroups;
}

function chooseRowsForColumnDetection(
  rows: Array<{ groups: FragmentGroup[]; line: TextLine }>,
): Array<{ groups: FragmentGroup[]; line: TextLine }> {
  const dataLikeRows = rows.filter(({ groups }) => isLikelyDataLikeGroupRow(groups));
  return dataLikeRows.length >= MIN_TABLE_DATA_ROWS ? dataLikeRows : rows;
}

function isLikelyDataLikeGroupRow(groups: FragmentGroup[]): boolean {
  const cellTexts = groups.map((group) => group.text);
  if (!isLikelyNumericDataRow(cellTexts)) return false;
  const totalChars = cellTexts.reduce((sum, text) => sum + text.length, 0);
  return totalChars > MIN_DATA_ROW_TEXT_CHARS;
}

function refineFragmentGroups(
  rowFragGroupsList: Array<{ groups: FragmentGroup[]; line: TextLine }>,
  columnXs: number[],
): Array<{ groups: FragmentGroup[]; line: TextLine }> {
  const avgColWidth = calculateAverageColumnWidth(columnXs);
  return rowFragGroupsList.map((row) => {
    const refinedGroups = refineRowFragmentGroups(row.groups, columnXs, avgColWidth);
    return refinedGroups ? { ...row, groups: refinedGroups } : row;
  });
}

function refineRowFragmentGroups(
  groups: FragmentGroup[],
  columnXs: number[],
  avgColWidth: number,
): FragmentGroup[] | undefined {
  if (groups.length >= columnXs.length || groups.length === 0) return undefined;

  const refinedGroups: FragmentGroup[] = [];
  let didRefine = false;
  for (const group of groups) {
    if (!shouldSplitFragmentGroup(group, avgColWidth)) {
      refinedGroups.push(group);
      continue;
    }

    const splitGroups = splitFragmentGroup(group, columnXs);
    if (splitGroups.length <= 1) {
      refinedGroups.push(group);
      continue;
    }
    refinedGroups.push(...splitGroups);
    didRefine = true;
  }

  if (!didRefine) return undefined;
  return refinedGroups.sort((left, right) => left.startX - right.startX);
}

function shouldSplitFragmentGroup(group: FragmentGroup, avgColWidth: number): boolean {
  const groupWidth = group.endX - group.startX;
  if (group.fragments.length <= 1) return false;
  return groupWidth >= avgColWidth * 1.5;
}

function calculateAverageColumnWidth(columnXs: number[]): number {
  if (columnXs.length < 2) return 0;
  let totalWidth = 0;
  for (let i = 1; i < columnXs.length; i++) {
    totalWidth += columnXs[i] - columnXs[i - 1];
  }
  return totalWidth / (columnXs.length - 1);
}

function splitFragmentGroup(group: FragmentGroup, columnXs: number[]): FragmentGroup[] {
  const newGroups: ExtractedFragment[][] = Array.from({ length: columnXs.length }, () => []);

  for (const frag of group.fragments) {
    const nearestColumnIndex = findNearestColumnIndex(frag.x, columnXs);
    newGroups[nearestColumnIndex].push(frag);
  }

  const resultGroups: FragmentGroup[] = [];
  for (const frags of newGroups) {
    if (frags.length === 0) continue;
    const sortedFrags = frags.sort((a, b) => a.x - b.x);
    const startX = sortedFrags[0].x;
    const endX = estimateFragmentEndX(sortedFrags[sortedFrags.length - 1]);
    resultGroups.push({
      startX,
      endX,
      text: sortedFrags.map((f) => f.text).join(" ").trim(),
      fragments: sortedFrags,
    });
  }

  return resultGroups.filter((entry) => entry.text.length > 0);
}

function parseRowCells(
  rowFragGroupsList: Array<{ groups: FragmentGroup[]; line: TextLine }>,
  columnXs: number[],
  bodyFontSize: number,
): string[][] {
  const allParsedRows: string[][] = [];
  const normalFontThreshold = bodyFontSize * 0.78;
  let pendingSuperscriptTexts: string[] = [];

  for (const { groups, line } of rowFragGroupsList) {
    if (line.fontSize < normalFontThreshold) {
      pendingSuperscriptTexts.push(line.text);
      continue;
    }

    pendingSuperscriptTexts = appendPendingSuperscriptsToLastRow(
      allParsedRows,
      pendingSuperscriptTexts,
    );

    allParsedRows.push(assignFragmentGroupsToCells(groups, columnXs));
  }

  // Flush trailing superscripts
  appendPendingSuperscriptsToLastRow(allParsedRows, pendingSuperscriptTexts);

  return allParsedRows;
}

function appendPendingSuperscriptsToLastRow(
  rows: string[][],
  pendingSuperscriptTexts: string[],
): string[] {
  if (pendingSuperscriptTexts.length === 0 || rows.length === 0) return pendingSuperscriptTexts;
  const lastRow = rows[rows.length - 1];
  lastRow[lastRow.length - 1] += ` ${pendingSuperscriptTexts.join(" ")}`;
  return [];
}

function mergeHeaderContinuationRows(rows: string[][]): string[][] {
  if (rows.length < 2) return rows;
  const mergedRows = [rows[0]];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const header = mergedRows[0];
    if (!header || !isHeaderContinuationRow(header, row)) {
      mergedRows.push(row);
      continue;
    }

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const value = row[columnIndex]?.trim() ?? "";
      if (value.length === 0) continue;
      const headerValue = header[columnIndex]?.trim() ?? "";
      header[columnIndex] = headerValue.length > 0 ? `${headerValue} ${value}` : value;
    }
  }

  return mergedRows;
}

function isHeaderContinuationRow(header: string[], row: string[]): boolean {
  const textColumnIndexes: number[] = [];
  let nonEmptyCount = 0;

  for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
    const value = row[columnIndex]?.trim() ?? "";
    if (value.length === 0) continue;
    nonEmptyCount += 1;
    if (isHeaderNumericMarker(value)) continue;
    textColumnIndexes.push(columnIndex);
  }

  if (textColumnIndexes.length !== 1) return false;
  if (nonEmptyCount > 2) return false;

  const textColumnIndex = textColumnIndexes[0];
  const textValue = row[textColumnIndex]?.trim() ?? "";
  if (textValue.length > 28) return false;
  if (!/^[A-Z]/u.test(textValue)) return false;
  return (header[textColumnIndex]?.trim().length ?? 0) > 0;
}

function isHeaderNumericMarker(value: string): boolean {
  return /^\d{1,2}$/.test(value);
}

// --- Fragment grouping ---

interface FragmentGroup {
  startX: number;
  endX: number;
  text: string;
  fragments: ExtractedFragment[];
}

interface PendingFragmentGroup {
  frags: ExtractedFragment[];
  startX: number;
  lastEndX: number;
}

/**
 * Find fragments on the page at a given y-bucket, group nearby fragments
 * into column groups separated by large horizontal gaps.
 */
function getFragmentGroupsForRow(
  fragments: ExtractedFragment[],
  y: number,
  fontSize: number,
  bounds?: HorizontalBounds,
): FragmentGroup[] {
  const yTolerance = Math.max(LINE_Y_BUCKET_SIZE, fontSize * 0.5);
  const rowFrags = fragments.filter(
    (f) => {
      if (Math.abs(f.y - y) > yTolerance) return false;
      if (!bounds) return true;
      return isFragmentCenterWithinBounds(f, bounds);
    },
  );

  if (rowFrags.length === 0) return [];

  const sorted = [...rowFrags].sort((a, b) => a.x - b.x);

  const groups: FragmentGroup[] = [];
  let currentGroup: PendingFragmentGroup = {
    frags: [sorted[0]],
    startX: sorted[0].x,
    lastEndX: estimateFragmentEndX(sorted[0]),
  };

  for (let i = 1; i < sorted.length; i++) {
    const frag = sorted[i];
    const gap = frag.x - currentGroup.lastEndX;

    if (gap > MIN_COLUMN_GAP) {
      groups.push(buildFragmentGroup(currentGroup));
      currentGroup = {
        frags: [frag],
        startX: frag.x,
        lastEndX: estimateFragmentEndX(frag),
      };
    } else {
      currentGroup.frags.push(frag);
      currentGroup.lastEndX = Math.max(currentGroup.lastEndX, estimateFragmentEndX(frag));
    }
  }

  groups.push(buildFragmentGroup(currentGroup));

  return groups;
}

function buildFragmentGroup(group: PendingFragmentGroup): FragmentGroup {
  return {
    startX: group.startX,
    endX: group.lastEndX,
    text: group.frags.map((fragment) => fragment.text).join(" ").trim(),
    fragments: group.frags,
  };
}

function estimateRowBounds(
  entries: Array<{ index: number; line: TextLine }>,
  targetLine: TextLine,
): HorizontalBounds | undefined {
  const yTolerance = Math.max(LINE_Y_BUCKET_SIZE, targetLine.fontSize * 0.5);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let matched = 0;

  for (const { line } of entries) {
    if (Math.abs(line.y - targetLine.y) > yTolerance) continue;
    const estimatedWidth = Math.max(line.estimatedWidth, line.fontSize);
    minX = Math.min(minX, line.x);
    maxX = Math.max(maxX, line.x + estimatedWidth);
    matched += 1;
  }
  if (matched === 0 || !Number.isFinite(minX) || !Number.isFinite(maxX) || maxX <= minX) return undefined;

  const horizontalPadding = Math.max(targetLine.fontSize * 1.6, 8);
  return {
    minX: Math.max(0, minX - horizontalPadding),
    maxX: maxX + horizontalPadding,
  };
}

function getCaptionBounds(firstLine: TextLine): HorizontalBounds {
  const estimatedWidth = Math.max(firstLine.estimatedWidth, firstLine.fontSize);
  const horizontalPadding = Math.max(firstLine.fontSize * 1.2, 6);
  return {
    minX: Math.max(0, firstLine.x - horizontalPadding),
    maxX: firstLine.x + estimatedWidth + horizontalPadding,
  };
}

function estimateFragmentEndX(frag: ExtractedFragment): number {
  return frag.x + frag.text.length * frag.fontSize * 0.5;
}

function isFragmentCenterWithinBounds(
  fragment: ExtractedFragment,
  bounds: HorizontalBounds,
): boolean {
  const endX = estimateFragmentEndX(fragment);
  const centerX = (fragment.x + endX) / 2;
  const tolerance = Math.max(fragment.fontSize * 0.4, 2);
  return centerX >= bounds.minX - tolerance && centerX <= bounds.maxX + tolerance;
}

/**
 * Cluster a set of numeric values into groups, returning the median of each cluster.
 */
function clusterValues(values: number[], tolerance: number): number[] {
  if (values.length === 0) return [];

  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const lastCluster = clusters[clusters.length - 1];
    const clusterMedian = lastCluster[Math.floor(lastCluster.length / 2)];
    if (sorted[i] - clusterMedian <= tolerance) {
      lastCluster.push(sorted[i]);
    } else {
      clusters.push([sorted[i]]);
    }
  }

  return clusters.map((c) => c[Math.floor(c.length / 2)]);
}

function assignFragmentGroupsToCells(
  groups: FragmentGroup[],
  columnXs: number[],
): string[] {
  const cells: string[] = new Array(columnXs.length).fill("");

  for (const group of groups) {
    const nearestColumnIndex = findNearestColumnIndex(group.startX, columnXs);
    const currentCellText = cells[nearestColumnIndex];
    cells[nearestColumnIndex] = currentCellText
      ? `${currentCellText} ${group.text}`
      : group.text;
  }

  return cells;
}

function findNearestColumnIndex(value: number, columns: number[]): number {
  let nearestIndex = 0;
  let nearestDistance = Math.abs(value - columns[0]);

  for (let index = 1; index < columns.length; index += 1) {
    const candidateDistance = Math.abs(value - columns[index]);
    if (candidateDistance < nearestDistance) {
      nearestDistance = candidateDistance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

function deduplicateByY(
  entries: Array<{ index: number; line: TextLine }>,
  fontSize: number,
): Array<{ index: number; line: TextLine }> {
  const yTolerance = Math.max(LINE_Y_BUCKET_SIZE, fontSize * 0.3);
  const result: Array<{ index: number; line: TextLine }> = [];
  let lastY: number | undefined;

  for (const entry of entries) {
    if (lastY !== undefined && Math.abs(entry.line.y - lastY) <= yTolerance) {
      continue;
    }
    result.push(entry);
    lastY = entry.line.y;
  }
  return result;
}

function isLikelySectionHeading(text: string): boolean {
  return (
    /^\d+(?:\.\d+)*\s+[A-Z]/.test(text) ||
    /^(?:Abstract|Introduction|Conclusion|References|Acknowledgements)/i.test(text)
  );
}

/**
 * Render a detected table as HTML lines.
 */
export function renderTableHtml(table: DetectedTable): string[] {
  const out: string[] = [];
  out.push("<table>");
  out.push(`<caption>${esc(table.captionText)}</caption>`);

  if (table.headerRows.length > 0) {
    out.push("<thead>");
    for (const row of table.headerRows) {
      out.push(`<tr>${row.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`);
    }
    out.push("</thead>");
  }

  if (table.dataRows.length > 0) {
    out.push("<tbody>");
    const uniqueRows = new Set<string>();
    for (const row of table.dataRows) {
      const rowString = JSON.stringify(row);
      if (uniqueRows.has(rowString)) {
        continue;
      }
      uniqueRows.add(rowString);
      out.push(`<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`);
    }
    out.push("</tbody>");
  }

  out.push("</table>");
  return out;
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
