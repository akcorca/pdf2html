import type { NumericEdgeLine, PageVerticalExtent, RepeatedEdgeTextStat, TextLine } from "./pdf-types.ts";
import {
  ARXIV_SUBMISSION_STAMP_MIN_FONT_SIZE_DELTA,
  ARXIV_SUBMISSION_STAMP_MIN_FONT_SIZE_RATIO,
  ARXIV_SUBMISSION_STAMP_PATTERN,
  MIN_EDGE_TEXT_AFFIX_LENGTH,
  MIN_PAGE_NUMBER_SEQUENCE_COVERAGE,
  MIN_PAGE_NUMBER_SEQUENCE_PAGES,
  MIN_REPEATED_EDGE_TEXT_PAGE_COVERAGE,
  MIN_REPEATED_EDGE_TEXT_PAGES,
  MIN_RUNNING_LABEL_EDGE_PAGE_COVERAGE,
  MIN_RUNNING_LABEL_LENGTH,
  MAX_RUNNING_LABEL_LENGTH,
  MAX_RUNNING_LABEL_WORDS,
} from "./pdf-types.ts";
import {
  computePageVerticalExtents,
  estimateBodyFontSize,
  isNearPageEdge,
  isNearPhysicalPageEdge,
  isStandalonePageNumber,
  normalizeSpacing,
} from "./text-lines.ts";

const STANDALONE_CITATION_MARKER_PATTERN =
  /^(?:\[\d{1,3}(?:,\s*\d{1,3})*\])(?:\s+\[\d{1,3}(?:,\s*\d{1,3})*\])*$/;
const PAGE_COUNTER_PATTERN = /\(\d+\s+of\s+\d+\)/i;
const DOMAIN_LIKE_TOKEN_PATTERN = /\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/;
const TOP_MATTER_AFFILIATION_INDEX_PATTERN = /^[\d\s,.;:()[\]{}+-]+$/;
const TOP_MATTER_AFFILIATION_MIN_VERTICAL_RATIO = 0.72;
const TOP_MATTER_AFFILIATION_MAX_FONT_RATIO = 0.82;
const TOP_MATTER_AFFILIATION_MIN_INDEX_TOKENS = 2;

export function filterPageArtifacts(lines: TextLine[]): TextLine[] {
  if (lines.length === 0) return lines;
  const bodyFontSize = estimateBodyFontSize(lines);
  const pageExtents = computePageVerticalExtents(lines);
  const repeatedEdgeTexts = findRepeatedEdgeTexts(lines, pageExtents);
  const strippedLines = stripArxivSubmissionStampAffixes(
    stripRepeatedEdgeTextAffixes(lines, repeatedEdgeTexts),
  );
  const pageNumberLines = findLikelyPageNumberLines(strippedLines, pageExtents);
  return strippedLines.filter((line) => {
    if (line.text.length === 0) return false;
    if (isLikelyArxivSubmissionStamp(line, bodyFontSize)) return false;
    if (isLikelyPublisherPageCounterFooter(line, pageExtents)) return false;
    if (isLikelyTopMatterAffiliationIndexLine(line, bodyFontSize)) return false;
    if (repeatedEdgeTexts.has(line.text)) return false;
    if (pageNumberLines.has(line)) return false;
    if (isStandaloneCitationMarker(line.text)) return false;
    return true;
  });
}

export function findRepeatedEdgeTexts(
  lines: TextLine[],
  pageExtents: Map<number, PageVerticalExtent>,
): Set<string> {
  const totalPages = new Set(lines.map((l) => l.pageIndex)).size;
  const stats = collectEdgeTextStats(lines, pageExtents);
  return selectRepeatedEdgeTexts(stats, totalPages);
}

function collectEdgeTextStats(
  lines: TextLine[],
  pageExtents: Map<number, PageVerticalExtent>,
): Map<string, RepeatedEdgeTextStat> {
  const stats = new Map<string, RepeatedEdgeTextStat>();
  for (const line of lines) {
    const nearRelative = isNearPageEdge(line, pageExtents);
    const nearBroad = nearRelative || isNearPhysicalPageEdge(line);
    const existing = stats.get(line.text);
    if (existing) {
      updateExistingStat(existing, line.pageIndex, nearRelative, nearBroad);
      continue;
    }
    stats.set(line.text, {
      totalOccurrences: 1,
      edgeOccurrences: nearRelative ? 1 : 0,
      pageIndexes: new Set([line.pageIndex]),
      edgePageIndexes: nearRelative ? new Set([line.pageIndex]) : new Set<number>(),
      broadEdgePageIndexes: nearBroad ? new Set([line.pageIndex]) : new Set<number>(),
    });
  }
  return stats;
}

function updateExistingStat(
  stat: RepeatedEdgeTextStat,
  pageIndex: number,
  nearRelative: boolean,
  nearBroad: boolean,
): void {
  stat.totalOccurrences += 1;
  stat.pageIndexes.add(pageIndex);
  if (nearRelative) {
    stat.edgeOccurrences += 1;
    stat.edgePageIndexes.add(pageIndex);
  }
  if (nearBroad) stat.broadEdgePageIndexes.add(pageIndex);
}

function selectRepeatedEdgeTexts(
  stats: Map<string, RepeatedEdgeTextStat>,
  totalPages: number,
): Set<string> {
  const result = new Set<string>();
  for (const [text, stat] of stats) {
    if (stat.pageIndexes.size < MIN_REPEATED_EDGE_TEXT_PAGES) continue;
    const pageCoverage = stat.pageIndexes.size / Math.max(totalPages, 1);
    if (pageCoverage < MIN_REPEATED_EDGE_TEXT_PAGE_COVERAGE) continue;
    const edgeRatio = stat.edgeOccurrences / stat.totalOccurrences;
    if (edgeRatio >= 0.85) {
      result.add(text);
      continue;
    }
    const edgePageCoverage =
      stat.broadEdgePageIndexes.size / Math.max(stat.pageIndexes.size, 1);
    if (edgePageCoverage >= MIN_RUNNING_LABEL_EDGE_PAGE_COVERAGE && isLikelyRunningLabelText(text)) {
      result.add(text);
    }
  }
  return result;
}

function isLikelyRunningLabelText(text: string): boolean {
  const normalized = normalizeSpacing(text);
  if (normalized.length < MIN_RUNNING_LABEL_LENGTH) return false;
  if (normalized.length > MAX_RUNNING_LABEL_LENGTH) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;
  if (/\d/.test(normalized)) return false;
  const wordCount = normalized.split(" ").filter((p) => p.length > 0).length;
  if (wordCount > MAX_RUNNING_LABEL_WORDS) return false;
  if (!/^[A-Za-z\s&/-]+$/.test(normalized)) return false;
  const alphaOnly = normalized.replace(/[^A-Za-z]/g, "");
  const uppercaseRatio =
    alphaOnly.length > 0 ? alphaOnly.replace(/[^A-Z]/g, "").length / alphaOnly.length : 0;
  return uppercaseRatio >= 0.9;
}

function isLikelyArxivSubmissionStamp(line: TextLine, bodyFontSize: number): boolean {
  if (!ARXIV_SUBMISSION_STAMP_PATTERN.test(line.text)) return false;
  if (line.estimatedWidth > line.pageWidth * 0.7) return false;
  const minFontSize = Math.max(
    bodyFontSize + ARXIV_SUBMISSION_STAMP_MIN_FONT_SIZE_DELTA,
    bodyFontSize * ARXIV_SUBMISSION_STAMP_MIN_FONT_SIZE_RATIO,
  );
  return line.fontSize >= minFontSize;
}

export function findLikelyPageNumberLines(
  lines: TextLine[],
  pageExtents: Map<number, PageVerticalExtent>,
): Set<TextLine> {
  const totalPages = new Set(lines.map((l) => l.pageIndex)).size;
  const numericEdgeLines = collectNumericEdgeLines(lines, pageExtents);
  const selectedOffsets = findPageNumberOffsets(numericEdgeLines, totalPages);
  const result = new Set<TextLine>();
  for (const entry of numericEdgeLines) {
    if (selectedOffsets.has(entry.offset)) result.add(entry.line);
  }
  return result;
}

function collectNumericEdgeLines(
  lines: TextLine[],
  pageExtents: Map<number, PageVerticalExtent>,
): NumericEdgeLine[] {
  const result: NumericEdgeLine[] = [];
  for (const line of lines) {
    if (!isStandalonePageNumber(line, pageExtents)) continue;
    const value = Number.parseInt(line.text, 10);
    if (Number.isNaN(value)) continue;
    result.push({ line, offset: value - line.pageIndex });
  }
  return result;
}

function findPageNumberOffsets(entries: NumericEdgeLine[], totalPages: number): Set<number> {
  const byOffset = new Map<number, NumericEdgeLine[]>();
  for (const entry of entries) {
    const existing = byOffset.get(entry.offset);
    if (existing) existing.push(entry);
    else byOffset.set(entry.offset, [entry]);
  }
  const selected = new Set<number>();
  for (const [offset, group] of byOffset) {
    const pageCount = new Set(group.map((e) => e.line.pageIndex)).size;
    if (pageCount < MIN_PAGE_NUMBER_SEQUENCE_PAGES) continue;
    if (pageCount / Math.max(totalPages, 1) >= MIN_PAGE_NUMBER_SEQUENCE_COVERAGE) {
      selected.add(offset);
    }
  }
  return selected;
}

function stripRepeatedEdgeTextAffixes(
  lines: TextLine[],
  repeatedEdgeTexts: Set<string>,
): TextLine[] {
  if (repeatedEdgeTexts.size === 0) return lines;
  const edgeTexts = [...repeatedEdgeTexts]
    .filter((t) => t.length >= MIN_EDGE_TEXT_AFFIX_LENGTH)
    .sort((a, b) => b.length - a.length);
  if (edgeTexts.length === 0) return lines;
  return lines.map((line) => {
    const stripped = stripEdgeTextAffixes(line.text, edgeTexts);
    return stripped === line.text ? line : { ...line, text: stripped };
  });
}

function stripArxivSubmissionStampAffixes(lines: TextLine[]): TextLine[] {
  return lines.map((line) => {
    const stripped = stripArxivSubmissionStampAffixesFromText(line.text);
    return stripped === line.text ? line : { ...line, text: stripped };
  });
}

function stripArxivSubmissionStampAffixesFromText(text: string): string {
  let current = text;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    let changed = false;

    const prefixMatch = new RegExp(`^${ARXIV_SUBMISSION_STAMP_PATTERN.source}`, "i").exec(current);
    if (prefixMatch) {
      const strippedPrefix = stripTextPrefix(current, prefixMatch[0]);
      if (strippedPrefix !== current) {
        current = strippedPrefix;
        changed = true;
      }
    }

    const suffixMatch = new RegExp(`${ARXIV_SUBMISSION_STAMP_PATTERN.source}$`, "i").exec(current);
    if (suffixMatch) {
      const strippedSuffix = stripTextSuffix(current, suffixMatch[0]);
      if (strippedSuffix !== current) {
        current = strippedSuffix;
        changed = true;
      }
    }

    current = normalizeSpacing(current);
    if (!changed) break;
  }
  return current;
}

function stripEdgeTextAffixes(text: string, edgeTexts: string[]): string {
  let current = text;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    let changed = false;
    for (const edgeText of edgeTexts) {
      const strippedPrefix = stripTextPrefix(current, edgeText);
      if (strippedPrefix !== current) { current = strippedPrefix; changed = true; }
      const strippedSuffix = stripTextSuffix(current, edgeText);
      if (strippedSuffix !== current) { current = strippedSuffix; changed = true; }
    }
    current = normalizeSpacing(current);
    if (!changed) break;
  }
  return current;
}

function stripTextPrefix(text: string, prefix: string): string {
  if (text === prefix) return "";
  if (!text.startsWith(prefix)) return text;
  const trailing = text.slice(prefix.length, prefix.length + 1);
  return isEdgeTextBoundary(trailing) ? text.slice(prefix.length) : text;
}

function stripTextSuffix(text: string, suffix: string): string {
  if (text === suffix) return "";
  if (!text.endsWith(suffix)) return text;
  const leading = text.slice(text.length - suffix.length - 1, text.length - suffix.length);
  return isEdgeTextBoundary(leading) ? text.slice(0, text.length - suffix.length) : text;
}

function isEdgeTextBoundary(character: string): boolean {
  if (character.length === 0) return true;
  return /[\s()[\]{}.,;:!?'"/-]/.test(character);
}

function isStandaloneCitationMarker(text: string): boolean {
  return STANDALONE_CITATION_MARKER_PATTERN.test(normalizeSpacing(text));
}

function isLikelyPublisherPageCounterFooter(
  line: TextLine,
  pageExtents: Map<number, PageVerticalExtent>,
): boolean {
  const normalized = normalizeSpacing(line.text);
  if (!PAGE_COUNTER_PATTERN.test(normalized)) return false;
  if (!DOMAIN_LIKE_TOKEN_PATTERN.test(normalized)) return false;
  return isNearPageEdge(line, pageExtents) || isNearPhysicalPageEdge(line);
}

function isLikelyTopMatterAffiliationIndexLine(
  line: TextLine,
  bodyFontSize: number,
): boolean {
  if (line.pageIndex !== 0) return false;
  if (line.pageHeight <= 0) return false;
  if (line.y / line.pageHeight < TOP_MATTER_AFFILIATION_MIN_VERTICAL_RATIO) return false;
  if (line.fontSize > bodyFontSize * TOP_MATTER_AFFILIATION_MAX_FONT_RATIO) return false;

  const normalized = normalizeSpacing(line.text);
  if (!TOP_MATTER_AFFILIATION_INDEX_PATTERN.test(normalized)) return false;

  const indexTokens = normalized.match(/\d+/g) ?? [];
  if (indexTokens.length < TOP_MATTER_AFFILIATION_MIN_INDEX_TOKENS) return false;
  if (!indexTokens.some((token) => token.length === 1)) return false;
  return indexTokens.every((token) => token.length <= 2);
}
