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
const MIN_EDGE_TEXT_AFFIX_LENGTH = 12;
const MIN_PAGE_NUMBER_SEQUENCE_PAGES = 3;
const MIN_PAGE_NUMBER_SEQUENCE_COVERAGE = 0.5;
const ARXIV_SUBMISSION_STAMP_PATTERN =
  /\barXiv:\d{4}\.\d{4,5}(?:v\d+)?\s+\[[^\]]+\]\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\b/i;
const ARXIV_SUBMISSION_STAMP_MIN_FONT_SIZE_DELTA = 6;
const ARXIV_SUBMISSION_STAMP_MIN_FONT_SIZE_RATIO = 1.6;
const DEFAULT_TITLE_MIN_FONT_SIZE_DELTA = 5;
const DEFAULT_TITLE_MIN_FONT_SIZE_RATIO = 1.5;
const NEGATIVE_COORD_TITLE_MIN_FONT_SIZE_DELTA = 2;
const NEGATIVE_COORD_TITLE_MIN_FONT_SIZE_RATIO = 1.2;
const TITLE_MAX_WIDTH_RATIO = 0.9;
const TITLE_NEARBY_FONT_SIZE_TOLERANCE = 0.5;
const TITLE_NEARBY_LINE_WINDOW = 90;
const MAX_NEARBY_SAME_FONT_LINES = 3;
const TITLE_MIN_RELATIVE_VERTICAL_POSITION = 0.45;
const TOP_MATTER_TITLE_LOOKBACK_LINES = 8;
const MIN_AUTHOR_LINE_COMMA_COUNT = 2;
const MIN_AUTHOR_NAME_TOKEN_COUNT = 4;
const MIN_TOP_MATTER_TITLE_WORD_COUNT = 3;
const MAX_TOP_MATTER_TITLE_COMMA_COUNT = 1;

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

  const bodyFontSize = estimateBodyFontSize(lines);
  const pageExtents = computePageVerticalExtents(lines);
  const repeatedEdgeTexts = findRepeatedEdgeTexts(lines, pageExtents);
  const strippedLines = stripRepeatedEdgeTextAffixes(lines, repeatedEdgeTexts);
  const pageNumberLines = findLikelyPageNumberLines(strippedLines, pageExtents);

  return strippedLines.filter((line) => {
    if (line.text.length === 0) {
      return false;
    }

    if (isLikelyArxivSubmissionStamp(line, bodyFontSize)) {
      return false;
    }

    if (repeatedEdgeTexts.has(line.text)) {
      return false;
    }

    if (pageNumberLines.has(line)) {
      return false;
    }

    return true;
  });
}

function stripRepeatedEdgeTextAffixes(
  lines: TextLine[],
  repeatedEdgeTexts: Set<string>,
): TextLine[] {
  if (repeatedEdgeTexts.size === 0) {
    return lines;
  }

  const edgeTexts = [...repeatedEdgeTexts]
    .filter((text) => text.length >= MIN_EDGE_TEXT_AFFIX_LENGTH)
    .sort((left, right) => right.length - left.length);

  if (edgeTexts.length === 0) {
    return lines;
  }

  return lines.map((line) => {
    const strippedText = stripEdgeTextAffixes(line.text, edgeTexts);
    if (strippedText === line.text) {
      return line;
    }
    return { ...line, text: strippedText };
  });
}

function stripEdgeTextAffixes(text: string, edgeTexts: string[]): string {
  let current = text;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    let changed = false;

    for (const edgeText of edgeTexts) {
      const strippedPrefix = stripTextPrefix(current, edgeText);
      if (strippedPrefix !== current) {
        current = strippedPrefix;
        changed = true;
      }

      const strippedSuffix = stripTextSuffix(current, edgeText);
      if (strippedSuffix !== current) {
        current = strippedSuffix;
        changed = true;
      }
    }

    current = normalizeSpacing(current);
    if (!changed) {
      break;
    }
  }

  return current;
}

function stripTextPrefix(text: string, prefix: string): string {
  if (text === prefix) {
    return "";
  }
  if (!text.startsWith(prefix)) {
    return text;
  }

  const trailing = text.slice(prefix.length, prefix.length + 1);
  if (!isEdgeTextBoundaryCharacter(trailing)) {
    return text;
  }

  return text.slice(prefix.length);
}

function stripTextSuffix(text: string, suffix: string): string {
  if (text === suffix) {
    return "";
  }
  if (!text.endsWith(suffix)) {
    return text;
  }

  const leading = text.slice(text.length - suffix.length - 1, text.length - suffix.length);
  if (!isEdgeTextBoundaryCharacter(leading)) {
    return text;
  }

  return text.slice(0, text.length - suffix.length);
}

function isEdgeTextBoundaryCharacter(character: string): boolean {
  if (character.length === 0) {
    return true;
  }
  return /[\s()[\]{}.,;:!?'"/-]/.test(character);
}

function isLikelyArxivSubmissionStamp(line: TextLine, bodyFontSize: number): boolean {
  if (!ARXIV_SUBMISSION_STAMP_PATTERN.test(line.text)) {
    return false;
  }

  if (line.estimatedWidth > line.pageWidth * 0.7) {
    return false;
  }

  const minFontSize = Math.max(
    bodyFontSize + ARXIV_SUBMISSION_STAMP_MIN_FONT_SIZE_DELTA,
    bodyFontSize * ARXIV_SUBMISSION_STAMP_MIN_FONT_SIZE_RATIO,
  );
  return line.fontSize >= minFontSize;
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
    if (line.estimatedWidth > line.pageWidth * TITLE_MAX_WIDTH_RATIO) {
      return false;
    }
    if (isLikelyDenseSameFontBlock(line, firstPageLines)) {
      return false;
    }

    const pageCenter = line.pageWidth / 2;
    const lineCenter = line.x + line.estimatedWidth / 2;
    const centerDistance = Math.abs(lineCenter - pageCenter);
    return centerDistance <= line.pageWidth * 0.2;
  });

  if (candidates.length === 0) {
    return findTopMatterTitleFallback(firstPageLines);
  }

  return candidates.sort(
    (left, right) =>
      scoreTitleCandidate(right, bodyFontSize) - scoreTitleCandidate(left, bodyFontSize),
  )[0];
}

function isLikelyDenseSameFontBlock(line: TextLine, firstPageLines: TextLine[]): boolean {
  const nearbySameFontCount = firstPageLines.filter(
    (other) =>
      Math.abs(other.y - line.y) <= TITLE_NEARBY_LINE_WINDOW &&
      Math.abs(other.fontSize - line.fontSize) <= TITLE_NEARBY_FONT_SIZE_TOLERANCE,
  ).length;

  return nearbySameFontCount > MAX_NEARBY_SAME_FONT_LINES;
}

function findTopMatterTitleFallback(firstPageLines: TextLine[]): TextLine | undefined {
  const linesByVisualOrder = [...firstPageLines].sort((left, right) => {
    if (left.y !== right.y) {
      return right.y - left.y;
    }
    return left.x - right.x;
  });
  const authorLineIndex = linesByVisualOrder.findIndex((line) => isLikelyAuthorLine(line.text));
  if (authorLineIndex <= 0) {
    return undefined;
  }

  const authorLine = linesByVisualOrder[authorLineIndex];
  const minIndex = Math.max(0, authorLineIndex - TOP_MATTER_TITLE_LOOKBACK_LINES);
  const titleBlock: TextLine[] = [];

  for (let index = authorLineIndex - 1; index >= minIndex; index -= 1) {
    const line = linesByVisualOrder[index];
    if (!isLikelyTopMatterTitleLine(line.text)) {
      if (titleBlock.length > 0) {
        break;
      }
      continue;
    }

    const maxXOffset = line.pageWidth * 0.08;
    if (Math.abs(line.x - authorLine.x) > maxXOffset) {
      if (titleBlock.length > 0) {
        break;
      }
      continue;
    }

    titleBlock.push(line);
  }

  if (titleBlock.length === 0) {
    return undefined;
  }

  return titleBlock[titleBlock.length - 1];
}

function isLikelyAuthorLine(text: string): boolean {
  const normalized = normalizeSpacing(text);
  if (normalized.length < 20) {
    return false;
  }
  if (containsDocumentMetadata(normalized)) {
    return false;
  }

  const commaCount = (normalized.match(/,/g) ?? []).length;
  if (commaCount < MIN_AUTHOR_LINE_COMMA_COUNT) {
    return false;
  }

  const capitalizedTokens =
    normalized.match(/\b[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?\b/g) ?? [];
  return capitalizedTokens.length >= MIN_AUTHOR_NAME_TOKEN_COUNT;
}

function isLikelyTopMatterTitleLine(text: string): boolean {
  const normalized = normalizeSpacing(text);
  if (normalized.length < 20 || normalized.length > 140) {
    return false;
  }
  if (containsDocumentMetadata(normalized)) {
    return false;
  }
  if (/[.!?]$/.test(normalized)) {
    return false;
  }
  if (!/[A-Za-z]/.test(normalized)) {
    return false;
  }

  const wordCount = normalized.split(" ").filter((part) => part.length > 0).length;
  if (wordCount < MIN_TOP_MATTER_TITLE_WORD_COUNT) {
    return false;
  }

  const commaCount = (normalized.match(/,/g) ?? []).length;
  if (commaCount > MAX_TOP_MATTER_TITLE_COMMA_COUNT) {
    return false;
  }
  if (/^[A-Z0-9\- ]+$/.test(normalized)) {
    return false;
  }

  const alphaOnly = normalized.replace(/[^A-Za-z]/g, "");
  const uppercaseRatio =
    alphaOnly.length > 0 ? alphaOnly.replace(/[^A-Z]/g, "").length / alphaOnly.length : 0;
  return uppercaseRatio <= 0.9;
}

function containsDocumentMetadata(text: string): boolean {
  return /(?:https?:\/\/|www\.|@|doi\b|wileyonlinelibrary\.com)/i.test(text);
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
