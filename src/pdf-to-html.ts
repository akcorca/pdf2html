import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LINE_Y_BUCKET_SIZE = 2;

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

export async function convertPdfToHtml(
  input: ConvertPdfToHtmlInput,
): Promise<ConvertPdfToHtmlResult> {
  const resolvedInputPdfPath = resolve(input.inputPdfPath);
  const resolvedOutputHtmlPath = resolve(input.outputHtmlPath);

  await assertReadableFile(resolvedInputPdfPath);

  const extracted = await extractDocument(resolvedInputPdfPath);
  const lines = collectTextLines(extracted);
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

function findTitleLine(lines: TextLine[]): TextLine | undefined {
  const firstPageLines = lines.filter((line) => line.pageIndex === 0);
  if (firstPageLines.length === 0) {
    return undefined;
  }

  const bodyFontSize = estimateBodyFontSize(lines);
  const minTitleFontSize = Math.max(bodyFontSize + 5, bodyFontSize * 1.5);

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
    if (line.y < line.pageHeight * 0.45) {
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
  findTitleLine,
  estimateBodyFontSize,
  scoreTitleCandidate,
  estimateLineWidth,
  estimateTextWidth,
  normalizeSpacing,
  escapeHtml,
  createExtractionError,
};
