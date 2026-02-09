import type { TextLine } from "./pdf-types.ts";
import {
  MAX_NUMBERED_HEADING_DIGIT_RATIO,
  MAX_NUMBERED_HEADING_LENGTH,
  MAX_NUMBERED_HEADING_WORDS,
  MAX_TOP_LEVEL_SECTION_NUMBER,
  MIN_NUMBERED_HEADING_LENGTH,
} from "./pdf-types.ts";
import { estimateBodyFontSize, normalizeSpacing } from "./text-lines.ts";
import { containsDocumentMetadata, findTitleLine } from "./title-detect.ts";

const NAMED_SECTION_HEADING_LEVELS = new Map<string, number>([
  ["abstract", 2],
  ["acknowledgment", 2],
  ["acknowledgments", 2],
  ["conclusion", 2],
  ["conclusions", 2],
  ["discussion", 2],
  ["references", 2],
]);
const TRAILING_TABULAR_SCORE_PATTERN = /\b\d{1,2}\.\d{1,2}$/;
const BULLET_LIST_ITEM_PATTERN = /^([•◦▪●○■□◆◇‣⁃∙·])\s+(.+)$/u;
const MIN_LIST_CONTINUATION_INDENT = 6;
const TITLE_CONTINUATION_MAX_FONT_DELTA = 0.6;
const TITLE_CONTINUATION_MAX_CENTER_OFFSET_RATIO = 0.12;
const TITLE_CONTINUATION_MAX_LEFT_OFFSET_RATIO = 0.03;
const TITLE_CONTINUATION_MAX_VERTICAL_GAP_RATIO = 2.2;
const TITLE_CONTINUATION_MIN_WORD_COUNT = 3;
const MIN_NUMBERED_HEADING_FONT_RATIO = 0.85;

export function renderHtml(lines: TextLine[]): string {
  const titleLine = findTitleLine(lines);
  const bodyLines = renderBodyLines(lines, titleLine);

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

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderBodyLines(lines: TextLine[], titleLine: TextLine | undefined): string[] {
  const bodyLines: string[] = [];
  const bodyFontSize = estimateBodyFontSize(lines);
  let index = 0;
  while (index < lines.length) {
    const currentLine = lines[index];
    if (currentLine === titleLine) {
      const consumedTitle = consumeTitleLines(lines, index, titleLine);
      bodyLines.push(`<h1>${escapeHtml(consumedTitle.text)}</h1>`);
      index = consumedTitle.nextIndex;
      continue;
    }

    const headingTag = renderHeadingTag(currentLine, bodyFontSize);
    if (headingTag !== undefined) {
      bodyLines.push(headingTag);
      index += 1;
      continue;
    }

    const renderedList = renderBulletList(lines, index, titleLine);
    if (renderedList !== undefined) {
      bodyLines.push(...renderedList.htmlLines);
      index = renderedList.nextIndex;
      continue;
    }

    bodyLines.push(`<p>${escapeHtml(currentLine.text)}</p>`);
    index += 1;
  }
  return bodyLines;
}

function renderHeadingTag(line: TextLine, bodyFontSize: number): string | undefined {
  const numberedHeadingLevel = detectNumberedHeadingLevel(line.text);
  if (numberedHeadingLevel !== undefined) {
    if (line.fontSize < bodyFontSize * MIN_NUMBERED_HEADING_FONT_RATIO) return undefined;
    return `<h${numberedHeadingLevel}>${escapeHtml(line.text)}</h${numberedHeadingLevel}>`;
  }

  const namedHeadingLevel = detectNamedSectionHeadingLevel(line.text);
  if (namedHeadingLevel === undefined) return undefined;
  return `<h${namedHeadingLevel}>${escapeHtml(line.text)}</h${namedHeadingLevel}>`;
}

function consumeTitleLines(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine,
): { text: string; nextIndex: number } {
  const parts = [titleLine.text];
  let index = startIndex + 1;
  let previousLine = titleLine;

  while (index < lines.length && isTitleContinuationLine(lines[index], previousLine, titleLine)) {
    parts.push(lines[index].text);
    previousLine = lines[index];
    index += 1;
  }

  return { text: normalizeSpacing(parts.join(" ")), nextIndex: index };
}

function isTitleContinuationLine(
  line: TextLine,
  previousTitleLine: TextLine,
  titleLine: TextLine,
): boolean {
  if (line.pageIndex !== titleLine.pageIndex) return false;
  const text = normalizeSpacing(line.text);
  if (text.length === 0) return false;
  if (containsDocumentMetadata(text)) return false;
  const words = text.split(" ").filter((token) => token.length > 0);
  if (
    words.length < TITLE_CONTINUATION_MIN_WORD_COUNT &&
    !isLikelyShortTitleContinuation(words)
  ) {
    return false;
  }
  if (
    detectNumberedHeadingLevel(text) !== undefined ||
    detectNamedSectionHeadingLevel(text) !== undefined
  ) {
    return false;
  }
  if (/[.!?:]$/.test(previousTitleLine.text.trim())) return false;
  if (line.y >= previousTitleLine.y) return false;

  const maxGap = Math.max(
    titleLine.fontSize * TITLE_CONTINUATION_MAX_VERTICAL_GAP_RATIO,
    titleLine.fontSize + 10,
  );
  if (previousTitleLine.y - line.y > maxGap) return false;
  if (Math.abs(line.fontSize - titleLine.fontSize) > TITLE_CONTINUATION_MAX_FONT_DELTA) {
    return false;
  }

  const titleCenter = getLineCenter(titleLine);
  const lineCenter = getLineCenter(line);
  const maxCenterOffset = titleLine.pageWidth * TITLE_CONTINUATION_MAX_CENTER_OFFSET_RATIO;
  const maxLeftOffset = titleLine.pageWidth * TITLE_CONTINUATION_MAX_LEFT_OFFSET_RATIO;
  return (
    Math.abs(titleCenter - lineCenter) <= maxCenterOffset ||
    Math.abs(line.x - titleLine.x) <= maxLeftOffset
  );
}

function isLikelyShortTitleContinuation(words: string[]): boolean {
  if (words.length !== 2) return false;
  return words.every((word) => /^[A-Z][A-Za-z0-9'-]*$/.test(word));
}

function getLineCenter(line: TextLine): number {
  return line.x + line.estimatedWidth / 2;
}

function renderBulletList(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
): { htmlLines: string[]; nextIndex: number } | undefined {
  if (parseBulletListItemText(lines[startIndex].text) === undefined) return undefined;
  const listItems: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const consumedItem = consumeBulletListItem(lines, index, titleLine);
    if (consumedItem === undefined) break;
    listItems.push(consumedItem.text);
    index = consumedItem.nextIndex;
  }
  if (listItems.length === 0) return undefined;

  return {
    htmlLines: ["<ul>", ...listItems.map((item) => `<li>${escapeHtml(item)}</li>`), "</ul>"],
    nextIndex: index,
  };
}

function consumeBulletListItem(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
): { text: string; nextIndex: number } | undefined {
  const itemStartLine = lines[startIndex];
  const itemStartText = parseBulletListItemText(itemStartLine.text);
  if (itemStartText === undefined) return undefined;

  let itemText = itemStartText;
  let index = startIndex + 1;
  while (index < lines.length && isBulletListContinuation(lines[index], itemStartLine, titleLine)) {
    itemText = normalizeSpacing(`${itemText} ${lines[index].text}`);
    index += 1;
  }
  return { text: itemText, nextIndex: index };
}

function parseBulletListItemText(text: string): string | undefined {
  const normalized = normalizeSpacing(text);
  const match = BULLET_LIST_ITEM_PATTERN.exec(normalized);
  if (!match) return undefined;
  const itemText = match[2].trim();
  if (itemText.length === 0) return undefined;
  return itemText;
}

function isBulletListContinuation(
  line: TextLine,
  itemStartLine: TextLine,
  titleLine: TextLine | undefined,
): boolean {
  if (line === titleLine) return false;
  if (line.pageIndex !== itemStartLine.pageIndex) return false;
  if (parseBulletListItemText(line.text) !== undefined) return false;
  if (
    detectNumberedHeadingLevel(line.text) !== undefined ||
    detectNamedSectionHeadingLevel(line.text) !== undefined
  ) {
    return false;
  }
  return line.x >= itemStartLine.x + MIN_LIST_CONTINUATION_INDENT;
}

export function detectNumberedHeadingLevel(text: string): number | undefined {
  const normalized = normalizeSpacing(text);
  if (
    normalized.length < MIN_NUMBERED_HEADING_LENGTH ||
    normalized.length > MAX_NUMBERED_HEADING_LENGTH
  ) {
    return undefined;
  }
  if (containsDocumentMetadata(normalized)) return undefined;

  const match = /^(\d+(?:\.\d+){0,4})\s+(.+)$/u.exec(normalized);
  if (!match) return undefined;

  const topLevel = Number.parseInt(match[1].split(".")[0], 10);
  if (!Number.isFinite(topLevel) || topLevel < 1 || topLevel > MAX_TOP_LEVEL_SECTION_NUMBER) {
    return undefined;
  }

  const headingText = match[2].trim();
  if (!isValidHeadingText(headingText)) return undefined;

  const depth = match[1].split(".").length;
  return Math.min(depth + 1, 6);
}

export function detectNamedSectionHeadingLevel(text: string): number | undefined {
  const normalized = normalizeSpacing(text);
  if (normalized.length < 4 || normalized.length > 40) return undefined;
  if (containsDocumentMetadata(normalized)) return undefined;
  if (!/^[A-Za-z][A-Za-z\s-]*[A-Za-z]$/u.test(normalized)) return undefined;
  return NAMED_SECTION_HEADING_LEVELS.get(normalized.toLowerCase());
}

function isValidHeadingText(text: string): boolean {
  if (text.length < 2) return false;
  if (text.includes(",")) return false;
  if (isLikelyScoredTableRow(text)) return false;
  if (/[.!?]$/.test(text)) return false;
  if (!/^[A-Z]/.test(text)) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (isLikelyFlowLabelText(text)) return false;
  const wordCount = text.split(/\s+/).filter((p) => p.length > 0).length;
  if (wordCount > MAX_NUMBERED_HEADING_WORDS) return false;
  const hasMeaningful = text
    .split(/[^A-Za-z-]+/)
    .some((w) => w.replace(/[^A-Za-z]/g, "").length >= 4);
  if (!hasMeaningful) return false;
  const alphanumeric = text.replace(/[^A-Za-z0-9]/g, "");
  const digitRatio = text.replace(/[^0-9]/g, "").length / Math.max(alphanumeric.length, 1);
  return digitRatio <= MAX_NUMBERED_HEADING_DIGIT_RATIO;
}

function isLikelyScoredTableRow(text: string): boolean {
  if (!TRAILING_TABULAR_SCORE_PATTERN.test(text)) return false;
  const tokens = text.split(/\s+/).filter((part) => part.length > 0);
  if (tokens.length < 4) return false;
  const scoreToken = tokens[tokens.length - 1];
  const score = Number.parseFloat(scoreToken);
  if (!Number.isFinite(score) || score < 0 || score > 10) return false;
  const alphaLength = text.replace(/[^A-Za-z]/g, "").length;
  return alphaLength >= 12;
}

function isLikelyFlowLabelText(text: string): boolean {
  const tokens = text.split(/\s+/).filter((p) => p.length > 0);
  if (tokens.length !== 3) return false;
  if (!/^\d{1,2}$/.test(tokens[1])) return false;
  const left = tokens[0].replace(/[^A-Za-z]/g, "");
  const right = tokens[2].replace(/[^A-Za-z]/g, "");
  if (left.length < 4 || right.length < 4) return false;
  return left.toLowerCase() === right.toLowerCase();
}
