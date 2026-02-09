import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LINE_Y_BUCKET_SIZE = 2;
const MAX_REASONABLE_Y_MULTIPLIER = 2.5;
const PAGE_EDGE_MARGIN = 0.08;
const STANDALONE_PAGE_NUMBER_PATTERN = /^\d{1,4}$/;
const MIN_REPEATED_EDGE_TEXT_PAGES = 4;
const MIN_REPEATED_EDGE_TEXT_PAGE_COVERAGE = 0.6;
const MIN_PAGE_NUMBER_SEQUENCE_PAGES = 3;
const MIN_PAGE_NUMBER_SEQUENCE_COVERAGE = 0.5;
const DEFAULT_TITLE_MIN_FONT_SIZE_DELTA = 5;
const DEFAULT_TITLE_MIN_FONT_SIZE_RATIO = 1.5;
const NEGATIVE_COORD_TITLE_MIN_FONT_SIZE_DELTA = 2;
const NEGATIVE_COORD_TITLE_MIN_FONT_SIZE_RATIO = 1.2;
const TITLE_MIN_RELATIVE_VERTICAL_POSITION = 0.45;

interface ConvertPdfToHtmlInput {
  inputPdfPath: string;
  outputHtmlPath: string;
}

interface ConvertPdfToHtmlResult {
  outputHtmlPath: string;
}

interface ExtractedDocument {
  pages: ExtractedPage[];
}

interface ExtractedPage {
  pageIndex: number;
  width: number;
  height: number;
  fragments: ExtractedFragment[];
}

interface ExtractedFragment {
  text: string;
  x: number;
  y: number;
  fontSize: number;
}

interface TextLine {
  pageIndex: number;
  pageHeight: number;
  pageWidth: number;
  estimatedWidth: number;
  x: number;
  y: number;
  fontSize: number;
  text: string;
}

interface PageVerticalExtent {
  minY: number;
  maxY: number;
}

interface RepeatedEdgeTextStat {
  totalOccurrences: number;
  edgeOccurrences: number;
  pageIndexes: Set<number>;
}

interface NumericEdgeLine {
  line: TextLine;
  offset: number;
}

export async function convertPdfToHtml(
  input: ConvertPdfToHtmlInput,
): Promise<ConvertPdfToHtmlResult> {
  const resolvedInputPdfPath = resolve(input.inputPdfPath);
  const resolvedOutputHtmlPath = resolve(input.outputHtmlPath);

  await assertReadableFile(resolvedInputPdfPath);

  const extracted = await extractDocument(resolvedInputPdfPath);
  const lines = filterPageArtifacts(collectTextLines(extracted));
  const html = renderHtml(lines);

  await mkdir(dirname(resolvedOutputHtmlPath), { recursive: true });
  await writeFile(resolvedOutputHtmlPath, html, "utf8");

  return { outputHtmlPath: resolvedOutputHtmlPath };
}

async function assertReadableFile(filePath: string): Promise<void> {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new Error(`Cannot read input PDF: ${filePath}`);
  }
}

async function extractDocument(inputPdfPath: string): Promise<ExtractedDocument> {
  const pythonScript = [
    "import json",
    "import sys",
    "from pypdf import PdfReader",
    "",
    "input_path = sys.argv[1]",
    "reader = PdfReader(input_path)",
    "pages = []",
    "",
    "for page_index, page in enumerate(reader.pages):",
    "    fragments = []",
    "    width = float(page.mediabox.width)",
    "    height = float(page.mediabox.height)",
    "",
    "    def visitor_text(text, cm, tm, font_dict, font_size):",
    "        normalized = ' '.join((text or '').split())",
    "        if not normalized:",
    "            return",
    "        fragments.append({",
    "            'text': normalized,",
    "            'x': float(tm[4]),",
    "            'y': float(tm[5]),",
    "            'fontSize': float(font_size),",
    "        })",
    "",
    "    page.extract_text(visitor_text=visitor_text)",
    "    pages.append({",
    "        'pageIndex': page_index,",
    "        'width': width,",
    "        'height': height,",
    "        'fragments': fragments,",
    "    })",
    "",
    "print(json.dumps({'pages': pages}))",
  ].join("\n");

  try {
    const { stdout } = await execFileAsync("python3", [
      "-c",
      pythonScript,
      inputPdfPath,
    ]);
    return JSON.parse(stdout) as ExtractedDocument;
  } catch (error: unknown) {
    throw createExtractionError(error);
  }
}

function collectTextLines(document: ExtractedDocument): TextLine[] {
  const lines: TextLine[] = [];

  for (const page of document.pages) {
    const buckets = new Map<number, ExtractedFragment[]>();

    for (const fragment of page.fragments) {
      if (fragment.y > page.height * MAX_REASONABLE_Y_MULTIPLIER) {
        continue;
      }

      const bucket = Math.round(fragment.y / LINE_Y_BUCKET_SIZE) * LINE_Y_BUCKET_SIZE;
      const existing = buckets.get(bucket);
      if (existing) {
        existing.push(fragment);
      } else {
        buckets.set(bucket, [fragment]);
      }
    }

    for (const [bucket, fragments] of buckets) {
      fragments.sort((left, right) => left.x - right.x);
      const lineText = normalizeSpacing(fragments.map((fragment) => fragment.text).join(" "));
      if (lineText.length === 0) {
        continue;
      }

      lines.push({
        pageIndex: page.pageIndex,
        pageHeight: page.height,
        pageWidth: page.width,
        estimatedWidth: estimateLineWidth(fragments),
        x: Math.min(...fragments.map((fragment) => fragment.x)),
        y: bucket,
        fontSize: Math.max(...fragments.map((fragment) => fragment.fontSize)),
        text: lineText,
      });
    }
  }

  return lines.sort((left, right) => {
    if (left.pageIndex !== right.pageIndex) {
      return left.pageIndex - right.pageIndex;
    }
    if (left.y !== right.y) {
      return right.y - left.y;
    }
    return left.x - right.x;
  });
}

function renderHtml(lines: TextLine[]): string {
  const titleLine = findTitleLine(lines);
  const bodyLines = lines.map((line) =>
    line === titleLine ? `<h1>${escapeHtml(line.text)}</h1>` : `<p>${escapeHtml(line.text)}</p>`,
  );

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    "  <title>Converted PDF</title>",
    "</head>",
    "<body>",
    ...bodyLines,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function filterPageArtifacts(lines: TextLine[]): TextLine[] {
  if (lines.length === 0) {
    return lines;
  }

  const pageExtents = computePageVerticalExtents(lines);
  const repeatedEdgeTexts = findRepeatedEdgeTexts(lines, pageExtents);
  const pageNumberLines = findLikelyPageNumberLines(lines, pageExtents);

  return lines.filter((line) => {
    if (repeatedEdgeTexts.has(line.text)) {
      return false;
    }

    if (pageNumberLines.has(line)) {
      return false;
    }

    return true;
  });
}

function computePageVerticalExtents(lines: TextLine[]): Map<number, PageVerticalExtent> {
  const pageExtents = new Map<number, PageVerticalExtent>();

  for (const line of lines) {
    const current = pageExtents.get(line.pageIndex);
    if (!current) {
      pageExtents.set(line.pageIndex, { minY: line.y, maxY: line.y });
      continue;
    }

    current.minY = Math.min(current.minY, line.y);
    current.maxY = Math.max(current.maxY, line.y);
  }

  return pageExtents;
}

function findRepeatedEdgeTexts(
  lines: TextLine[],
  pageExtents: Map<number, PageVerticalExtent>,
): Set<string> {
  const totalPages = new Set(lines.map((line) => line.pageIndex)).size;
  const stats = new Map<string, RepeatedEdgeTextStat>();

  for (const line of lines) {
    const existing = stats.get(line.text);
    if (existing) {
      existing.totalOccurrences += 1;
      existing.pageIndexes.add(line.pageIndex);
      if (isNearPageEdge(line, pageExtents)) {
        existing.edgeOccurrences += 1;
      }
      continue;
    }

    stats.set(line.text, {
      totalOccurrences: 1,
      edgeOccurrences: isNearPageEdge(line, pageExtents) ? 1 : 0,
      pageIndexes: new Set([line.pageIndex]),
    });
  }

  const repeatedEdgeTexts = new Set<string>();
  for (const [text, stat] of stats) {
    if (stat.pageIndexes.size < MIN_REPEATED_EDGE_TEXT_PAGES) {
      continue;
    }

    const edgeRatio = stat.edgeOccurrences / stat.totalOccurrences;
    if (edgeRatio < 0.85) {
      continue;
    }

    const pageCoverage = stat.pageIndexes.size / Math.max(totalPages, 1);
    if (pageCoverage < MIN_REPEATED_EDGE_TEXT_PAGE_COVERAGE) {
      continue;
    }

    repeatedEdgeTexts.add(text);
  }

  return repeatedEdgeTexts;
}

function isNearPageEdge(
  line: TextLine,
  pageExtents: Map<number, PageVerticalExtent>,
  edgeMargin: number = PAGE_EDGE_MARGIN,
): boolean {
  const relativeY = getRelativeVerticalPosition(line, pageExtents);
  return relativeY <= edgeMargin || relativeY >= 1 - edgeMargin;
}

function getRelativeVerticalPosition(
  line: TextLine,
  pageExtents: Map<number, PageVerticalExtent>,
): number {
  const extent = pageExtents.get(line.pageIndex);
  if (!extent) {
    return 0.5;
  }

  const span = extent.maxY - extent.minY;
  if (span <= 0) {
    return 0.5;
  }

  return (line.y - extent.minY) / span;
}

function isStandalonePageNumber(
  line: TextLine,
  pageExtents: Map<number, PageVerticalExtent>,
): boolean {
  if (!STANDALONE_PAGE_NUMBER_PATTERN.test(line.text)) {
    return false;
  }

  return isNearPageEdge(line, pageExtents);
}

function findLikelyPageNumberLines(
  lines: TextLine[],
  pageExtents: Map<number, PageVerticalExtent>,
): Set<TextLine> {
  const totalPages = new Set(lines.map((line) => line.pageIndex)).size;
  const numericEdgeLines: NumericEdgeLine[] = [];

  for (const line of lines) {
    if (!isStandalonePageNumber(line, pageExtents)) {
      continue;
    }

    const value = Number.parseInt(line.text, 10);
    if (Number.isNaN(value)) {
      continue;
    }

    numericEdgeLines.push({
      line,
      offset: value - line.pageIndex,
    });
  }

  const linesByOffset = new Map<number, NumericEdgeLine[]>();
  for (const entry of numericEdgeLines) {
    const existing = linesByOffset.get(entry.offset);
    if (existing) {
      existing.push(entry);
    } else {
      linesByOffset.set(entry.offset, [entry]);
    }
  }

  const selectedOffsets = new Set<number>();
  for (const [offset, entries] of linesByOffset) {
    const pageCount = new Set(entries.map((entry) => entry.line.pageIndex)).size;
    if (pageCount < MIN_PAGE_NUMBER_SEQUENCE_PAGES) {
      continue;
    }

    const coverage = pageCount / Math.max(totalPages, 1);
    if (coverage < MIN_PAGE_NUMBER_SEQUENCE_COVERAGE) {
      continue;
    }

    selectedOffsets.add(offset);
  }

  const pageNumberLines = new Set<TextLine>();
  for (const entry of numericEdgeLines) {
    if (!selectedOffsets.has(entry.offset)) {
      continue;
    }

    pageNumberLines.add(entry.line);
  }

  return pageNumberLines;
}

function findTitleLine(lines: TextLine[]): TextLine | undefined {
  const firstPageLines = lines.filter((line) => line.pageIndex === 0);
  if (firstPageLines.length === 0) {
    return undefined;
  }

  const negativeCoordinateRatio =
    firstPageLines.filter((line) => line.y < 0).length / Math.max(firstPageLines.length, 1);
  const usesNegativeCoordinates = negativeCoordinateRatio > 0.6;
  const bodyFontSize = estimateBodyFontSize(lines);
  const minTitleFontSize = Math.max(
    bodyFontSize +
      (usesNegativeCoordinates
        ? NEGATIVE_COORD_TITLE_MIN_FONT_SIZE_DELTA
        : DEFAULT_TITLE_MIN_FONT_SIZE_DELTA),
    bodyFontSize *
      (usesNegativeCoordinates
        ? NEGATIVE_COORD_TITLE_MIN_FONT_SIZE_RATIO
        : DEFAULT_TITLE_MIN_FONT_SIZE_RATIO),
  );
  const firstPageExtents = computePageVerticalExtents(firstPageLines);

  const candidates = firstPageLines.filter((line) => {
    if (line.fontSize < minTitleFontSize) {
      return false;
    }
    if (line.text.length < 8) {
      return false;
    }
    if (/[.!?]$/.test(line.text)) {
      return false;
    }
    const relativeY = getRelativeVerticalPosition(line, firstPageExtents);
    if (relativeY < TITLE_MIN_RELATIVE_VERTICAL_POSITION) {
      return false;
    }
    if (line.estimatedWidth > line.pageWidth * 0.7) {
      return false;
    }

    const pageCenter = line.pageWidth / 2;
    const lineCenter = line.x + line.estimatedWidth / 2;
    const centerDistance = Math.abs(lineCenter - pageCenter);
    return centerDistance <= line.pageWidth * 0.2;
  });

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.sort(
    (left, right) =>
      scoreTitleCandidate(right, bodyFontSize) - scoreTitleCandidate(left, bodyFontSize),
  )[0];
}

function estimateBodyFontSize(lines: TextLine[]): number {
  const frequencies = new Map<number, number>();

  for (const line of lines) {
    const rounded = Math.round(line.fontSize);
    frequencies.set(rounded, (frequencies.get(rounded) ?? 0) + 1);
  }

  const [mostFrequentFontSize] = [...frequencies.entries()].sort((left, right) => {
    if (left[1] !== right[1]) {
      return right[1] - left[1];
    }
    return left[0] - right[0];
  })[0] ?? [10, 0];

  return mostFrequentFontSize;
}

function scoreTitleCandidate(line: TextLine, bodyFontSize: number): number {
  const pageCenter = line.pageWidth / 2;
  const lineCenter = line.x + line.estimatedWidth / 2;
  const centerDistance = Math.abs(lineCenter - pageCenter);
  const centerScore = 1 - Math.min(centerDistance / pageCenter, 1);
  const sizeScore = line.fontSize / Math.max(bodyFontSize, 1);
  const verticalScore = line.y / Math.max(line.pageHeight, 1);

  return sizeScore * 3 + centerScore * 2 + verticalScore;
}

function estimateLineWidth(fragments: ExtractedFragment[]): number {
  const startX = Math.min(...fragments.map((fragment) => fragment.x));
  const endX = Math.max(...fragments.map((fragment) => fragment.x));
  const spanFromPositions = endX - startX;
  const spanFromText = fragments.reduce(
    (sum, fragment) => sum + estimateTextWidth(fragment.text, fragment.fontSize),
    0,
  );

  return Math.max(spanFromPositions, spanFromText);
}

function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.52;
}

function normalizeSpacing(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function createExtractionError(error: unknown): Error {
  const typed = error as NodeJS.ErrnoException & {
    stderr?: string;
    stdout?: string;
  };

  if (typed.code === "ENOENT") {
    return new Error("python3 command not found.");
  }

  const detail = typed.stderr?.trim() || typed.message;
  return new Error(`Failed to extract text from PDF: ${detail}`);
}

export const pdfToHtmlInternals = {
  collectTextLines,
  renderHtml,
  filterPageArtifacts,
  computePageVerticalExtents,
  findRepeatedEdgeTexts,
  isNearPageEdge,
  getRelativeVerticalPosition,
  isStandalonePageNumber,
  findLikelyPageNumberLines,
  findTitleLine,
  estimateBodyFontSize,
  scoreTitleCandidate,
  estimateLineWidth,
  estimateTextWidth,
  normalizeSpacing,
  escapeHtml,
  createExtractionError,
};
