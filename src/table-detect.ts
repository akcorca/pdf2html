// biome-ignore lint/nursery/noExcessiveLinesPerFile: table detection heuristics stay together for row-shape tuning.
import type { ExtractedDocument, ExtractedFragment, TextLine } from "./pdf-types.ts";
import { LINE_Y_BUCKET_SIZE } from "./pdf-types.ts";

const TABLE_CAPTION_PATTERN = /^Table\s+\d+[A-Za-z]?\s*[:.]?/iu;

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

  const firstRowGroups = getFragmentGroupsForRow(fragments, firstLine.y, firstLine.fontSize);
  if (firstRowGroups.length < 2) return undefined;

  const { bodyEntries, nextIndex: captionStartIndex } =
    collectTableBodyLines(lines, startIndex, captionPage, firstLine, fragments);
  if (bodyEntries.length < MIN_TABLE_DATA_ROWS) return undefined;

  const captionLine = lines[captionStartIndex];
  if (!captionLine || captionLine.pageIndex !== captionPage) return undefined;
  if (!TABLE_CAPTION_PATTERN.test(captionLine.text)) return undefined;

  const lastBodyLine = bodyEntries[bodyEntries.length - 1]?.line;
  if (!lastBodyLine) return undefined;
  const captionGap = Math.abs(lastBodyLine.y - captionLine.y) / Math.max(lastBodyLine.fontSize, 1);
  if (captionGap > TABLE_CAPTION_TO_BODY_MAX_GAP_FONT_RATIO) return undefined;

  const { captionText, captionLineIndexes, nextBodyIndex } =
    collectCaptionLines(lines, captionStartIndex, captionPage, captionLine, fragments);

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
  const { startIndex, captionText, captionLineIndexes, bodyEntries, nextIndex, bodyFontSize, fragments } =
    input;
  if (bodyEntries.length < MIN_TABLE_DATA_ROWS) return undefined;

  const dedupeFontSize = bodyEntries[0]?.line.fontSize ?? bodyFontSize;
  const deduped = deduplicateByY(bodyEntries, dedupeFontSize);
  if (deduped.length < MIN_TABLE_DATA_ROWS) return undefined;

  const allParsedRows = buildTableRows(deduped, bodyEntries, fragments, bodyFontSize);
  if (allParsedRows.length < MIN_TABLE_DATA_ROWS + 1) return undefined;

  const [headerRow, ...dataRows] = allParsedRows;
  if (!headerRow || dataRows.length === 0) return undefined;
  const sanitizedHeaderRow = sanitizeHeaderCells(headerRow);

  normalizeColumnCount([sanitizedHeaderRow, ...dataRows]);

  return {
    captionStartIndex: startIndex,
    captionText: captionText.trim(),
    captionLineIndexes,
    headerRows: [sanitizedHeaderRow],
    dataRows,
    nextIndex,
  };
}

function sanitizeHeaderCells(row: string[]): string[] {
  return row.map((cell) => {
    const trimmed = cell.trim();
    if (!/[A-Za-z]/u.test(trimmed)) return trimmed;
    return trimmed.replace(/(?:\s+\d{1,2})+$/u, "");
  });
}

function normalizeColumnCount(rows: string[][]): void {
  const maxCols = Math.max(...rows.map((row) => row.length));
  for (const row of rows) {
    while (row.length < maxCols) row.push("");
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: caption/body boundary needs layered geometric guards.
function collectCaptionLines(
  lines: TextLine[],
  startIndex: number,
  captionPage: number,
  firstLine: TextLine,
  fragments: ExtractedFragment[],
): { captionText: string; captionLineIndexes: number[]; nextBodyIndex: number } {
  const captionLineIndexes: number[] = [startIndex];
  let captionText = firstLine.text;
  let nextIdx = startIndex + 1;
  const captionBounds = firstLine.column !== undefined ? getCaptionBounds(firstLine) : undefined;

  while (nextIdx < lines.length) {
    const line = lines[nextIdx];
    if (line.pageIndex !== captionPage) break;

    const prevLine = lines[nextIdx - 1];
    const vertGap = Math.abs(prevLine.y - line.y) / firstLine.fontSize;
    if (vertGap > TABLE_CAPTION_TO_BODY_MAX_GAP_FONT_RATIO) break;
    if (firstLine.column !== undefined && line.column === firstLine.column) {
      const leftOffset = Math.abs(line.x - firstLine.x);
      if (leftOffset > Math.max(firstLine.fontSize * 3, 24)) break;
    }

    const rowFragGroups = getFragmentGroupsForRow(
      fragments,
      line.y,
      line.fontSize,
      captionBounds,
    );
    if (rowFragGroups.length >= 2) break;

    if (Math.abs(line.fontSize - firstLine.fontSize) < 1.5) {
      captionLineIndexes.push(nextIdx);
      captionText += ` ${line.text}`;
      nextIdx++;
    } else {
      break;
    }
  }

  return { captionText, captionLineIndexes, nextBodyIndex: nextIdx };
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
    const rowBounds = line.column !== undefined ? estimateRowBounds(allEntries, line) : undefined;
    const groups = rowBounds
      ? getFragmentGroupsForRow(fragments, line.y, line.fontSize, rowBounds)
      : getFragmentGroupsForRow(fragments, line.y, line.fontSize);
    const resolvedGroups = groups.length > 0
      ? groups
      : getFragmentGroupsForRow(fragments, line.y, line.fontSize);
    rowFragGroupsList.push({ groups: resolvedGroups, line });
  }

  // Need enough multi-column rows
  const multiGroupRows = rowFragGroupsList.filter((r) => r.groups.length >= 2);
  if (multiGroupRows.length < MIN_MULTI_GROUP_ROWS) return [];

  // Determine column boundaries from fragment x-positions
  const allGroupStartXs: number[] = [];
  for (const { groups } of multiGroupRows) {
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
  let currentGroup: { frags: ExtractedFragment[]; startX: number; lastEndX: number } = {
    frags: [sorted[0]],
    startX: sorted[0].x,
    lastEndX: estimateFragmentEndX(sorted[0]),
  };

  for (let i = 1; i < sorted.length; i++) {
    const frag = sorted[i];
    const gap = frag.x - currentGroup.lastEndX;

    if (gap > MIN_COLUMN_GAP) {
      groups.push({
        startX: currentGroup.startX,
        endX: currentGroup.lastEndX,
        text: currentGroup.frags.map((f) => f.text).join(" ").trim(),
        fragments: currentGroup.frags,
      });
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

  groups.push({
    startX: currentGroup.startX,
    endX: currentGroup.lastEndX,
    text: currentGroup.frags.map((f) => f.text).join(" ").trim(),
    fragments: currentGroup.frags,
  });

  return groups;
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
