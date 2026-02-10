// biome-ignore lint/nursery/noExcessiveLinesPerFile: table detection heuristics stay together for row-shape tuning.
import type { ExtractedDocument, ExtractedFragment, TextLine } from "./pdf-types.ts";
import { LINE_Y_BUCKET_SIZE } from "./pdf-types.ts";

const TABLE_CAPTION_PATTERN = /^Table\s+\d+[A-Za-z]?\s*[:.]/iu;

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
  if (!TABLE_CAPTION_PATTERN.test(firstLine.text)) return undefined;

  const captionPage = firstLine.pageIndex;
  const page = document.pages[captionPage];
  if (!page) return undefined;

  // 1. Collect caption lines
  const { captionText, captionLineIndexes, nextBodyIndex } =
    collectCaptionLines(lines, startIndex, captionPage, firstLine, page.fragments);

  // 2. Collect table body lines
  const { bodyEntries, nextIndex } =
    collectTableBodyLines(lines, nextBodyIndex, captionPage, firstLine, page.fragments);

  if (bodyEntries.length < MIN_TABLE_DATA_ROWS) return undefined;

  // Deduplicate entries from multi-column page layouts
  const deduped = deduplicateByY(bodyEntries, firstLine.fontSize);
  if (deduped.length < MIN_TABLE_DATA_ROWS) return undefined;

  // 3. Build rows from fragment-level column analysis
  const allParsedRows = buildTableRows(deduped, bodyEntries, page.fragments, bodyFontSize);
  if (allParsedRows.length < MIN_TABLE_DATA_ROWS + 1) return undefined;

  // 4. Split into header and data rows
  const headerRows = [allParsedRows[0]];
  const dataRows = allParsedRows.slice(1);
  if (dataRows.length < 1) return undefined;

  // Normalize column count
  const maxCols = Math.max(...allParsedRows.map((r) => r.length));
  for (const row of [...headerRows, ...dataRows]) {
    while (row.length < maxCols) row.push("");
  }

  return {
    captionStartIndex: startIndex,
    captionText: captionText.trim(),
    captionLineIndexes,
    headerRows,
    dataRows,
    nextIndex,
  };
}

// --- Caption collection ---

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
  let lastY = startIdx > 0 ? lines[startIdx - 1].y : firstLine.y;
  let nextIdx = startIdx;

  while (nextIdx < lines.length) {
    const line = lines[nextIdx];
    if (line.pageIndex !== captionPage) break;

    const vertGap = Math.abs(lastY - line.y) / firstLine.fontSize;
    if (vertGap > TABLE_MAX_VERTICAL_GAP_FONT_RATIO) break;

    if (isLikelySectionHeading(line.text)) break;
    if (TABLE_CAPTION_PATTERN.test(line.text)) break;

    if (line.estimatedWidth > line.pageWidth * 0.65) {
      const rowFragGroups = getFragmentGroupsForRow(fragments, line.y, line.fontSize);
      if (rowFragGroups.length < 2) break;
    }

    bodyEntries.push({ index: nextIdx, line });
    lastY = line.y;
    nextIdx++;
  }

  return { bodyEntries, nextIndex: nextIdx };
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
    const unboundedGroups = getFragmentGroupsForRow(fragments, line.y, line.fontSize);
    const shouldApplyRowBounds = rowBounds
      ? unboundedGroups.some((group) => group.endX < rowBounds.minX || group.startX > rowBounds.maxX)
      : false;
    const groups = shouldApplyRowBounds
      ? getFragmentGroupsForRow(fragments, line.y, line.fontSize, rowBounds)
      : unboundedGroups;
    rowFragGroupsList.push({ groups, line });
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
  return parseRowCells(rowFragGroupsList, columnXs, bodyFontSize);
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

    if (pendingSuperscriptTexts.length > 0 && allParsedRows.length > 0) {
      const lastRow = allParsedRows[allParsedRows.length - 1];
      lastRow[lastRow.length - 1] += ` ${pendingSuperscriptTexts.join(" ")}`;
      pendingSuperscriptTexts = [];
    }

    allParsedRows.push(assignFragmentGroupsToCells(groups, columnXs));
  }

  // Flush trailing superscripts
  if (pendingSuperscriptTexts.length > 0 && allParsedRows.length > 0) {
    const lastRow = allParsedRows[allParsedRows.length - 1];
    lastRow[lastRow.length - 1] += ` ${pendingSuperscriptTexts.join(" ")}`;
  }

  return allParsedRows;
}

// --- Fragment grouping ---

interface FragmentGroup {
  startX: number;
  endX: number;
  text: string;
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
      const fragmentEndX = estimateFragmentEndX(f);
      return fragmentEndX >= bounds.minX && f.x <= bounds.maxX;
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
    let bestCol = 0;
    let bestDist = Math.abs(group.startX - columnXs[0]);
    for (let c = 1; c < columnXs.length; c++) {
      const dist = Math.abs(group.startX - columnXs[c]);
      if (dist < bestDist) {
        bestDist = dist;
        bestCol = c;
      }
    }
    cells[bestCol] = cells[bestCol]
      ? `${cells[bestCol]} ${group.text}`
      : group.text;
  }

  return cells;
}

/**
 * Deduplicate table body entries that share the same y-position.
 */
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
    for (const row of table.dataRows) {
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
