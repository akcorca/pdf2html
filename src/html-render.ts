import type { TextLine } from "./pdf-types.ts";
import {
  MAX_NUMBERED_HEADING_DIGIT_RATIO,
  MAX_NUMBERED_HEADING_LENGTH,
  MAX_NUMBERED_HEADING_WORDS,
  MAX_TOP_LEVEL_SECTION_NUMBER,
  MIN_NUMBERED_HEADING_LENGTH,
} from "./pdf-types.ts";
import { normalizeSpacing } from "./text-lines.ts";
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

export function renderHtml(lines: TextLine[]): string {
  const titleLine = findTitleLine(lines);
  const bodyLines = lines.map((line) => {
    if (line === titleLine) return `<h1>${escapeHtml(line.text)}</h1>`;
    const headingLevel =
      detectNumberedHeadingLevel(line.text) ?? detectNamedSectionHeadingLevel(line.text);
    if (headingLevel !== undefined) {
      return `<h${headingLevel}>${escapeHtml(line.text)}</h${headingLevel}>`;
    }
    return `<p>${escapeHtml(line.text)}</p>`;
  });

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

function isLikelyFlowLabelText(text: string): boolean {
  const tokens = text.split(/\s+/).filter((p) => p.length > 0);
  if (tokens.length !== 3) return false;
  if (!/^\d{1,2}$/.test(tokens[1])) return false;
  const left = tokens[0].replace(/[^A-Za-z]/g, "");
  const right = tokens[2].replace(/[^A-Za-z]/g, "");
  if (left.length < 4 || right.length < 4) return false;
  return left.toLowerCase() === right.toLowerCase();
}
