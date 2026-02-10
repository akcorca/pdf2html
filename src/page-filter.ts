// biome-ignore lint/nursery/noExcessiveLinesPerFile: page artifact heuristics are intentionally grouped.
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
  countWords,
  computePageVerticalExtents,
  estimateBodyFontSize,
  groupLinesByPage,
  isNearPageEdge,
  isNearPhysicalPageEdge,
  isStandalonePageNumber,
  normalizeSpacing,
} from "./text-lines.ts";

const STANDALONE_CITATION_MARKER_PATTERN =
  /^(?:\[\d{1,3}(?:,\s*\d{1,3})*\])(?:\s+\[\d{1,3}(?:,\s*\d{1,3})*\])*$/;
const INLINE_CITATION_ONLY_PATTERN = /^\[\d{1,3}(?:\s*,\s*\d{1,3})*\][.,;:!?]?$/;
const STANDALONE_DOI_METADATA_PATTERN = /^(?:doi\s*:\s*)?10\.\d{4,9}\/[-._;()/:a-z0-9]+$/iu;
const STANDALONE_DOI_METADATA_MAX_PAGE_INDEX = 1;
const STANDALONE_SYMBOL_ARTIFACT_PATTERN = /^[!)+\u2032]+$/u;
const FOOTNOTE_MARKER_ONLY_SYMBOL_PATTERN = /^[*∗†‡§¶#]+$/u;
const STANDALONE_SYMBOL_ARTIFACT_MAX_CHARS = 3;
const STANDALONE_SYMBOL_ARTIFACT_MAX_FONT_RATIO = 1.2;
const STANDALONE_SYMBOL_ARTIFACT_MAX_WIDTH_RATIO = 0.15;
const PAGE_COUNTER_PATTERN = /\(\d+\s+of\s+\d+\)/i;
const DOMAIN_LIKE_TOKEN_PATTERN = /\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/;
const AUTHOR_RUNNING_LABEL_PATTERN = /\bet\s+al\.?$/iu;
const AUTHOR_RUNNING_LABEL_MIN_PAGE_COVERAGE = 0.45;
const AUTHOR_RUNNING_LABEL_MIN_PAGE_COUNT = 4;
const MIN_REPEATED_EDGE_OCCURRENCE_RATIO = 0.85;
const REPEATED_EDGE_TEXT_FONT_SIZE_TOLERANCE = 1.5;
const TOP_MATTER_AFFILIATION_INDEX_PATTERN = /^[\d\s,.;:()[\]{}+-]+$/;
const TOP_MATTER_AFFILIATION_MIN_VERTICAL_RATIO = 0.72;
const TOP_MATTER_AFFILIATION_MAX_FONT_RATIO = 0.82;
const TOP_MATTER_AFFILIATION_MIN_INDEX_TOKENS = 2;
const TOP_MATTER_SYMBOLIC_AFFILIATION_PATTERN = /^(?:[*∗†‡§¶#]\s*){2,}$/u;
const TOP_MATTER_SYMBOLIC_AFFILIATION_MIN_VERTICAL_RATIO = 0.55;
const TOP_MATTER_SYMBOLIC_AFFILIATION_MAX_VERTICAL_RATIO = 0.72;
const TOP_MATTER_SYMBOLIC_AFFILIATION_MAX_FONT_RATIO = 0.82;
const TOP_MATTER_CONTACT_EMAIL_PREFIX_PATTERN = /^e-?mail\s*:/iu;
const TOP_MATTER_CONTACT_EMAIL_ADDRESS_PATTERN =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u;
const TOP_MATTER_CONTACT_EMAIL_MIN_VERTICAL_RATIO = 0.08;
const TOP_MATTER_CONTACT_EMAIL_MAX_VERTICAL_RATIO = 0.35;
const TOP_MATTER_CONTACT_EMAIL_MAX_FONT_RATIO = 0.96;
const TOP_MATTER_CONTACT_EMAIL_MAX_WORDS = 10;
const TOP_MATTER_ALPHABETIC_AFFILIATION_MAX_PAGE_INDEX = 1;
const TOP_MATTER_ALPHABETIC_AFFILIATION_MIN_VERTICAL_RATIO = 0.5;
const TOP_MATTER_ALPHABETIC_AFFILIATION_MAX_VERTICAL_RATIO = 0.8;
const TOP_MATTER_ALPHABETIC_AFFILIATION_MAX_FONT_RATIO = 0.98;
const TOP_MATTER_ALPHABETIC_AFFILIATION_MIN_CLUSTER_SIZE = 3;
const TOP_MATTER_ALPHABETIC_AFFILIATION_CLUSTER_X_TOLERANCE = 8;
const TOP_MATTER_ALPHABETIC_AFFILIATION_MAX_TOKENS = 16;
const TOP_MATTER_ALPHABETIC_AFFILIATION_TOKEN_PATTERN = /^[a-z*]$/u;
const TOP_MATTER_ALPHABETIC_AFFILIATION_SINGLE_TOKEN_PATTERN = /^[a-z]$/u;
const INLINE_FIGURE_LABEL_MAX_FONT_RATIO = 0.72;
const INLINE_FIGURE_LABEL_MIN_RIGHT_X_RATIO = 0.42;
const INLINE_FIGURE_LABEL_MIN_VERTICAL_RATIO = 0.45;
const INLINE_FIGURE_LABEL_MAX_VERTICAL_RATIO = 0.9;
const INLINE_FIGURE_LABEL_MIN_SUBSTANTIVE_CHARS = 4;
const INLINE_FIGURE_LABEL_NEAR_BODY_LEFT_MAX_X_RATIO = 0.28;
const INLINE_FIGURE_LABEL_NEAR_BODY_MIN_FONT_RATIO = 0.9;
const INLINE_FIGURE_LABEL_NEAR_BODY_MAX_Y_DELTA_FONT_RATIO = 2.4;
const INLINE_FIGURE_LABEL_NEAR_BODY_MIN_Y_DELTA = 10;
const INLINE_FIGURE_LABEL_NEAR_BODY_MIN_SUBSTANTIVE_CHARS = 8;
const DENSE_INLINE_FIGURE_LABEL_MIN_LINES = 20;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_PATTERN = /^Figure\s+\d+[A-Za-z]?:\s+/u;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_END_PATTERN = /[.!?]["')\]]?$/;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_HYPHEN_WRAP_PATTERN = /-\s*$/;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_MIN_RIGHT_X_RATIO = 0.5;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_MIN_VERTICAL_RATIO = 0.45;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_MAX_VERTICAL_RATIO = 0.72;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_MAX_WIDTH_RATIO = 0.42;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_HYPHEN_WRAP_MAX_WIDTH_RATIO = 0.5;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_MAX_FONT_RATIO = 1.08;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_MIN_SUBSTANTIVE_CHARS = 20;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_MAX_WORDS = 14;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_CONTINUATION_START_PATTERN = /^[a-z0-9(“‘"']/u;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_CONTINUATION_MIN_SUBSTANTIVE_CHARS = 8;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_CONTINUATION_MAX_Y_DELTA_FONT_RATIO = 2.6;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_CONTINUATION_MIN_Y_DELTA = 8;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_CONTINUATION_MAX_X_DELTA_RATIO = 0.04;
const FIRST_PAGE_INLINE_FIGURE_CAPTION_CONTINUATION_MAX_FONT_DELTA = 0.6;
const FIRST_PAGE_VENUE_FOOTER_MAX_VERTICAL_RATIO = 0.12;
const FIRST_PAGE_VENUE_FOOTER_MAX_FONT_RATIO = 0.96;
const FIRST_PAGE_VENUE_FOOTER_MIN_SUBSTANTIVE_CHARS = 20;
const FIRST_PAGE_VENUE_FOOTER_MAX_SUBSTANTIVE_CHARS = 140;
const FIRST_PAGE_VENUE_FOOTER_YEAR_PATTERN = /\b(?:19|20)\d{2}\b/;
const FIRST_PAGE_VENUE_FOOTER_KEYWORD_PATTERN =
  /\b(?:conference|proceedings|journal|workshop|symposium|transactions)\b/iu;
const PUBLISHER_IMPRINT_FOOTER_MAX_FONT_RATIO = 1.05;
const PUBLISHER_IMPRINT_FOOTER_MIN_SUBSTANTIVE_CHARS = 24;
const PUBLISHER_IMPRINT_FOOTER_MIN_CORPORATE_TOKEN_COUNT = 2;
const PUBLISHER_IMPRINT_FOOTER_CORPORATE_TOKEN_PATTERN =
  /\b(?:verlag|gmbh|kgaa|ltd\.?|inc\.?|llc|corp\.?|corporation|press|publishing)\b/giu;
const PUBLISHER_IMPRINT_FOOTER_LONG_NUMBER_PATTERN = /\b\d{4,8}\b/g;
const SPECIAL_TOKEN_ARTIFACT_PATTERN = /<\s*(?:pad|eos|bos|unk)\s*>/giu;
const SPECIAL_TOKEN_ARTIFACT_MAX_FONT_RATIO = 0.96;
const SPECIAL_TOKEN_ARTIFACT_MAX_WORDS_WITH_SINGLE_TOKEN = 4;
const DETACHED_MATH_FRAGMENT_ALLOWED_PATTERN = /^[A-Za-z0-9\s−\-+*/=(){}\[\],.;:√∞]+$/u;
const DETACHED_MATH_FRAGMENT_MAX_TEXT_LENGTH = 18;
const DETACHED_MATH_FRAGMENT_MAX_TOKENS = 6;
const DETACHED_MATH_FRAGMENT_MAX_ALPHA_TOKEN_LENGTH = 2;
const DETACHED_MATH_FRAGMENT_MAX_ALPHA_CHARS = 4;
const DETACHED_MATH_FRAGMENT_MAX_FONT_RATIO = 1.05;
const DETACHED_MATH_FRAGMENT_MAX_WIDTH_RATIO = 0.52;
const DETACHED_MATH_FRAGMENT_MIN_PROSE_CHARS = 24;
const DETACHED_MATH_FRAGMENT_MIN_PROSE_WORDS = 4;
const DETACHED_MATH_FRAGMENT_MAX_PROSE_FONT_RATIO = 1.2;
const DETACHED_MATH_FRAGMENT_MAX_CONTEXT_Y_GAP = 96;
const DETACHED_MATH_FRAGMENT_MAX_CONTEXT_X_DELTA_RATIO = 0.1;
const ALTERNATING_RUNNING_HEADER_MIN_PAGES = 2;
const ALTERNATING_RUNNING_HEADER_MIN_PAGE_COVERAGE = 0.3;
const ALTERNATING_RUNNING_HEADER_MIN_TEXT_LENGTH = 20;
const ALTERNATING_RUNNING_HEADER_MAX_TEXT_LENGTH = 160;
const ALTERNATING_RUNNING_HEADER_MIN_WORDS = 4;
const ALTERNATING_RUNNING_HEADER_MAX_WORDS = 20;
const ALTERNATING_RUNNING_HEADER_MAX_DIGIT_RATIO = 0.15;
const ALTERNATING_RUNNING_HEADER_MAX_FONT_RATIO = 0.92;
const ALTERNATING_RUNNING_HEADER_EDGE_MARGIN = 0.1;
const ALTERNATING_RUNNING_HEADER_MIN_TOP_RATIO = 0.8;
const ALTERNATING_RUNNING_HEADER_MAX_X_DRIFT_RATIO = 0.06;
const MAX_AFFIX_STRIP_ITERATIONS = 3;
const ARXIV_SUBMISSION_STAMP_PREFIX_PATTERN = new RegExp(
  `^${ARXIV_SUBMISSION_STAMP_PATTERN.source}`,
  "i",
);
const ARXIV_SUBMISSION_STAMP_SUFFIX_PATTERN = new RegExp(
  `${ARXIV_SUBMISSION_STAMP_PATTERN.source}$`,
  "i",
);

interface StripAffixIterationResult {
  text: string;
  changed: boolean;
}

interface RepeatedEdgeCoverage {
  pageCount: number;
  pageCoverage: number;
  edgeRatio: number;
  edgePageCoverage: number;
}

interface PageArtifactContext {
  bodyFontSize: number;
  pageExtents: Map<number, PageVerticalExtent>;
  repeatedEdgeTexts: Map<string, number>;
  removableLines: Set<TextLine>;
}

interface LineRegionCriteria {
  exactPageIndex?: number;
  maxPageIndex?: number;
  minVerticalRatio?: number;
  maxVerticalRatio?: number;
  maxBodyFontRatio?: number;
}

export function filterPageArtifacts(lines: TextLine[]): TextLine[] {
  if (lines.length === 0) return lines;
  const bodyFontSize = estimateBodyFontSize(lines);
  const pageExtents = computePageVerticalExtents(lines);
  const repeatedEdgeTexts = findRepeatedEdgeTexts(lines, pageExtents);
  const strippedLines = stripArxivSubmissionStampAffixes(
    stripRepeatedEdgeTextAffixes(lines, repeatedEdgeTexts),
  );
  const removableLines = collectRemovablePageArtifactLines(strippedLines, pageExtents, bodyFontSize);
  const context: PageArtifactContext = {
    bodyFontSize,
    pageExtents,
    repeatedEdgeTexts,
    removableLines,
  };

  return strippedLines.filter((line) => !isRemovablePageArtifact(line, context));
}

function collectRemovablePageArtifactLines(
  lines: TextLine[],
  pageExtents: Map<number, PageVerticalExtent>,
  bodyFontSize: number,
): Set<TextLine> {
  return mergeLineSets([
    findLikelyPageNumberLines(lines, pageExtents),
    findLikelyTopMatterAlphabeticAffiliationLines(lines, bodyFontSize),
    findLikelyInlineFigureLabelLines(lines, bodyFontSize),
    findLikelyFirstPageInlineFigureCaptionLines(lines, bodyFontSize),
    findLikelyDetachedMathFragmentLines(lines, bodyFontSize),
    findLikelyAlternatingRunningHeaderLines(lines, pageExtents, bodyFontSize),
  ]);
}

function mergeLineSets(lineSets: ReadonlyArray<Set<TextLine>>): Set<TextLine> {
  const merged = new Set<TextLine>();
  for (const lineSet of lineSets) {
    for (const line of lineSet) {
      merged.add(line);
    }
  }
  return merged;
}

function isRemovablePageArtifact(line: TextLine, context: PageArtifactContext): boolean {
  if (line.text.length === 0) return true;
  if (context.removableLines.has(line)) return true;
  if (isRepeatedEdgeTextInstance(line, context.repeatedEdgeTexts)) return true;
  if (isStandaloneCitationMarker(line.text)) return true;
  return isLikelyIntrinsicArtifact(line, context.bodyFontSize, context.pageExtents);
}

function isRepeatedEdgeTextInstance(
  line: TextLine,
  repeatedEdgeTexts: Map<string, number>,
): boolean {
  const minEdgeFontSize = repeatedEdgeTexts.get(line.text);
  if (minEdgeFontSize === undefined) return false;
  return line.fontSize <= minEdgeFontSize + REPEATED_EDGE_TEXT_FONT_SIZE_TOLERANCE;
}

function isLikelyIntrinsicArtifact(
  line: TextLine,
  bodyFontSize: number,
  pageExtents: Map<number, PageVerticalExtent>,
): boolean {
  return (
    isLikelyStandaloneSymbolArtifact(line, bodyFontSize) ||
    isLikelyArxivSubmissionStamp(line, bodyFontSize) ||
    isLikelyStandaloneDoiMetadataLine(line) ||
    isLikelySpecialTokenArtifactLine(line, bodyFontSize) ||
    isLikelyPublisherPageCounterFooter(line, pageExtents) ||
    isLikelyPublisherImprintFooterLine(line, bodyFontSize, pageExtents) ||
    isLikelyTopMatterAffiliationIndexLine(line, bodyFontSize) ||
    isLikelyTopMatterSymbolicAffiliationLine(line, bodyFontSize) ||
    isLikelyTopMatterContactEmailLine(line, bodyFontSize) ||
    isLikelyFirstPageVenueFooterLine(line, bodyFontSize)
  );
}

function matchesLineRegion(
  line: TextLine,
  bodyFontSize: number,
  criteria: LineRegionCriteria,
): boolean {
  if (criteria.exactPageIndex !== undefined && line.pageIndex !== criteria.exactPageIndex) {
    return false;
  }
  if (criteria.maxPageIndex !== undefined && line.pageIndex > criteria.maxPageIndex) return false;
  if (
    criteria.maxBodyFontRatio !== undefined &&
    line.fontSize > bodyFontSize * criteria.maxBodyFontRatio
  ) {
    return false;
  }
  if (criteria.minVerticalRatio === undefined && criteria.maxVerticalRatio === undefined) {
    return true;
  }
  if (line.pageHeight <= 0) return false;
  const verticalRatio = line.y / line.pageHeight;
  if (criteria.minVerticalRatio !== undefined && verticalRatio < criteria.minVerticalRatio) {
    return false;
  }
  if (criteria.maxVerticalRatio !== undefined && verticalRatio > criteria.maxVerticalRatio) {
    return false;
  }
  return true;
}

export function findRepeatedEdgeTexts(
  lines: TextLine[],
  pageExtents: Map<number, PageVerticalExtent>,
): Map<string, number> {
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
    const stat = getOrCreateEdgeTextStat(stats, line.text);
    addEdgeTextOccurrence(stat, line.pageIndex, nearRelative, nearBroad, line.fontSize);
  }
  return stats;
}

function getOrCreateEdgeTextStat(
  stats: Map<string, RepeatedEdgeTextStat>,
  text: string,
): RepeatedEdgeTextStat {
  const existing = stats.get(text);
  if (existing) return existing;

  const created: RepeatedEdgeTextStat = {
    totalOccurrences: 0,
    edgeOccurrences: 0,
    pageIndexes: new Set<number>(),
    edgePageIndexes: new Set<number>(),
    broadEdgePageIndexes: new Set<number>(),
    minEdgeFontSize: Number.POSITIVE_INFINITY,
  };
  stats.set(text, created);
  return created;
}

function addEdgeTextOccurrence(
  stat: RepeatedEdgeTextStat,
  pageIndex: number,
  nearRelative: boolean,
  nearBroad: boolean,
  fontSize: number,
): void {
  stat.totalOccurrences += 1;
  stat.pageIndexes.add(pageIndex);
  if (nearRelative) {
    stat.edgeOccurrences += 1;
    stat.edgePageIndexes.add(pageIndex);
    stat.minEdgeFontSize = Math.min(stat.minEdgeFontSize, fontSize);
  }
  if (nearBroad) stat.broadEdgePageIndexes.add(pageIndex);
}

function selectRepeatedEdgeTexts(
  stats: Map<string, RepeatedEdgeTextStat>,
  totalPages: number,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [text, stat] of stats) {
    const coverage = computeRepeatedEdgeCoverage(stat, totalPages);
    if (coverage.pageCount < MIN_REPEATED_EDGE_TEXT_PAGES) continue;
    if (isRepeatedAuthorRunningLabel(text, coverage) || isRepeatedEdgeLabel(text, coverage)) {
      result.set(text, stat.minEdgeFontSize);
    }
  }
  return result;
}

function computeRepeatedEdgeCoverage(
  stat: RepeatedEdgeTextStat,
  totalPages: number,
): RepeatedEdgeCoverage {
  const pageCount = stat.pageIndexes.size;
  return {
    pageCount,
    pageCoverage: pageCount / Math.max(totalPages, 1),
    edgeRatio: stat.edgeOccurrences / Math.max(stat.totalOccurrences, 1),
    edgePageCoverage: stat.broadEdgePageIndexes.size / Math.max(pageCount, 1),
  };
}

function isRepeatedAuthorRunningLabel(text: string, coverage: RepeatedEdgeCoverage): boolean {
  if (!isLikelyAuthorRunningLabelText(text)) return false;
  return (
    coverage.pageCount >= AUTHOR_RUNNING_LABEL_MIN_PAGE_COUNT &&
    coverage.pageCoverage >= AUTHOR_RUNNING_LABEL_MIN_PAGE_COVERAGE &&
    coverage.edgeRatio >= MIN_REPEATED_EDGE_OCCURRENCE_RATIO &&
    coverage.edgePageCoverage >= MIN_RUNNING_LABEL_EDGE_PAGE_COVERAGE
  );
}

function isRepeatedEdgeLabel(text: string, coverage: RepeatedEdgeCoverage): boolean {
  if (coverage.pageCoverage < MIN_REPEATED_EDGE_TEXT_PAGE_COVERAGE) return false;
  if (coverage.edgeRatio >= MIN_REPEATED_EDGE_OCCURRENCE_RATIO) return true;
  if (!isLikelyRunningLabelText(text)) return false;
  // Running-label text that appears on enough pages and has at least some edge
  // occurrences is still a running header even if some instances sit slightly
  // below the physical page top (e.g. in alternating-column layouts).
  return coverage.edgePageCoverage >= MIN_REPEATED_EDGE_TEXT_PAGE_COVERAGE;
}

function isLikelyAuthorRunningLabelText(text: string): boolean {
  const normalized = normalizeSpacing(text);
  if (!AUTHOR_RUNNING_LABEL_PATTERN.test(normalized)) return false;
  if (normalized.length < 8 || normalized.length > 48) return false;
  if (/\d/.test(normalized)) return false;

  const tokens = normalized.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length < 3 || tokens.length > 7) return false;

  const trailing = `${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`.toLowerCase();
  if (trailing !== "et al." && trailing !== "et al") return false;

  const authorTokens = tokens.slice(0, -2);
  if (authorTokens.length < 1 || authorTokens.length > 4) return false;
  return authorTokens.every((token) => /^[A-Z][A-Za-z.'-]*$/u.test(token));
}

function isLikelyRunningLabelText(text: string): boolean {
  const normalized = normalizeSpacing(text);
  if (normalized.length < MIN_RUNNING_LABEL_LENGTH) return false;
  if (normalized.length > MAX_RUNNING_LABEL_LENGTH) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;
  if (/\d/.test(normalized)) return false;
  const wordCount = countWords(normalized);
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
  return new Set(
    numericEdgeLines
      .filter((entry) => selectedOffsets.has(entry.offset))
      .map((entry) => entry.line),
  );
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
  const pageIndexesByOffset = new Map<number, Set<number>>();
  for (const entry of entries) {
    const existing = pageIndexesByOffset.get(entry.offset);
    if (existing) existing.add(entry.line.pageIndex);
    else pageIndexesByOffset.set(entry.offset, new Set([entry.line.pageIndex]));
  }
  const pageCountDenominator = Math.max(totalPages, 1);
  const selected = new Set<number>();
  for (const [offset, pageIndexes] of pageIndexesByOffset) {
    const pageCount = pageIndexes.size;
    if (pageCount < MIN_PAGE_NUMBER_SEQUENCE_PAGES) continue;
    if (pageCount / pageCountDenominator >= MIN_PAGE_NUMBER_SEQUENCE_COVERAGE) {
      selected.add(offset);
    }
  }
  return selected;
}

function stripRepeatedEdgeTextAffixes(
  lines: TextLine[],
  repeatedEdgeTexts: Map<string, number>,
): TextLine[] {
  if (repeatedEdgeTexts.size === 0) return lines;
  const edgeTextEntries = [...repeatedEdgeTexts.entries()]
    .filter(([t]) => t.length >= MIN_EDGE_TEXT_AFFIX_LENGTH)
    .sort(([a], [b]) => b.length - a.length);
  if (edgeTextEntries.length === 0) return lines;
  return lines.map((line) => {
    const applicableTexts = edgeTextEntries
      .filter(([, minFS]) => line.fontSize <= minFS + REPEATED_EDGE_TEXT_FONT_SIZE_TOLERANCE)
      .map(([t]) => t);
    if (applicableTexts.length === 0) return line;
    const transformed = stripEdgeTextAffixes(line.text, applicableTexts);
    return transformed === line.text ? line : { ...line, text: transformed };
  });
}

function stripArxivSubmissionStampAffixes(lines: TextLine[]): TextLine[] {
  return mapLinesWithTextTransform(lines, stripArxivSubmissionStampAffixesFromText);
}

function mapLinesWithTextTransform(
  lines: TextLine[],
  transformText: (text: string) => string,
): TextLine[] {
  return lines.map((line) => {
    const transformed = transformText(line.text);
    return transformed === line.text ? line : { ...line, text: transformed };
  });
}

function findLikelyAlternatingRunningHeaderLines(
  lines: TextLine[],
  pageExtents: Map<number, PageVerticalExtent>,
  bodyFontSize: number,
): Set<TextLine> {
  if (lines.length === 0) return new Set<TextLine>();
  const totalPages = new Set(lines.map((line) => line.pageIndex)).size;
  if (totalPages < 3) return new Set<TextLine>();

  const result = new Set<TextLine>();
  for (const [text, occurrences] of groupLinesByExactText(lines)) {
    const candidateLines = selectAlternatingRunningHeaderGroupLines(
      text,
      occurrences,
      totalPages,
      pageExtents,
      bodyFontSize,
    );
    if (!candidateLines) continue;
    for (const line of candidateLines) result.add(line);
  }
  return result;
}

function groupLinesByExactText(lines: TextLine[]): Map<string, TextLine[]> {
  const grouped = new Map<string, TextLine[]>();
  for (const line of lines) {
    const existing = grouped.get(line.text);
    if (existing) existing.push(line);
    else grouped.set(line.text, [line]);
  }
  return grouped;
}

function selectAlternatingRunningHeaderGroupLines(
  text: string,
  occurrences: TextLine[],
  totalPages: number,
  pageExtents: Map<number, PageVerticalExtent>,
  bodyFontSize: number,
): TextLine[] | undefined {
  if (!isLikelyAlternatingRunningHeaderText(text)) return undefined;
  const pageIndexes = getUniqueSortedPageIndexes(occurrences);
  if (!hasMinimumAlternatingPageCoverage(pageIndexes, totalPages)) return undefined;
  if (!sharesSinglePageParity(pageIndexes)) return undefined;
  if (
    !occurrences.every((line) =>
      isLikelyAlternatingRunningHeaderLine(line, pageExtents, bodyFontSize),
    )
  ) {
    return undefined;
  }
  if (!hasStableHorizontalAlignment(occurrences)) return undefined;
  return occurrences;
}

function getUniqueSortedPageIndexes(lines: TextLine[]): number[] {
  return [...new Set(lines.map((line) => line.pageIndex))].sort((left, right) => left - right);
}

function hasMinimumAlternatingPageCoverage(pageIndexes: number[], totalPages: number): boolean {
  if (pageIndexes.length < ALTERNATING_RUNNING_HEADER_MIN_PAGES) return false;
  return (
    pageIndexes.length / Math.max(totalPages, 1) >= ALTERNATING_RUNNING_HEADER_MIN_PAGE_COVERAGE
  );
}

function isLikelyAlternatingRunningHeaderText(text: string): boolean {
  const normalized = normalizeSpacing(text);
  if (
    normalized.length < ALTERNATING_RUNNING_HEADER_MIN_TEXT_LENGTH ||
    normalized.length > ALTERNATING_RUNNING_HEADER_MAX_TEXT_LENGTH
  ) {
    return false;
  }
  if (!/[A-Za-z]/.test(normalized)) return false;
  if (/(?:https?:\/\/|www\.)/iu.test(normalized)) return false;
  if (/[.!?]$/.test(normalized)) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < ALTERNATING_RUNNING_HEADER_MIN_WORDS) return false;
  if (words.length > ALTERNATING_RUNNING_HEADER_MAX_WORDS) return false;
  if (countSubstantiveChars(normalized) < ALTERNATING_RUNNING_HEADER_MIN_TEXT_LENGTH) {
    return false;
  }

  const alphanumericCount = normalized.replace(/[^A-Za-z0-9]/g, "").length;
  const digitCount = normalized.replace(/[^0-9]/g, "").length;
  return digitCount / Math.max(alphanumericCount, 1) <= ALTERNATING_RUNNING_HEADER_MAX_DIGIT_RATIO;
}

function sharesSinglePageParity(pageIndexes: number[]): boolean {
  if (pageIndexes.length < 2) return false;
  const expectedParity = pageIndexes[0] % 2;
  return pageIndexes.every((pageIndex) => pageIndex % 2 === expectedParity);
}

function isLikelyAlternatingRunningHeaderLine(
  line: TextLine,
  pageExtents: Map<number, PageVerticalExtent>,
  bodyFontSize: number,
): boolean {
  if (
    !matchesLineRegion(line, bodyFontSize, {
      minVerticalRatio: ALTERNATING_RUNNING_HEADER_MIN_TOP_RATIO,
      maxBodyFontRatio: ALTERNATING_RUNNING_HEADER_MAX_FONT_RATIO,
    })
  ) {
    return false;
  }
  if (
    !isNearPageEdge(line, pageExtents, ALTERNATING_RUNNING_HEADER_EDGE_MARGIN) &&
    !isNearPhysicalPageEdge(line, ALTERNATING_RUNNING_HEADER_EDGE_MARGIN)
  ) {
    return false;
  }
  return true;
}

function hasStableHorizontalAlignment(lines: TextLine[]): boolean {
  if (lines.length < 2) return false;
  const minX = Math.min(...lines.map((line) => line.x));
  const maxX = Math.max(...lines.map((line) => line.x));
  const pageWidth = Math.max(...lines.map((line) => line.pageWidth), 1);
  return maxX - minX <= pageWidth * ALTERNATING_RUNNING_HEADER_MAX_X_DRIFT_RATIO;
}

function stripArxivSubmissionStampAffixesFromText(text: string): string {
  return stripAffixesIteratively(text, (current) => {
    const matchedAffixes: string[] = [];
    const prefixMatch = ARXIV_SUBMISSION_STAMP_PREFIX_PATTERN.exec(current);
    if (prefixMatch?.[0]) matchedAffixes.push(prefixMatch[0]);
    const suffixMatch = ARXIV_SUBMISSION_STAMP_SUFFIX_PATTERN.exec(current);
    if (suffixMatch?.[0]) matchedAffixes.push(suffixMatch[0]);
    return stripTextAffixes(current, matchedAffixes);
  });
}

function stripEdgeTextAffixes(text: string, edgeTexts: string[]): string {
  return stripAffixesIteratively(text, (current) => stripTextAffixes(current, edgeTexts));
}

function stripTextAffixes(text: string, affixes: string[]): StripAffixIterationResult {
  let next = text;
  for (const affix of affixes) {
    if (affix.length === 0) continue;
    next = stripTextAffixBoundary(next, affix, "prefix");
    next = stripTextAffixBoundary(next, affix, "suffix");
  }
  return { text: next, changed: next !== text };
}

function stripAffixesIteratively(
  text: string,
  stripAffixes: (current: string) => StripAffixIterationResult,
): string {
  let current = text;
  for (let iteration = 0; iteration < MAX_AFFIX_STRIP_ITERATIONS; iteration += 1) {
    const stripped = stripAffixes(current);
    current = normalizeSpacing(stripped.text);
    if (!stripped.changed) break;
  }
  return current;
}

function stripTextAffixBoundary(
  text: string,
  affix: string,
  boundary: "prefix" | "suffix",
): string {
  if (text === affix) return "";
  if (boundary === "prefix") {
    if (!text.startsWith(affix)) return text;
    const trailing = text.slice(affix.length, affix.length + 1);
    return isEdgeTextBoundary(trailing) ? text.slice(affix.length) : text;
  }
  if (!text.endsWith(affix)) return text;
  const leading = text.slice(text.length - affix.length - 1, text.length - affix.length);
  return isEdgeTextBoundary(leading) ? text.slice(0, text.length - affix.length) : text;
}

function isEdgeTextBoundary(character: string): boolean {
  if (character.length === 0) return true;
  return /[\s()[\]{}.,;:!?'"/-]/.test(character);
}

function findLikelyInlineFigureLabelLines(
  lines: TextLine[],
  bodyFontSize: number,
): Set<TextLine> {
  return collectQualifiedPageCandidates(
    lines,
    (line, pageLines) => isLikelyInlineFigureLabelLine(line, pageLines, bodyFontSize),
    (candidates) => candidates.length >= DENSE_INLINE_FIGURE_LABEL_MIN_LINES,
  );
}

function findLikelyFirstPageInlineFigureCaptionLines(
  lines: TextLine[],
  bodyFontSize: number,
): Set<TextLine> {
  const pageLines = groupLinesByPage(lines).get(0) ?? [];
  const result = new Set<TextLine>();
  for (const line of pageLines) {
    if (!isLikelyFirstPageInlineFigureCaptionLine(line, pageLines, bodyFontSize)) continue;
    result.add(line);
    const continuation = findLikelyFirstPageInlineFigureCaptionContinuationLine(
      line,
      pageLines,
      bodyFontSize,
    );
    if (continuation) result.add(continuation);
  }
  return result;
}

function isLikelyFirstPageInlineFigureCaptionLine(
  line: TextLine,
  pageLines: TextLine[],
  bodyFontSize: number,
): boolean {
  if (line.pageWidth <= 0) return false;
  if (
    !matchesLineRegion(line, bodyFontSize, {
      exactPageIndex: 0,
      minVerticalRatio: FIRST_PAGE_INLINE_FIGURE_CAPTION_MIN_VERTICAL_RATIO,
      maxVerticalRatio: FIRST_PAGE_INLINE_FIGURE_CAPTION_MAX_VERTICAL_RATIO,
      maxBodyFontRatio: FIRST_PAGE_INLINE_FIGURE_CAPTION_MAX_FONT_RATIO,
    })
  ) {
    return false;
  }

  const normalized = normalizeSpacing(line.text);
  if (!FIRST_PAGE_INLINE_FIGURE_CAPTION_PATTERN.test(normalized)) return false;
  if (!isLikelyFirstPageInlineFigureCaptionTerminatedLine(normalized)) return false;
  if (countSubstantiveChars(normalized) < FIRST_PAGE_INLINE_FIGURE_CAPTION_MIN_SUBSTANTIVE_CHARS) {
    return false;
  }
  if (countWords(normalized) > FIRST_PAGE_INLINE_FIGURE_CAPTION_MAX_WORDS) return false;

  const relativeX = line.x / line.pageWidth;
  if (relativeX < FIRST_PAGE_INLINE_FIGURE_CAPTION_MIN_RIGHT_X_RATIO) return false;
  const maxWidthRatio = FIRST_PAGE_INLINE_FIGURE_CAPTION_HYPHEN_WRAP_PATTERN.test(normalized)
    ? FIRST_PAGE_INLINE_FIGURE_CAPTION_HYPHEN_WRAP_MAX_WIDTH_RATIO
    : FIRST_PAGE_INLINE_FIGURE_CAPTION_MAX_WIDTH_RATIO;
  if (line.estimatedWidth > line.pageWidth * maxWidthRatio) {
    return false;
  }
  return hasNearbyBodyLineInLeftColumn(line, pageLines, bodyFontSize);
}

function isLikelyFirstPageInlineFigureCaptionTerminatedLine(text: string): boolean {
  return (
    FIRST_PAGE_INLINE_FIGURE_CAPTION_END_PATTERN.test(text) ||
    FIRST_PAGE_INLINE_FIGURE_CAPTION_HYPHEN_WRAP_PATTERN.test(text)
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: continuation matching is evaluated in one spatial pass.
function findLikelyFirstPageInlineFigureCaptionContinuationLine(
  captionLine: TextLine,
  pageLines: TextLine[],
  bodyFontSize: number,
): TextLine | undefined {
  const captionText = normalizeSpacing(captionLine.text);
  if (!FIRST_PAGE_INLINE_FIGURE_CAPTION_HYPHEN_WRAP_PATTERN.test(captionText)) return undefined;

  const maxYDelta = Math.max(
    captionLine.fontSize * FIRST_PAGE_INLINE_FIGURE_CAPTION_CONTINUATION_MAX_Y_DELTA_FONT_RATIO,
    FIRST_PAGE_INLINE_FIGURE_CAPTION_CONTINUATION_MIN_Y_DELTA,
  );
  let nearestContinuation: TextLine | undefined;
  let nearestYDelta = Number.POSITIVE_INFINITY;
  for (const candidate of pageLines) {
    if (candidate === captionLine) continue;
    if (candidate.pageIndex !== captionLine.pageIndex) continue;
    if (candidate.pageWidth <= 0) continue;
    const yDelta = captionLine.y - candidate.y;
    if (yDelta <= 0 || yDelta > maxYDelta) continue;
    if (candidate.x / candidate.pageWidth < FIRST_PAGE_INLINE_FIGURE_CAPTION_MIN_RIGHT_X_RATIO) continue;
    if (
      Math.abs(candidate.x - captionLine.x) >
      candidate.pageWidth * FIRST_PAGE_INLINE_FIGURE_CAPTION_CONTINUATION_MAX_X_DELTA_RATIO
    ) {
      continue;
    }
    if (candidate.fontSize > bodyFontSize * FIRST_PAGE_INLINE_FIGURE_CAPTION_MAX_FONT_RATIO) continue;
    if (
      Math.abs(candidate.fontSize - captionLine.fontSize) >
      FIRST_PAGE_INLINE_FIGURE_CAPTION_CONTINUATION_MAX_FONT_DELTA
    ) {
      continue;
    }
    const normalized = normalizeSpacing(candidate.text);
    if (!FIRST_PAGE_INLINE_FIGURE_CAPTION_CONTINUATION_START_PATTERN.test(normalized)) continue;
    if (!isLikelyFirstPageInlineFigureCaptionTerminatedLine(normalized)) continue;
    if (
      countSubstantiveChars(normalized) <
      FIRST_PAGE_INLINE_FIGURE_CAPTION_CONTINUATION_MIN_SUBSTANTIVE_CHARS
    ) {
      continue;
    }
    if (countWords(normalized) > FIRST_PAGE_INLINE_FIGURE_CAPTION_MAX_WORDS) continue;
    if (yDelta < nearestYDelta) {
      nearestYDelta = yDelta;
      nearestContinuation = candidate;
    }
  }
  return nearestContinuation;
}

function collectQualifiedPageCandidates(
  lines: TextLine[],
  isCandidate: (line: TextLine, pageLines: TextLine[]) => boolean,
  shouldKeep: (candidates: TextLine[], pageLines: TextLine[]) => boolean,
): Set<TextLine> {
  if (lines.length === 0) return new Set<TextLine>();
  const byPage = groupLinesByPage(lines);
  const result = new Set<TextLine>();
  for (const pageLines of byPage.values()) {
    const candidates = pageLines.filter((line) => isCandidate(line, pageLines));
    if (candidates.length === 0) continue;
    if (!shouldKeep(candidates, pageLines)) continue;
    for (const line of candidates) result.add(line);
  }
  return result;
}

function isLikelyInlineFigureLabelLine(
  line: TextLine,
  pageLines: TextLine[],
  bodyFontSize: number,
): boolean {
  if (line.pageWidth <= 0) return false;
  if (
    !matchesLineRegion(line, bodyFontSize, {
      minVerticalRatio: INLINE_FIGURE_LABEL_MIN_VERTICAL_RATIO,
      maxVerticalRatio: INLINE_FIGURE_LABEL_MAX_VERTICAL_RATIO,
      maxBodyFontRatio: INLINE_FIGURE_LABEL_MAX_FONT_RATIO,
    })
  ) {
    return false;
  }

  const normalized = normalizeSpacing(line.text);
  if (countSubstantiveChars(normalized) < INLINE_FIGURE_LABEL_MIN_SUBSTANTIVE_CHARS) return false;

  const relativeX = line.x / line.pageWidth;
  if (relativeX < INLINE_FIGURE_LABEL_MIN_RIGHT_X_RATIO) return false;

  return hasNearbyBodyLineInLeftColumn(line, pageLines, bodyFontSize);
}

function hasNearbyBodyLineInLeftColumn(
  line: TextLine,
  pageLines: TextLine[],
  bodyFontSize: number,
): boolean {
  const maxYDelta = Math.max(
    line.fontSize * INLINE_FIGURE_LABEL_NEAR_BODY_MAX_Y_DELTA_FONT_RATIO,
    INLINE_FIGURE_LABEL_NEAR_BODY_MIN_Y_DELTA,
  );
  return pageLines.some((other) => {
    if (other === line) return false;
    if (Math.abs(other.y - line.y) > maxYDelta) return false;
    if (other.pageWidth <= 0) return false;
    if (other.fontSize < bodyFontSize * INLINE_FIGURE_LABEL_NEAR_BODY_MIN_FONT_RATIO) return false;
    if (other.x / other.pageWidth > INLINE_FIGURE_LABEL_NEAR_BODY_LEFT_MAX_X_RATIO) return false;
    return countSubstantiveChars(other.text) >= INLINE_FIGURE_LABEL_NEAR_BODY_MIN_SUBSTANTIVE_CHARS;
  });
}

function findLikelyDetachedMathFragmentLines(
  lines: TextLine[],
  bodyFontSize: number,
): Set<TextLine> {
  if (lines.length < 3) return new Set<TextLine>();
  const result = new Set<TextLine>();

  for (const pageLines of groupLinesByPage(lines).values()) {
    collectDetachedMathFragmentLinesOnPage(pageLines, bodyFontSize, result);
  }

  return result;
}

interface DetachedMathFragmentClusterBounds {
  start: number;
  end: number;
}

interface DetachedMathFragmentClusterContext {
  previous: TextLine;
  next: TextLine;
}

function collectDetachedMathFragmentLinesOnPage(
  pageLines: TextLine[],
  bodyFontSize: number,
  result: Set<TextLine>,
): void {
  const sorted = sortLinesByPageTopDown(pageLines);
  let index = 1;
  while (index < sorted.length - 1) {
    const current = sorted[index];
    if (!isLikelyDetachedMathFragmentCandidate(current, bodyFontSize)) {
      index += 1;
      continue;
    }

    const cluster = findDetachedMathFragmentClusterBounds(sorted, index, bodyFontSize);
    index = cluster.end + 1;
    const context = resolveDetachedMathFragmentClusterContext(sorted, cluster, bodyFontSize);
    if (!context) continue;
    addDetachedMathFragmentClusterLines(sorted, cluster, context, result);
  }
}

function sortLinesByPageTopDown(lines: TextLine[]): TextLine[] {
  return [...lines].sort((left, right) => {
    if (left.y !== right.y) return right.y - left.y;
    return left.x - right.x;
  });
}

function findDetachedMathFragmentClusterBounds(
  lines: TextLine[],
  startIndex: number,
  bodyFontSize: number,
): DetachedMathFragmentClusterBounds {
  let start = startIndex;
  let end = startIndex;
  while (start > 0 && isLikelyDetachedMathFragmentCandidate(lines[start - 1], bodyFontSize)) {
    start -= 1;
  }
  while (
    end + 1 < lines.length &&
    isLikelyDetachedMathFragmentCandidate(lines[end + 1], bodyFontSize)
  ) {
    end += 1;
  }
  return { start, end };
}

function resolveDetachedMathFragmentClusterContext(
  lines: TextLine[],
  cluster: DetachedMathFragmentClusterBounds,
  bodyFontSize: number,
): DetachedMathFragmentClusterContext | undefined {
  const previous = lines[cluster.start - 1];
  const next = lines[cluster.end + 1];
  if (!previous || !next) return undefined;
  if (!isLikelyProseContextLine(previous, bodyFontSize)) return undefined;
  if (!isLikelyProseContextLine(next, bodyFontSize)) return undefined;
  if (!isLikelyDetachedMathFragmentContext(previous, next)) return undefined;
  return { previous, next };
}

function addDetachedMathFragmentClusterLines(
  lines: TextLine[],
  cluster: DetachedMathFragmentClusterBounds,
  context: DetachedMathFragmentClusterContext,
  result: Set<TextLine>,
): void {
  for (let candidateIndex = cluster.start; candidateIndex <= cluster.end; candidateIndex += 1) {
    const candidate = lines[candidateIndex];
    if (shouldPreserveDetachedSingleVariableToken(candidate, context.previous, context.next)) {
      continue;
    }
    result.add(candidate);
  }
}

function isLikelyDetachedMathFragmentCandidate(line: TextLine, bodyFontSize: number): boolean {
  if (line.pageWidth <= 0) return false;
  if (line.fontSize > bodyFontSize * DETACHED_MATH_FRAGMENT_MAX_FONT_RATIO) return false;
  if (line.estimatedWidth > line.pageWidth * DETACHED_MATH_FRAGMENT_MAX_WIDTH_RATIO) return false;

  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0 || normalized.length > DETACHED_MATH_FRAGMENT_MAX_TEXT_LENGTH) {
    return false;
  }
  if (INLINE_CITATION_ONLY_PATTERN.test(normalized)) return false;
  if (!DETACHED_MATH_FRAGMENT_ALLOWED_PATTERN.test(normalized)) return false;

  const alphaChars = normalized.replace(/[^A-Za-z]/g, "").length;
  if (alphaChars > DETACHED_MATH_FRAGMENT_MAX_ALPHA_CHARS) return false;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > DETACHED_MATH_FRAGMENT_MAX_TOKENS) return false;
  if (isPureNumericFragmentTokens(tokens, normalized)) return false;
  if (tokens.some((token) => /[A-Za-z]{3,}/u.test(token))) return false;
  return hasMathLikeDetachedFragmentTokens(tokens);
}

function hasMathLikeDetachedFragmentTokens(tokens: string[]): boolean {
  const hasNumericOrMathSymbol = tokens.some(
    (token) => /\d/.test(token) || /[−\-+*/=(){}\[\],.;:√∞]/u.test(token),
  );
  if (hasNumericOrMathSymbol) return true;
  return tokens.every(
    (token) =>
      /^[A-Za-z]+$/u.test(token) &&
      token.length <= DETACHED_MATH_FRAGMENT_MAX_ALPHA_TOKEN_LENGTH,
  );
}

function isPureNumericFragmentTokens(tokens: string[], normalized: string): boolean {
  if (/[−\-+*/=(){}\[\]√∞]/u.test(normalized)) return false;
  return tokens.every((token) => /^[-+]?\d+(?:[.,]\d+)?[.,;:]?$/.test(token));
}

function isLikelyProseContextLine(line: TextLine, bodyFontSize: number): boolean {
  if (line.fontSize > bodyFontSize * DETACHED_MATH_FRAGMENT_MAX_PROSE_FONT_RATIO) return false;
  const normalized = normalizeSpacing(line.text);
  if (countSubstantiveChars(normalized) < DETACHED_MATH_FRAGMENT_MIN_PROSE_CHARS) return false;
  if (countWords(normalized) < DETACHED_MATH_FRAGMENT_MIN_PROSE_WORDS) return false;
  return /\b[a-z]{3,}\b/u.test(normalized);
}

function isLikelyDetachedMathFragmentContext(previous: TextLine, next: TextLine): boolean {
  if (previous.pageIndex !== next.pageIndex) return false;
  if (previous.y <= next.y) return false;
  if (previous.y - next.y > DETACHED_MATH_FRAGMENT_MAX_CONTEXT_Y_GAP) return false;
  const maxXDelta = previous.pageWidth * DETACHED_MATH_FRAGMENT_MAX_CONTEXT_X_DELTA_RATIO;
  return Math.abs(previous.x - next.x) <= maxXDelta;
}

function shouldPreserveDetachedSingleVariableToken(
  line: TextLine,
  previous: TextLine,
  next: TextLine,
): boolean {
  const normalized = normalizeSpacing(line.text);
  if (!/^[A-Za-z]$/u.test(normalized)) return false;
  const previousText = normalizeSpacing(previous.text);
  const nextText = normalizeSpacing(next.text);
  if (!/[A-Za-z]$/.test(previousText)) return false;
  return /^\(/.test(nextText);
}

function isLikelyStandaloneSymbolArtifact(line: TextLine, bodyFontSize: number): boolean {
  if (line.pageWidth <= 0) return false;
  if (line.fontSize > bodyFontSize * STANDALONE_SYMBOL_ARTIFACT_MAX_FONT_RATIO) return false;

  const normalized = normalizeSpacing(line.text);
  if (
    normalized.length === 0 ||
    normalized.length > STANDALONE_SYMBOL_ARTIFACT_MAX_CHARS
  ) {
    return false;
  }
  if (!STANDALONE_SYMBOL_ARTIFACT_PATTERN.test(normalized)) return false;
  if (FOOTNOTE_MARKER_ONLY_SYMBOL_PATTERN.test(normalized)) return false;
  return line.estimatedWidth <= line.pageWidth * STANDALONE_SYMBOL_ARTIFACT_MAX_WIDTH_RATIO;
}

function isLikelySpecialTokenArtifactLine(line: TextLine, bodyFontSize: number): boolean {
  if (line.fontSize > bodyFontSize * SPECIAL_TOKEN_ARTIFACT_MAX_FONT_RATIO) return false;
  const normalized = normalizeSpacing(line.text);
  const matchedTokens = normalized.match(SPECIAL_TOKEN_ARTIFACT_PATTERN);
  if (!matchedTokens || matchedTokens.length === 0) return false;
  if (matchedTokens.length > 1) return true;

  const textWithoutTokens = normalizeSpacing(
    normalized.replace(SPECIAL_TOKEN_ARTIFACT_PATTERN, " "),
  );
  if (textWithoutTokens.length === 0) return true;
  const tokenlessWordCount = textWithoutTokens.split(/\s+/).filter(Boolean).length;
  return tokenlessWordCount <= SPECIAL_TOKEN_ARTIFACT_MAX_WORDS_WITH_SINGLE_TOKEN;
}

function countSubstantiveChars(text: string): number {
  return normalizeSpacing(text).replace(/[^\p{L}\p{N}]+/gu, "").length;
}

function isStandaloneCitationMarker(text: string): boolean {
  return STANDALONE_CITATION_MARKER_PATTERN.test(normalizeSpacing(text));
}

function isLikelyStandaloneDoiMetadataLine(line: TextLine): boolean {
  if (line.pageIndex > STANDALONE_DOI_METADATA_MAX_PAGE_INDEX) return false;
  const normalized = normalizeSpacing(line.text);
  return STANDALONE_DOI_METADATA_PATTERN.test(normalized);
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

function isLikelyPublisherImprintFooterLine(
  line: TextLine,
  bodyFontSize: number,
  pageExtents: Map<number, PageVerticalExtent>,
): boolean {
  if (line.fontSize > bodyFontSize * PUBLISHER_IMPRINT_FOOTER_MAX_FONT_RATIO) return false;
  if (!(isNearPageEdge(line, pageExtents) || isNearPhysicalPageEdge(line))) return false;

  const normalized = normalizeSpacing(line.text);
  if (countSubstantiveChars(normalized) < PUBLISHER_IMPRINT_FOOTER_MIN_SUBSTANTIVE_CHARS) {
    return false;
  }
  if (!FIRST_PAGE_VENUE_FOOTER_YEAR_PATTERN.test(normalized)) return false;
  if (!hasMultiplePublisherCorporateTokens(normalized)) return false;
  return hasNonYearLongNumericToken(normalized);
}

function hasMultiplePublisherCorporateTokens(text: string): boolean {
  const matches = text.match(PUBLISHER_IMPRINT_FOOTER_CORPORATE_TOKEN_PATTERN) ?? [];
  return matches.length >= PUBLISHER_IMPRINT_FOOTER_MIN_CORPORATE_TOKEN_COUNT;
}

function hasNonYearLongNumericToken(text: string): boolean {
  const matches = text.match(PUBLISHER_IMPRINT_FOOTER_LONG_NUMBER_PATTERN);
  if (!matches) return false;
  return matches.some((token) => !FIRST_PAGE_VENUE_FOOTER_YEAR_PATTERN.test(token));
}

function isLikelyFirstPageVenueFooterLine(
  line: TextLine,
  bodyFontSize: number,
): boolean {
  if (
    !matchesLineRegion(line, bodyFontSize, {
      exactPageIndex: 0,
      maxVerticalRatio: FIRST_PAGE_VENUE_FOOTER_MAX_VERTICAL_RATIO,
      maxBodyFontRatio: FIRST_PAGE_VENUE_FOOTER_MAX_FONT_RATIO,
    })
  ) {
    return false;
  }

  const normalized = normalizeSpacing(line.text);
  const substantiveCharCount = countSubstantiveChars(normalized);
  if (
    substantiveCharCount < FIRST_PAGE_VENUE_FOOTER_MIN_SUBSTANTIVE_CHARS ||
    substantiveCharCount > FIRST_PAGE_VENUE_FOOTER_MAX_SUBSTANTIVE_CHARS
  ) {
    return false;
  }
  if (!FIRST_PAGE_VENUE_FOOTER_YEAR_PATTERN.test(normalized)) return false;
  return FIRST_PAGE_VENUE_FOOTER_KEYWORD_PATTERN.test(normalized);
}

function isLikelyTopMatterAffiliationIndexLine(
  line: TextLine,
  bodyFontSize: number,
): boolean {
  if (
    !matchesLineRegion(line, bodyFontSize, {
      exactPageIndex: 0,
      minVerticalRatio: TOP_MATTER_AFFILIATION_MIN_VERTICAL_RATIO,
      maxBodyFontRatio: TOP_MATTER_AFFILIATION_MAX_FONT_RATIO,
    })
  ) {
    return false;
  }

  const normalized = normalizeSpacing(line.text);
  if (!TOP_MATTER_AFFILIATION_INDEX_PATTERN.test(normalized)) return false;

  const indexTokens = normalized.match(/\d+/g) ?? [];
  if (indexTokens.length < TOP_MATTER_AFFILIATION_MIN_INDEX_TOKENS) return false;
  if (!indexTokens.some((token) => token.length === 1)) return false;
  return indexTokens.every((token) => token.length <= 2);
}

function isLikelyTopMatterSymbolicAffiliationLine(
  line: TextLine,
  bodyFontSize: number,
): boolean {
  if (
    !matchesLineRegion(line, bodyFontSize, {
      exactPageIndex: 0,
      minVerticalRatio: TOP_MATTER_SYMBOLIC_AFFILIATION_MIN_VERTICAL_RATIO,
      maxVerticalRatio: TOP_MATTER_SYMBOLIC_AFFILIATION_MAX_VERTICAL_RATIO,
      maxBodyFontRatio: TOP_MATTER_SYMBOLIC_AFFILIATION_MAX_FONT_RATIO,
    })
  ) {
    return false;
  }

  const normalized = normalizeSpacing(line.text);
  return TOP_MATTER_SYMBOLIC_AFFILIATION_PATTERN.test(normalized);
}

function isLikelyTopMatterContactEmailLine(
  line: TextLine,
  bodyFontSize: number,
): boolean {
  if (
    !matchesLineRegion(line, bodyFontSize, {
      exactPageIndex: 0,
      minVerticalRatio: TOP_MATTER_CONTACT_EMAIL_MIN_VERTICAL_RATIO,
      maxVerticalRatio: TOP_MATTER_CONTACT_EMAIL_MAX_VERTICAL_RATIO,
      maxBodyFontRatio: TOP_MATTER_CONTACT_EMAIL_MAX_FONT_RATIO,
    })
  ) {
    return false;
  }

  const normalized = normalizeSpacing(line.text);
  if (!TOP_MATTER_CONTACT_EMAIL_PREFIX_PATTERN.test(normalized)) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > TOP_MATTER_CONTACT_EMAIL_MAX_WORDS) return false;
  return TOP_MATTER_CONTACT_EMAIL_ADDRESS_PATTERN.test(normalized);
}

function findLikelyTopMatterAlphabeticAffiliationLines(
  lines: TextLine[],
  bodyFontSize: number,
): Set<TextLine> {
  return collectQualifiedPageCandidates(
    lines,
    (line) => isLikelyTopMatterAlphabeticAffiliationCandidate(line, bodyFontSize),
    (candidates) => hasAlphabeticAffiliationCluster(candidates),
  );
}

function hasAlphabeticAffiliationCluster(candidates: TextLine[]): boolean {
  const singleLetterCandidates = candidates.filter((line) =>
    TOP_MATTER_ALPHABETIC_AFFILIATION_SINGLE_TOKEN_PATTERN.test(
      normalizeSpacing(line.text).toLowerCase(),
    ),
  );
  if (singleLetterCandidates.length < TOP_MATTER_ALPHABETIC_AFFILIATION_MIN_CLUSTER_SIZE) {
    return false;
  }
  return singleLetterCandidates.some((line) => {
    const nearbyCount = singleLetterCandidates.filter(
      (other) =>
        Math.abs(other.x - line.x) <= TOP_MATTER_ALPHABETIC_AFFILIATION_CLUSTER_X_TOLERANCE,
    ).length;
    return nearbyCount >= TOP_MATTER_ALPHABETIC_AFFILIATION_MIN_CLUSTER_SIZE;
  });
}

function isLikelyTopMatterAlphabeticAffiliationCandidate(
  line: TextLine,
  bodyFontSize: number,
): boolean {
  if (
    !matchesLineRegion(line, bodyFontSize, {
      maxPageIndex: TOP_MATTER_ALPHABETIC_AFFILIATION_MAX_PAGE_INDEX,
      minVerticalRatio: TOP_MATTER_ALPHABETIC_AFFILIATION_MIN_VERTICAL_RATIO,
      maxVerticalRatio: TOP_MATTER_ALPHABETIC_AFFILIATION_MAX_VERTICAL_RATIO,
      maxBodyFontRatio: TOP_MATTER_ALPHABETIC_AFFILIATION_MAX_FONT_RATIO,
    })
  ) {
    return false;
  }

  const tokens = normalizeSpacing(line.text).toLowerCase().split(/[\s,;:]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > TOP_MATTER_ALPHABETIC_AFFILIATION_MAX_TOKENS) {
    return false;
  }
  if (!tokens.every((token) => TOP_MATTER_ALPHABETIC_AFFILIATION_TOKEN_PATTERN.test(token))) {
    return false;
  }
  return tokens.some((token) => TOP_MATTER_ALPHABETIC_AFFILIATION_SINGLE_TOKEN_PATTERN.test(token));
}
