import {
  MAX_NUMBERED_HEADING_DIGIT_RATIO,
  MAX_NUMBERED_HEADING_LENGTH,
  MAX_NUMBERED_HEADING_WORDS,
  MAX_TOP_LEVEL_SECTION_NUMBER,
  MIN_NUMBERED_HEADING_LENGTH,
} from "./pdf-types.ts";
import { countWords, normalizeSpacing, splitWords } from "./text-lines.ts";
import { containsDocumentMetadata } from "./title-detect.ts";

const NAMED_SECTION_HEADING_LEVELS = new Map<string, number>([
  ["acknowledgement", 2],
  ["acknowledgements", 2],
  ["abstract", 2],
  ["acknowledgment", 2],
  ["acknowledgments", 2],
  ["conclusion", 2],
  ["conclusions", 2],
  ["conflict of interest", 2],
  ["conflicts of interest", 2],
  ["data sharing statement", 2],
  ["declaration", 2],
  ["declarations", 2],
  ["discussion", 2],
  ["ethics statement", 2],
  ["ethical statement", 2],
  ["experimental section", 2],
  ["funding", 2],
  ["limitations", 2],
  ["research in context", 2],
  ["references", 2],
  ["supporting information", 2],
]);

const TRAILING_TABULAR_SCORE_PATTERN = /\b\d{1,2}\.\d{1,2}$/;
const WIDE_KERNED_HEADING_PATTERN = /^([A-Z0-9]\s+){5,}/;
const WIDE_KERNED_HEADING_OVERRIDES: Array<readonly [string, string]> = [
  ["ABSTRACT", "Abstract"],
  ["INTRODUCTION", "Introduction"],
  ["REFERENCES", "References"],
];

export function detectNumberedHeadingLevel(text: string): number | undefined {
  const normalized = normalizeHeadingCandidate(
    text,
    MIN_NUMBERED_HEADING_LENGTH,
    MAX_NUMBERED_HEADING_LENGTH,
  );
  if (normalized === undefined) return undefined;

  const parsed = parseNumberedHeading(normalized);
  if (parsed === undefined) return undefined;
  if (!isValidHeadingText(parsed.headingText, parsed.isTopLevelSection)) return undefined;
  return Math.min(parsed.depth + 1, 6);
}

export interface NamedHeading {
  level: number;
  text: string;
}

export function detectNamedSectionHeadingLevel(text: string): NamedHeading | undefined {
  const candidate = normalizeWideKernedHeadingCandidate(text);

  const normalized = normalizeHeadingCandidate(candidate, 4, 40);
  if (normalized === undefined) return undefined;

  const normalizedLower = normalized.toLowerCase();
  const level = NAMED_SECTION_HEADING_LEVELS.get(normalizedLower);
  if (level !== undefined) {
    // The regex check might be too strict for our transformed candidates.
    // Let's rely on the map lookup.
    if (!/^[A-Za-z][A-Za-z\s-]*[A-Za-z]$/u.test(normalized) && candidate === text) {
      return undefined;
    }
    return { level, text: candidate };
  }

  return undefined;
}

function normalizeWideKernedHeadingCandidate(text: string): string {
  if (!WIDE_KERNED_HEADING_PATTERN.test(text)) return text;
  const compacted = text.replace(/\s/g, "");
  for (const [source, replacement] of WIDE_KERNED_HEADING_OVERRIDES) {
    if (compacted.includes(source)) return replacement;
  }
  return text;
}

function normalizeHeadingCandidate(
  text: string,
  minLength: number,
  maxLength: number,
): string | undefined {
  const normalized = normalizeSpacing(text);
  if (normalized.length < minLength || normalized.length > maxLength) return undefined;
  if (containsDocumentMetadata(normalized)) return undefined;
  return normalized;
}

interface ParsedNumberedHeading {
  depth: number;
  isTopLevelSection: boolean;
  headingText: string;
}

function parseNumberedHeading(text: string): ParsedNumberedHeading | undefined {
  const match = /^(\d+(?:\.\d+){0,4}\.?)\s+(.+)$/u.exec(text);
  if (!match) return undefined;
  const sectionNumber = match[1].replace(/\.$/, "");
  const sectionParts = sectionNumber.split(".");
  const topLevelSectionNumber = Number.parseInt(sectionParts[0], 10);
  if (!isValidTopLevelSectionNumber(topLevelSectionNumber)) return undefined;
  return {
    depth: sectionParts.length,
    isTopLevelSection: sectionParts.length === 1,
    headingText: match[2].trim(),
  };
}

function isValidTopLevelSectionNumber(topLevelSectionNumber: number): boolean {
  return (
    Number.isFinite(topLevelSectionNumber) &&
    topLevelSectionNumber >= 1 &&
    topLevelSectionNumber <= MAX_TOP_LEVEL_SECTION_NUMBER
  );
}

function isValidHeadingText(text: string, isTopLevelSection: boolean): boolean {
  if (text.length < 2) return false;
  if (text.includes(",") && isTopLevelSection) return false;
  if (isLikelyScoredTableRow(text)) return false;
  if (/[.!?]$/.test(text)) return false;
  if (!/^[A-Z]/.test(text)) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (isLikelyFlowLabelText(text)) return false;
  const wordCount = countWords(text);
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
  const tokens = splitWords(text);
  if (tokens.length < 4) return false;
  const scoreToken = tokens[tokens.length - 1];
  const score = Number.parseFloat(scoreToken);
  if (!Number.isFinite(score) || score < 0 || score > 10) return false;
  const alphaLength = text.replace(/[^A-Za-z]/g, "").length;
  return alphaLength >= 12;
}

function isLikelyFlowLabelText(text: string): boolean {
  const tokens = splitWords(text);
  if (tokens.length !== 3) return false;
  if (!/^\d{1,2}$/.test(tokens[1])) return false;
  const left = tokens[0].replace(/[^A-Za-z]/g, "");
  const right = tokens[2].replace(/[^A-Za-z]/g, "");
  if (left.length < 4 || right.length < 4) return false;
  return left.toLowerCase() === right.toLowerCase();
}
