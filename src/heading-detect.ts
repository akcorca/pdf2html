import {
  MAX_NUMBERED_HEADING_DIGIT_RATIO,
  MAX_NUMBERED_HEADING_LENGTH,
  MAX_NUMBERED_HEADING_WORDS,
  MAX_TOP_LEVEL_SECTION_NUMBER,
  MIN_NUMBERED_HEADING_LENGTH,
} from "./pdf-types.ts";
import { normalizeSpacing } from "./text-lines.ts";
import { containsDocumentMetadata } from "./title-detect.ts";

const NAMED_SECTION_HEADING_LEVELS = new Map<string, number>([
  ["acknowledgement", 2],
  ["acknowledgements", 2],
  ["abstract", 2],
  ["acknowledgment", 2],
  ["acknowledgments", 2],
  ["conclusion", 2],
  ["conclusions", 2],
  ["discussion", 2],
  ["experimental section", 2],
  ["references", 2],
]);

const TRAILING_TABULAR_SCORE_PATTERN = /\b\d{1,2}\.\d{1,2}$/;

export function detectNumberedHeadingLevel(text: string): number | undefined {
  const normalized = normalizeSpacing(text);
  if (
    normalized.length < MIN_NUMBERED_HEADING_LENGTH ||
    normalized.length > MAX_NUMBERED_HEADING_LENGTH
  ) {
    return undefined;
  }
  if (containsDocumentMetadata(normalized)) return undefined;

  const match = /^(\d+(?:\.\d+){0,4}\.?)\s+(.+)$/u.exec(normalized);
  if (!match) return undefined;

  const sectionNumber = match[1].replace(/\.$/, "");
  const topLevel = Number.parseInt(sectionNumber.split(".")[0], 10);
  if (!Number.isFinite(topLevel) || topLevel < 1 || topLevel > MAX_TOP_LEVEL_SECTION_NUMBER) {
    return undefined;
  }

  const headingText = match[2].trim();
  if (!isValidHeadingText(headingText, sectionNumber)) return undefined;

  const depth = sectionNumber.split(".").length;
  return Math.min(depth + 1, 6);
}

export function detectNamedSectionHeadingLevel(text: string): number | undefined {
  const normalized = normalizeSpacing(text);
  if (normalized.length < 4 || normalized.length > 40) return undefined;
  if (containsDocumentMetadata(normalized)) return undefined;
  if (!/^[A-Za-z][A-Za-z\s-]*[A-Za-z]$/u.test(normalized)) return undefined;
  return NAMED_SECTION_HEADING_LEVELS.get(normalized.toLowerCase());
}

function isValidHeadingText(text: string, sectionNumber: string): boolean {
  if (text.length < 2) return false;
  if (text.includes(",") && !sectionNumber.includes(".")) return false;
  if (isLikelyScoredTableRow(text)) return false;
  if (/[.!?]$/.test(text)) return false;
  if (!/^[A-Z]/.test(text)) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (isLikelyFlowLabelText(text)) return false;
  const wordCount = text.split(/\s+/).filter((p) => p.length > 0).length;
  if (wordCount > MAX_NUMBERED_HEADING_WORDS) return false;
  const hasMeaningful = text
    .split(/[^A-Za-z-]+/)
    .some((word) => word.replace(/[^A-Za-z]/g, "").length >= 4);
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
  const tokens = text.split(/\s+/).filter((part) => part.length > 0);
  if (tokens.length !== 3) return false;
  if (!/^\d{1,2}$/.test(tokens[1])) return false;
  const left = tokens[0].replace(/[^A-Za-z]/g, "");
  const right = tokens[2].replace(/[^A-Za-z]/g, "");
  if (left.length < 4 || right.length < 4) return false;
  return left.toLowerCase() === right.toLowerCase();
}
