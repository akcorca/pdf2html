// biome-ignore lint/nursery/noExcessiveLinesPerFile: HTML rendering heuristics are intentionally grouped.
import type { TextLine } from "./pdf-types.ts";
import { estimateBodyFontSize, normalizeSpacing, splitWords } from "./text-lines.ts";
import { containsDocumentMetadata, findTitleLine } from "./title-detect.ts";
import { detectNamedSectionHeadingLevel, detectNumberedHeadingLevel } from "./heading-detect.ts";

const INLINE_ACKNOWLEDGEMENTS_HEADING_PATTERN =
  /^(acknowledg(?:e)?ments?)(?:(?:\s*[:\-–]\s*)|\s+)(.+)$/iu;
const INLINE_ACKNOWLEDGEMENTS_MIN_BODY_LENGTH = 8;
const INLINE_NAMED_SECTION_HEADING_PATTERN = /^(.+?)(?:\s*[:\-–]\s*)(.+)$/u;
const INLINE_NAMED_SECTION_HEADING_MIN_BODY_LENGTH = 8;
const BULLET_LIST_ITEM_PATTERN = /^([•◦▪●○■□◆◇‣⁃∙·])\s+(.+)$/u;
const MIN_LIST_CONTINUATION_INDENT = 6;
const TITLE_CONTINUATION_MAX_FONT_DELTA = 0.6;
const TITLE_CONTINUATION_MAX_CENTER_OFFSET_RATIO = 0.12;
const TITLE_CONTINUATION_MAX_LEFT_OFFSET_RATIO = 0.03;
const TITLE_CONTINUATION_MAX_VERTICAL_GAP_RATIO = 2.2;
const TITLE_CONTINUATION_MIN_WORD_COUNT = 3;
const MIN_NUMBERED_HEADING_FONT_RATIO = 0.85;
const MIN_NUMBERED_HEADING_CONTINUATION_FONT_RATIO = 1.05;
const MAX_NUMBERED_HEADING_CONTINUATION_WORDS = 8;
const NUMBERED_HEADING_CONTINUATION_MAX_LOOKAHEAD = 16;
const NUMBERED_HEADING_CONTINUATION_MAX_FONT_DELTA = 0.7;
const NUMBERED_HEADING_CONTINUATION_MAX_LEFT_OFFSET_RATIO = 0.05;
const NUMBERED_HEADING_CONTINUATION_MAX_CENTER_OFFSET_RATIO = 0.12;
const NUMBERED_HEADING_CONTINUATION_MAX_VERTICAL_GAP_RATIO = 2.6;
const MIN_TOP_LEVEL_DOTTED_HEADING_FONT_RATIO = 1.05;
const TOP_LEVEL_DOTTED_HEADING_PATTERN = /^\d+\.\s+/;
const DOTTED_SUBSECTION_HEADING_PATTERN = /^\d+\.\d+(?:\.\d+){0,3}\.\s+/;
const STANDALONE_URL_LINE_PATTERN = /^(https?:\/\/[^\s]+?)([.,;:!?])?$/iu;
const URL_CONTINUATION_LINE_PATTERN = /^([A-Za-z0-9._~!$&'()*+,;=:@%/-]+?)([.,;:!?])?$/u;
const FOOTNOTE_NUMERIC_MARKER_ONLY_PATTERN = /^\(?\d{1,2}\)?[.)]?$/u;
const STANDALONE_ACKNOWLEDGEMENTS_HEADING_PATTERN = /^acknowledg(?:e)?ments?$/iu;
const ACKNOWLEDGEMENTS_CONTINUATION_START_PATTERN = /^[a-z(“‘"']/u;
const ACKNOWLEDGEMENTS_MAX_FONT_DELTA = 0.8;
const ACKNOWLEDGEMENTS_MAX_LEFT_OFFSET_RATIO = 0.06;
const ACKNOWLEDGEMENTS_MAX_VERTICAL_GAP_RATIO = 2.8;
const HYPHEN_WRAPPED_LINE_PATTERN = /[A-Za-z]\s*-$/;
const HYPHEN_WRAP_CONTINUATION_START_PATTERN = /^[A-Za-z]/;
const HYPHEN_WRAP_MAX_VERTICAL_GAP_RATIO = 2.8;
const HYPHEN_WRAP_MAX_LEFT_OFFSET_RATIO = 0.08;
const HYPHEN_WRAP_MAX_CENTER_OFFSET_RATIO = 0.12;
const HYPHEN_WRAP_MIN_LINE_WIDTH_RATIO = 0.45;
const HYPHEN_WRAP_MIN_CONTINUATION_WIDTH_RATIO = 0.45;
const HYPHEN_WRAP_SOFT_CONTINUATION_FRAGMENT_PATTERN = /^(?:tion(?:al(?:ly)?|s)?|sion(?:al(?:ly)?|s)?)/u;
const HYPHEN_WRAP_SOFT_CONTINUATION_MIN_FRAGMENT_LENGTH = 3;
const SAME_ROW_SENTENCE_SPLIT_END_PATTERN = /[.!?]["')\]]?$/;
const SAME_ROW_SENTENCE_CONTINUATION_START_PATTERN = /^[A-Z0-9(“‘"']/u;
const SAME_ROW_SENTENCE_SPLIT_MAX_VERTICAL_DELTA_FONT_RATIO = 0.2;
const SAME_ROW_SENTENCE_SPLIT_MAX_FONT_DELTA = 0.7;
const SAME_ROW_SENTENCE_SPLIT_MIN_X_DELTA_RATIO = 0.01;
const SAME_ROW_SENTENCE_SPLIT_MAX_X_DELTA_RATIO = 0.14;
const SAME_ROW_SENTENCE_SPLIT_MAX_START_WIDTH_RATIO = 0.45;
const STANDALONE_CAPTION_LABEL_PATTERN =
  /^(?:Figure|Fig\.?|Table|Algorithm|Eq(?:uation)?\.?)\s+\d+[A-Za-z]?[.:]?$/iu;
const BODY_PARAGRAPH_FULL_WIDTH_RATIO = 0.85;
const BODY_PARAGRAPH_TYPICAL_WIDTH_PERCENTILE = 0.75;
const BODY_PARAGRAPH_MAX_VERTICAL_GAP_RATIO = 2.0;
const BODY_PARAGRAPH_MAX_FONT_DELTA = 0.8;
const BODY_PARAGRAPH_MAX_LEFT_OFFSET_RATIO = 0.05;
const BODY_PARAGRAPH_MAX_CENTER_OFFSET_RATIO = 0.12;
const BODY_PARAGRAPH_CONTINUATION_START_PATTERN = /^[A-Za-z0-9("'"'[]/u;
const BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN = /^\[\d+\]/;
const BODY_PARAGRAPH_CITATION_CONTINUATION_PATTERN =
  /^\[\d+(?:\s*,\s*\d+)*\]\s*[,;:]\s+[A-Za-z(“‘"']/u;
const BODY_PARAGRAPH_SHORT_LEAD_MIN_WIDTH_RATIO = 0.55;
const BODY_PARAGRAPH_SHORT_LEAD_MIN_WORD_COUNT = 4;
const BODY_PARAGRAPH_SHORT_LEAD_MIN_X_BACKSHIFT_RATIO = 0.08;
const BODY_PARAGRAPH_SHORT_LEAD_SAME_ROW_MAX_VERTICAL_DELTA_FONT_RATIO = 0.25;
const BODY_PARAGRAPH_OPERATOR_TRAILING_PATTERN = /[+\-−/=]$/u;
const BODY_PARAGRAPH_OPERATOR_SAME_ROW_MIN_X_DELTA_RATIO = 0.18;
const BODY_PARAGRAPH_OPERATOR_SAME_ROW_MAX_VERTICAL_DELTA_FONT_RATIO = 0.25;
const BODY_PARAGRAPH_OPERATOR_SAME_ROW_MAX_PREVIOUS_WIDTH_RATIO = 0.7;
const BODY_PARAGRAPH_OPERATOR_SAME_ROW_MAX_CONTINUATION_WIDTH_RATIO = 0.65;
const INLINE_MATH_BRIDGE_MAX_LOOKAHEAD = 4;
const INLINE_MATH_BRIDGE_MAX_TEXT_LENGTH = 24;
const INLINE_MATH_BRIDGE_MAX_TOKEN_COUNT = 8;
const INLINE_MATH_BRIDGE_MAX_VERTICAL_GAP_RATIO = 0.55;
const INLINE_MATH_BRIDGE_MAX_WIDTH_RATIO = 0.55;
const INLINE_MATH_BRIDGE_ALLOWED_CHARS_PATTERN = /^[A-Za-z0-9\s−\-+*/=(){}\[\],.;:√∞]+$/u;
const INLINE_MATH_BRIDGE_VARIABLE_TOKEN_PATTERN = /^[A-Za-z]$/;
const INLINE_MATH_BRIDGE_LOWERCASE_SUBSCRIPT_TOKEN_PATTERN = /^[a-z]{1,6}$/u;
const INLINE_MATH_BRIDGE_NUMERIC_TOKEN_PATTERN = /^\d{1,4}$/;
const INLINE_MATH_BRIDGE_SYMBOL_TOKEN_PATTERN = /^[−\-+*/=(){}\[\],.;:√∞]+$/u;
const INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN = /[.!?]["')\]]?$/;
const INLINE_MATH_BRIDGE_SUBSCRIPT_MAX_TOKEN_COUNT = 3;
const INLINE_MATH_BRIDGE_SUBSCRIPT_MIN_TOKEN_LENGTH = 3;
const INLINE_MATH_BRIDGE_SUBSCRIPT_MAX_FONT_RATIO = 0.88;
const DETACHED_LOWERCASE_MATH_SUBSCRIPT_PATTERN = /^[a-z]{3,6}(?:\s+[a-z]{3,6}){0,2}$/u;
const DETACHED_LOWERCASE_MATH_SUBSCRIPT_MAX_WIDTH_RATIO = 0.1;
const DETACHED_MATH_SUBSCRIPT_ASSIGNMENT_CONTEXT_PATTERN = /=\s*(?:[A-Za-z]\b|[-−]?\d)/u;
const DETACHED_MATH_SUBSCRIPT_TRAILING_VARIABLE_PATTERN = /\b[A-Za-z]\s*[.)]?$/u;
const NUMBERED_CODE_BLOCK_LINE_PATTERN = /^(\d{1,3})\s+(.+)$/;
const NUMBERED_CODE_BLOCK_MAX_LOOKAHEAD = 48;
const NUMBERED_CODE_BLOCK_MIN_LINES = 4;
const NUMBERED_CODE_BLOCK_MAX_FONT_RATIO = 0.9;
const NUMBERED_CODE_BLOCK_MAX_FONT_DELTA = 0.7;
const NUMBERED_CODE_BLOCK_MAX_LEFT_OFFSET = 60;
const NUMBERED_CODE_BLOCK_MIN_INDENT = 12;
const NUMBERED_CODE_BLOCK_MAX_NUMBER_GAP = 2;
const NUMBERED_CODE_BLOCK_MAX_VERTICAL_GAP_RATIO = 2.8;
const STRONG_CODE_START_TEXT_PATTERN =
  /[#=]|\b(?:def|class|import|from|return|const|let|var|function|try|except)\b/u;
const CODE_STYLE_TEXT_PATTERN =
  /[#=]|\b(?:def|class|return|import|from|try|except|const|let|var|function)\b|^[A-Za-z_][\w.]*\s*\([^)]*\)$/u;

interface HeadingCandidate {
  kind: "named" | "numbered";
  level: number;
}

interface NumberedHeadingSectionInfo {
  topLevelNumber: number;
  depth: number;
}

interface ResolvedHeadingCandidate {
  heading: HeadingCandidate;
  numberedHeadingSectionInfo?: NumberedHeadingSectionInfo;
}

interface NumberedCodeLine {
  lineNumber: number;
  content: string;
}

interface ConsumedTitleLineBlock {
  startIndex: number;
  text: string;
  nextIndex: number;
}

interface ConsumedParagraph {
  text: string;
  nextIndex: number;
}

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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ordered rendering heuristics are evaluated in one pass.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: ordered rendering heuristics are evaluated in one pass.
function renderBodyLines(lines: TextLine[], titleLine: TextLine | undefined): string[] {
  const bodyLines: string[] = [];
  const bodyFontSize = estimateBodyFontSize(lines);
  const pageTypicalWidths = computePageTypicalBodyWidths(lines, bodyFontSize);
  const hasDottedSubsectionHeadings = lines.some((line) =>
    DOTTED_SUBSECTION_HEADING_PATTERN.test(normalizeSpacing(line.text)),
  );
  const seenTopLevelNumberedSections = new Set<number>();
  const consumedTitle: ConsumedTitleLineBlock | undefined = titleLine
    ? consumeTitleLines(lines, titleLine)
    : undefined;
  const consumedBodyLineIndexes = new Set<number>();
  let index = consumedTitle?.startIndex ?? 0;
  while (index < lines.length) {
    if (consumedTitle && index === consumedTitle.startIndex) {
      bodyLines.push(`<h1>${escapeHtml(consumedTitle.text)}</h1>`);
      index = consumedTitle.nextIndex;
      continue;
    }
    if (shouldSkipConsumedBodyLineIndex(index, consumedTitle, consumedBodyLineIndexes)) {
      index += 1;
      continue;
    }
    if (
      shouldSkipDetachedLowercaseMathSubscriptLine(
        lines,
        index,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      )
    ) {
      index += 1;
      continue;
    }

    const currentLine = lines[index];
    const resolvedHeading = resolveHeadingCandidateForRendering(
      currentLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
      seenTopLevelNumberedSections,
    );
    if (resolvedHeading !== undefined) {
      const { heading, numberedHeadingSectionInfo } = resolvedHeading;
      let headingText = currentLine.text;
      if (heading.kind === "numbered") {
        const wrapped = consumeWrappedNumberedHeadingContinuation(
          lines,
          index,
          currentLine,
          bodyFontSize,
        );
        addConsumedIndexes(consumedBodyLineIndexes, wrapped.continuationIndexes, index);
        if (wrapped.continuationIndexes.length > 0) {
          headingText = wrapped.text;
        }
      }
      bodyLines.push(`<h${heading.level}>${escapeHtml(headingText)}</h${heading.level}>`);
      if (
        heading.kind === "numbered" &&
        numberedHeadingSectionInfo !== undefined &&
        numberedHeadingSectionInfo.depth === 1
      ) {
        seenTopLevelNumberedSections.add(numberedHeadingSectionInfo.topLevelNumber);
      }
      if (isStandaloneAcknowledgementsHeading(headingText)) {
        const acknowledgementsParagraph = consumeAcknowledgementsParagraphAfterHeading(
          lines,
          index + 1,
          currentLine,
        );
        if (acknowledgementsParagraph !== undefined) {
          bodyLines.push(`<p>${escapeHtml(acknowledgementsParagraph.text)}</p>`);
          index = acknowledgementsParagraph.nextIndex;
          continue;
        }
      }
      index += 1;
      continue;
    }

    const inlineHeading = parseInlineHeadingParagraph(currentLine.text);
    if (inlineHeading !== undefined) {
      bodyLines.push(`<h${inlineHeading.level}>${escapeHtml(inlineHeading.heading)}</h${inlineHeading.level}>`);
      bodyLines.push(`<p>${escapeHtml(inlineHeading.body)}</p>`);
      index += 1;
      continue;
    }

    const renderedList = renderBulletList(lines, index, titleLine);
    if (renderedList !== undefined) {
      bodyLines.push(...renderedList.htmlLines);
      index = renderedList.nextIndex;
      continue;
    }

    const renderedStandaloneLink = renderStandaloneLinkParagraph(lines, index);
    if (renderedStandaloneLink !== undefined) {
      bodyLines.push(renderedStandaloneLink.html);
      index = renderedStandaloneLink.nextIndex;
      continue;
    }

    const renderedNumberedCodeBlock = renderNumberedCodeBlock(
      lines,
      index,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    );
    if (renderedNumberedCodeBlock !== undefined) {
      bodyLines.push(renderedNumberedCodeBlock.html);
      addConsumedIndexes(consumedBodyLineIndexes, renderedNumberedCodeBlock.consumedIndexes, index);
      index += 1;
      continue;
    }

    const bodyParagraph = consumeParagraph(
      lines,
      index,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
      pageTypicalWidths,
    );
    if (bodyParagraph !== undefined) {
      bodyLines.push(`<p>${escapeHtml(bodyParagraph.text)}</p>`);
      index = bodyParagraph.nextIndex;
      continue;
    }

    bodyLines.push(`<p>${escapeHtml(currentLine.text)}</p>`);
    index += 1;
  }
  return bodyLines;
}

function shouldSkipConsumedBodyLineIndex(
  index: number,
  consumedTitle: Pick<ConsumedTitleLineBlock, "startIndex" | "nextIndex"> | undefined,
  consumedBodyLineIndexes: Set<number>,
): boolean {
  return (
    (consumedTitle && index > consumedTitle.startIndex && index < consumedTitle.nextIndex) ||
    consumedBodyLineIndexes.has(index)
  );
}

function addConsumedIndexes(
  consumedIndexes: Set<number>,
  indexesToConsume: number[],
  currentIndex: number,
): void {
  for (const consumedIndex of indexesToConsume) {
    if (consumedIndex !== currentIndex) consumedIndexes.add(consumedIndex);
  }
}

function consumeParagraph(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  pageTypicalWidths: Map<number, number>,
): ConsumedParagraph | undefined {
  return (
    consumeBodyParagraph(
      lines,
      startIndex,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
      pageTypicalWidths,
    ) ??
    consumeHyphenWrappedParagraph(
      lines,
      startIndex,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    ) ??
    consumeSameRowSentenceSplitParagraph(
      lines,
      startIndex,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    )
  );
}

function parseNumberedHeadingSectionInfo(text: string): NumberedHeadingSectionInfo | undefined {
  const normalized = normalizeSpacing(text);
  const match = /^(\d+(?:\.\d+){0,4})\.?\s+/.exec(normalized);
  if (!match) return undefined;

  const sectionParts = match[1].split(".");
  const topLevelNumber = Number.parseInt(sectionParts[0] ?? "", 10);
  if (!Number.isFinite(topLevelNumber)) return undefined;
  return { topLevelNumber, depth: sectionParts.length };
}

function resolveHeadingCandidateForRendering(
  line: TextLine,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  seenTopLevelNumberedSections: Set<number>,
): ResolvedHeadingCandidate | undefined {
  const heading = detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings);
  if (heading === undefined) return undefined;
  if (heading.kind !== "numbered") return { heading };

  const numberedHeadingSectionInfo = parseNumberedHeadingSectionInfo(line.text);
  if (
    numberedHeadingSectionInfo !== undefined &&
    numberedHeadingSectionInfo.depth > 1 &&
    !seenTopLevelNumberedSections.has(numberedHeadingSectionInfo.topLevelNumber)
  ) {
    return undefined;
  }
  return { heading, numberedHeadingSectionInfo };
}

function detectHeadingCandidate(
  line: TextLine,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): HeadingCandidate | undefined {
  const normalized = normalizeSpacing(line.text);
  if (
    TOP_LEVEL_DOTTED_HEADING_PATTERN.test(normalized) &&
    !hasDottedSubsectionHeadings &&
    line.fontSize < bodyFontSize * MIN_TOP_LEVEL_DOTTED_HEADING_FONT_RATIO
  ) {
    return undefined;
  }

  const numberedHeadingLevel = detectNumberedHeadingLevel(normalized);
  if (numberedHeadingLevel !== undefined) {
    if (line.fontSize < bodyFontSize * MIN_NUMBERED_HEADING_FONT_RATIO) return undefined;
    return { kind: "numbered", level: numberedHeadingLevel };
  }

  const namedHeadingLevel = detectNamedSectionHeadingLevel(normalized);
  if (namedHeadingLevel === undefined) return undefined;
  return { kind: "named", level: namedHeadingLevel };
}

function isSemanticHeadingText(text: string): boolean {
  return (
    detectNumberedHeadingLevel(text) !== undefined || detectNamedSectionHeadingLevel(text) !== undefined
  );
}

function isMetadataOrSemanticHeadingText(text: string): boolean {
  return containsDocumentMetadata(text) || isSemanticHeadingText(text);
}

function consumeWrappedNumberedHeadingContinuation(
  lines: TextLine[],
  headingStartIndex: number,
  headingLine: TextLine,
  bodyFontSize: number,
): { text: string; continuationIndexes: number[] } {
  const parts = [headingLine.text];
  const continuationIndexes: number[] = [];
  let previousPartLine = headingLine;
  let scanIndex = headingStartIndex + 1;
  while (
    scanIndex < lines.length &&
    scanIndex <= headingStartIndex + NUMBERED_HEADING_CONTINUATION_MAX_LOOKAHEAD
  ) {
    const candidate = lines[scanIndex];
    if (candidate.pageIndex !== headingLine.pageIndex) break;
    if (candidate.y >= previousPartLine.y) {
      scanIndex += 1;
      continue;
    }
    if (!isAlignedWithNumberedHeadingColumn(candidate, headingLine)) {
      scanIndex += 1;
      continue;
    }
    if (isNumberedHeadingContinuationLine(candidate, previousPartLine, headingLine, bodyFontSize)) {
      continuationIndexes.push(scanIndex);
      parts.push(candidate.text);
      previousPartLine = candidate;
      scanIndex += 1;
      continue;
    }
    break;
  }
  return { text: normalizeSpacing(parts.join(" ")), continuationIndexes };
}

function isNumberedHeadingContinuationLine(
  line: TextLine,
  previousPartLine: TextLine,
  headingLine: TextLine,
  bodyFontSize: number,
): boolean {
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return false;
  if (isMetadataOrSemanticHeadingText(normalized)) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;
  if (/[.!?]$/.test(normalized)) return false;
  if (normalized.split(/\s+/).length > MAX_NUMBERED_HEADING_CONTINUATION_WORDS) return false;
  if (line.fontSize < bodyFontSize * MIN_NUMBERED_HEADING_CONTINUATION_FONT_RATIO) return false;
  if (Math.abs(line.fontSize - headingLine.fontSize) > NUMBERED_HEADING_CONTINUATION_MAX_FONT_DELTA) {
    return false;
  }
  const maxVerticalGap = getFontScaledVerticalGapLimit(
    headingLine.fontSize,
    NUMBERED_HEADING_CONTINUATION_MAX_VERTICAL_GAP_RATIO,
  );
  return hasDescendingVerticalGapWithinLimit(previousPartLine, line, maxVerticalGap);
}

function isAlignedWithNumberedHeadingColumn(line: TextLine, headingLine: TextLine): boolean {
  const centerOffset = Math.abs(getLineCenter(line) - getLineCenter(headingLine));
  const leftOffset = Math.abs(line.x - headingLine.x);
  return (
    centerOffset <= headingLine.pageWidth * NUMBERED_HEADING_CONTINUATION_MAX_CENTER_OFFSET_RATIO ||
    leftOffset <= headingLine.pageWidth * NUMBERED_HEADING_CONTINUATION_MAX_LEFT_OFFSET_RATIO
  );
}

function consumeTitleLines(
  lines: TextLine[],
  titleLine: TextLine,
): ConsumedTitleLineBlock {
  const titleIndex = lines.indexOf(titleLine);
  if (titleIndex < 0) {
    return { startIndex: 0, text: titleLine.text, nextIndex: 1 };
  }

  const parts = [titleLine.text];
  let startIndex = titleIndex;
  let previousUpperLine = titleLine;
  while (
    startIndex > 0 &&
    isTitleContinuationLine(lines[startIndex - 1], previousUpperLine, titleLine, "before")
  ) {
    startIndex -= 1;
    parts.unshift(lines[startIndex].text);
    previousUpperLine = lines[startIndex];
  }

  let nextIndex = titleIndex + 1;
  let previousLowerLine = titleLine;
  while (
    nextIndex < lines.length &&
    isTitleContinuationLine(lines[nextIndex], previousLowerLine, titleLine, "after")
  ) {
    parts.push(lines[nextIndex].text);
    previousLowerLine = lines[nextIndex];
    nextIndex += 1;
  }

  return { startIndex, text: normalizeSpacing(parts.join(" ")), nextIndex };
}

function isTitleContinuationLine(
  line: TextLine,
  previousTitleLine: TextLine,
  titleLine: TextLine,
  direction: "before" | "after",
): boolean {
  if (line.pageIndex !== titleLine.pageIndex) return false;
  const text = normalizeSpacing(line.text);
  if (!isEligibleTitleContinuationText(text)) return false;
  const yDelta = getTitleContinuationVerticalDelta(line, previousTitleLine, text, direction);
  if (yDelta === undefined) return false;
  if (!isWithinTitleContinuationSpacing(line, titleLine, yDelta)) return false;
  return isTitleContinuationAligned(line, titleLine);
}

function isEligibleTitleContinuationText(text: string): boolean {
  if (text.length === 0) return false;
  if (isMetadataOrSemanticHeadingText(text)) return false;
  const words = splitWords(text);
  const hasEnoughWords =
    words.length >= TITLE_CONTINUATION_MIN_WORD_COUNT || isLikelyShortTitleContinuation(words);
  if (!hasEnoughWords) return false;
  return true;
}

function getTitleContinuationVerticalDelta(
  line: TextLine,
  previousTitleLine: TextLine,
  text: string,
  direction: "before" | "after",
): number | undefined {
  if (direction === "after" && /[.!?:]$/.test(previousTitleLine.text.trim())) return undefined;
  if (direction === "before" && /[.!?]$/.test(text)) return undefined;
  const yDelta = line.y - previousTitleLine.y;
  if (direction === "after" && yDelta >= 0) return undefined;
  if (direction === "before" && yDelta <= 0) return undefined;
  return yDelta;
}

function isWithinTitleContinuationSpacing(
  line: TextLine,
  titleLine: TextLine,
  yDelta: number,
): boolean {
  const maxGap = getFontScaledVerticalGapLimit(
    titleLine.fontSize,
    TITLE_CONTINUATION_MAX_VERTICAL_GAP_RATIO,
  );
  if (Math.abs(yDelta) > maxGap) return false;
  return Math.abs(line.fontSize - titleLine.fontSize) <= TITLE_CONTINUATION_MAX_FONT_DELTA;
}

function isTitleContinuationAligned(line: TextLine, titleLine: TextLine): boolean {
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
  if (words.length < 1 || words.length > 2) return false;
  return (
    words.every((word) => /^[A-Za-z][A-Za-z0-9'-]*$/.test(word)) &&
    words.some((word) => word.replace(/[^A-Za-z]/g, "").length >= 4)
  );
}

function getFontScaledVerticalGapLimit(fontSize: number, ratio: number): number {
  return Math.max(fontSize * ratio, fontSize + 10);
}

function hasDescendingVerticalGapWithinLimit(
  previousLine: TextLine,
  line: TextLine,
  maxVerticalGap: number,
): boolean {
  const verticalGap = previousLine.y - line.y;
  return verticalGap > 0 && verticalGap <= maxVerticalGap;
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

function parseInlineAcknowledgementsHeading(
  text: string,
): { heading: string; body: string; level: number } | undefined {
  const normalized = normalizeSpacing(text);
  const match = INLINE_ACKNOWLEDGEMENTS_HEADING_PATTERN.exec(normalized);
  if (!match) return undefined;

  const headingText = normalizeSpacing(match[1]);
  const bodyText = match[2].trim();
  if (!hasInlineHeadingBodyText(bodyText, INLINE_ACKNOWLEDGEMENTS_MIN_BODY_LENGTH)) return undefined;
  return { heading: headingText, body: bodyText, level: 2 };
}

function parseInlineNamedSectionHeading(
  text: string,
): { heading: string; body: string; level: number } | undefined {
  const normalized = normalizeSpacing(text);
  const match = INLINE_NAMED_SECTION_HEADING_PATTERN.exec(normalized);
  if (!match) return undefined;

  const headingText = normalizeSpacing(match[1]);
  if (headingText.length === 0 || isStandaloneAcknowledgementsHeading(headingText)) {
    return undefined;
  }
  const headingLevel = detectNamedSectionHeadingLevel(headingText);
  if (headingLevel === undefined) return undefined;

  const bodyText = match[2].trim();
  if (!hasInlineHeadingBodyText(bodyText, INLINE_NAMED_SECTION_HEADING_MIN_BODY_LENGTH)) {
    return undefined;
  }
  return { heading: headingText, body: bodyText, level: headingLevel };
}

function parseInlineHeadingParagraph(
  text: string,
): { heading: string; body: string; level: number } | undefined {
  return parseInlineAcknowledgementsHeading(text) ?? parseInlineNamedSectionHeading(text);
}

function hasInlineHeadingBodyText(text: string, minLength: number): boolean {
  return text.length >= minLength && /[A-Za-z]/.test(text);
}

function isStandaloneAcknowledgementsHeading(text: string): boolean {
  return STANDALONE_ACKNOWLEDGEMENTS_HEADING_PATTERN.test(normalizeSpacing(text));
}

function consumeAcknowledgementsParagraphAfterHeading(
  lines: TextLine[],
  startIndex: number,
  headingLine: TextLine,
): { text: string; nextIndex: number } | undefined {
  const firstLine = lines[startIndex];
  if (!firstLine) return undefined;
  if (!isAcknowledgementsBodyLine(firstLine, headingLine)) return undefined;

  const bodyParts = [firstLine.text];
  let previousLine = firstLine;
  let previousText = normalizeSpacing(firstLine.text);
  let nextIndex = startIndex + 1;

  while (nextIndex < lines.length) {
    const candidate = lines[nextIndex];
    if (
      !isAcknowledgementsBodyContinuationLine(candidate, previousLine, previousText, headingLine)
    ) {
      break;
    }
    bodyParts.push(candidate.text);
    previousLine = candidate;
    previousText = normalizeSpacing(candidate.text);
    nextIndex += 1;
  }

  return { text: normalizeSpacing(bodyParts.join(" ")), nextIndex };
}

function consumeHyphenWrappedParagraph(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): { text: string; nextIndex: number } | undefined {
  const startLine = lines[startIndex];
  let mergedText = normalizeSpacing(startLine.text);
  if (!isHyphenWrappedLineText(mergedText)) return undefined;

  let previousLine = startLine;
  let nextIndex = startIndex + 1;
  let mergedLineCount = 0;

  while (nextIndex < lines.length && isHyphenWrappedLineText(mergedText)) {
    const candidate = lines[nextIndex];
    if (
      !isHyphenWrapContinuationLine(
        candidate,
        previousLine,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      )
    ) {
      break;
    }
    mergedText = mergeHyphenWrappedTexts(mergedText, candidate.text);
    previousLine = candidate;
    nextIndex += 1;
    mergedLineCount += 1;
  }

  if (mergedLineCount === 0) return undefined;
  return { text: mergedText, nextIndex };
}

function isHyphenWrappedLineText(text: string): boolean {
  return HYPHEN_WRAPPED_LINE_PATTERN.test(text.trimEnd());
}

function isHyphenWrapContinuationLine(
  line: TextLine,
  previousLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  const normalized = parseParagraphMergeCandidateText(line, {
    samePageAs: previousLine,
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
    startPattern: HYPHEN_WRAP_CONTINUATION_START_PATTERN,
  });
  if (normalized === undefined) return false;

  const maxVerticalGap = getFontScaledVerticalGapLimit(
    previousLine.fontSize,
    HYPHEN_WRAP_MAX_VERTICAL_GAP_RATIO,
  );
  if (!hasDescendingVerticalGapWithinLimit(previousLine, line, maxVerticalGap)) return false;
  if (previousLine.estimatedWidth < previousLine.pageWidth * HYPHEN_WRAP_MIN_LINE_WIDTH_RATIO) {
    return false;
  }
  if (line.estimatedWidth < line.pageWidth * HYPHEN_WRAP_MIN_CONTINUATION_WIDTH_RATIO) {
    return false;
  }

  const centerOffset = Math.abs(getLineCenter(line) - getLineCenter(previousLine));
  const leftOffset = Math.abs(line.x - previousLine.x);
  return (
    centerOffset <= line.pageWidth * HYPHEN_WRAP_MAX_CENTER_OFFSET_RATIO ||
    leftOffset <= line.pageWidth * HYPHEN_WRAP_MAX_LEFT_OFFSET_RATIO
  );
}

function mergeHyphenWrappedTexts(currentText: string, nextLineText: string): string {
  const trimmedLeft = currentText.trimEnd();
  const right = nextLineText.trimStart().replace(/^\s*-\s*/, "");
  if (shouldDropHyphenForSoftWrap(trimmedLeft, right)) {
    const joinedWithoutHyphen = trimmedLeft.replace(/\s*-\s*$/, "");
    return normalizeSpacing(`${joinedWithoutHyphen}${right}`);
  }
  const joinedWithHyphen = trimmedLeft.replace(/\s*-\s*$/, "-");
  return normalizeSpacing(`${joinedWithHyphen}${right}`);
}

function shouldDropHyphenForSoftWrap(leftText: string, rightText: string): boolean {
  const leftFragmentMatch = /([A-Za-z]+)\s*-\s*$/.exec(leftText);
  const rightFragmentMatch = /^([A-Za-z]+)/.exec(rightText);
  if (!leftFragmentMatch || !rightFragmentMatch) return false;

  const leftFragment = leftFragmentMatch[1] ?? "";
  const rightFragment = rightFragmentMatch[1] ?? "";
  if (
    leftFragment.length < HYPHEN_WRAP_SOFT_CONTINUATION_MIN_FRAGMENT_LENGTH ||
    rightFragment.length < HYPHEN_WRAP_SOFT_CONTINUATION_MIN_FRAGMENT_LENGTH
  ) {
    return false;
  }
  if (leftFragment !== leftFragment.toLowerCase()) return false;
  if (rightFragment !== rightFragment.toLowerCase()) return false;
  return HYPHEN_WRAP_SOFT_CONTINUATION_FRAGMENT_PATTERN.test(rightFragment);
}

function consumeSameRowSentenceSplitParagraph(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): { text: string; nextIndex: number } | undefined {
  const startLine = lines[startIndex];
  if (
    !isSameRowSentenceSplitStartLine(
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    )
  ) {
    return undefined;
  }

  const mergedParts = [normalizeSpacing(startLine.text)];
  let nextIndex = startIndex + 1;
  let previousLine = startLine;

  while (nextIndex < lines.length) {
    const candidate = lines[nextIndex];
    if (
      !isSameRowSentenceSplitContinuationLine(
        candidate,
        startLine,
        previousLine,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      )
    ) {
      break;
    }
    mergedParts.push(normalizeSpacing(candidate.text));
    previousLine = candidate;
    nextIndex += 1;
  }

  if (mergedParts.length <= 1) return undefined;
  return { text: normalizeSpacing(mergedParts.join(" ")), nextIndex };
}

function isSameRowSentenceSplitStartLine(
  line: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  const normalized = parseParagraphMergeCandidateText(line, {
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
  });
  if (normalized === undefined) return false;
  if (!SAME_ROW_SENTENCE_SPLIT_END_PATTERN.test(normalized)) return false;
  if (STANDALONE_CAPTION_LABEL_PATTERN.test(normalized)) return false;
  if (line.estimatedWidth > line.pageWidth * SAME_ROW_SENTENCE_SPLIT_MAX_START_WIDTH_RATIO) {
    return false;
  }
  return true;
}

function isSameRowSentenceSplitContinuationLine(
  line: TextLine,
  startLine: TextLine,
  previousLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  const normalized = parseParagraphMergeCandidateText(line, {
    samePageAs: previousLine,
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
    startPattern: SAME_ROW_SENTENCE_CONTINUATION_START_PATTERN,
  });
  if (normalized === undefined) return false;

  const maxYDelta =
    Math.max(startLine.fontSize, line.fontSize) * SAME_ROW_SENTENCE_SPLIT_MAX_VERTICAL_DELTA_FONT_RATIO;
  if (Math.abs(previousLine.y - line.y) > maxYDelta) return false;
  if (Math.abs(line.fontSize - startLine.fontSize) > SAME_ROW_SENTENCE_SPLIT_MAX_FONT_DELTA) {
    return false;
  }

  const minXDelta = line.pageWidth * SAME_ROW_SENTENCE_SPLIT_MIN_X_DELTA_RATIO;
  const maxXDelta = line.pageWidth * SAME_ROW_SENTENCE_SPLIT_MAX_X_DELTA_RATIO;
  const xDeltaFromStart = line.x - startLine.x;
  if (xDeltaFromStart < minXDelta || xDeltaFromStart > maxXDelta) return false;
  if (line.x < previousLine.x - minXDelta) return false;
  return true;
}

interface ParagraphMergeCandidateOptions {
  samePageAs?: TextLine;
  titleLine: TextLine | undefined;
  bodyFontSize: number;
  hasDottedSubsectionHeadings: boolean;
  startPattern?: RegExp;
}

function parseParagraphMergeCandidateText(
  line: TextLine,
  options: ParagraphMergeCandidateOptions,
): string | undefined {
  if (options.samePageAs && line.pageIndex !== options.samePageAs.pageIndex) return undefined;
  const { titleLine, bodyFontSize, hasDottedSubsectionHeadings, startPattern } = options;
  if (line === titleLine) return undefined;
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return undefined;
  if (startPattern !== undefined && !startPattern.test(normalized)) return undefined;
  if (containsDocumentMetadata(normalized)) return undefined;
  if (parseBulletListItemText(normalized) !== undefined) return undefined;
  if (parseInlineAcknowledgementsHeading(normalized) !== undefined) return undefined;
  if (parseInlineNamedSectionHeading(normalized) !== undefined) return undefined;
  if (parseStandaloneUrlLine(normalized) !== undefined) return undefined;
  if (detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !== undefined) {
    return undefined;
  }
  return normalized;
}

function parseAcknowledgementsBodyText(
  line: TextLine,
  headingLine: TextLine,
): string | undefined {
  if (line.pageIndex !== headingLine.pageIndex) return undefined;
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return undefined;
  if (!/[A-Za-z]/.test(normalized)) return undefined;
  if (isMetadataOrSemanticHeadingText(normalized)) return undefined;
  if (parseBulletListItemText(normalized) !== undefined) return undefined;
  if (parseStandaloneUrlLine(normalized) !== undefined) return undefined;
  if (!isWithinAcknowledgementsBodyGeometry(line, headingLine)) return undefined;
  return normalized;
}

function isWithinAcknowledgementsBodyGeometry(line: TextLine, headingLine: TextLine): boolean {
  if (Math.abs(line.fontSize - headingLine.fontSize) > ACKNOWLEDGEMENTS_MAX_FONT_DELTA) {
    return false;
  }
  const verticalGap = headingLine.y - line.y;
  const maxVerticalGap = getFontScaledVerticalGapLimit(
    headingLine.fontSize,
    ACKNOWLEDGEMENTS_MAX_VERTICAL_GAP_RATIO,
  );
  if (verticalGap < 0 || verticalGap > maxVerticalGap) return false;
  return line.x >= headingLine.x - line.pageWidth * ACKNOWLEDGEMENTS_MAX_LEFT_OFFSET_RATIO;
}

function isAcknowledgementsBodyLine(line: TextLine, headingLine: TextLine): boolean {
  return parseAcknowledgementsBodyText(line, headingLine) !== undefined;
}

function isAcknowledgementsBodyContinuationLine(
  line: TextLine,
  previousLine: TextLine,
  previousText: string,
  headingLine: TextLine,
): boolean {
  if (line.pageIndex !== previousLine.pageIndex) return false;
  if (/[.!?]$/.test(previousText)) return false;
  const normalized = parseAcknowledgementsBodyText(line, headingLine);
  if (normalized === undefined) return false;
  if (!ACKNOWLEDGEMENTS_CONTINUATION_START_PATTERN.test(normalized)) return false;
  if (Math.abs(line.fontSize - previousLine.fontSize) > ACKNOWLEDGEMENTS_MAX_FONT_DELTA) {
    return false;
  }
  const maxVerticalGap = getFontScaledVerticalGapLimit(
    previousLine.fontSize,
    ACKNOWLEDGEMENTS_MAX_VERTICAL_GAP_RATIO,
  );
  if (!hasDescendingVerticalGapWithinLimit(previousLine, line, maxVerticalGap)) return false;

  const maxLeftOffset = line.pageWidth * ACKNOWLEDGEMENTS_MAX_LEFT_OFFSET_RATIO;
  return (
    Math.abs(line.x - headingLine.x) <= maxLeftOffset ||
    Math.abs(line.x - previousLine.x) <= maxLeftOffset
  );
}

function renderStandaloneLinkParagraph(
  lines: TextLine[],
  startIndex: number,
): { html: string; nextIndex: number } | undefined {
  const footnoteMarker = parseStandaloneNumericFootnoteMarker(lines[startIndex].text);
  if (footnoteMarker !== undefined) {
    const linkedFootnote = consumeStandaloneUrl(lines, startIndex + 1, lines[startIndex]);
    if (linkedFootnote !== undefined) {
      const escaped = escapeHtml(linkedFootnote.url);
      return {
        html: `<p>${escapeHtml(footnoteMarker)} <a href="${escaped}">${escaped}</a>${escapeHtml(linkedFootnote.trailingPunctuation)}</p>`,
        nextIndex: linkedFootnote.nextIndex,
      };
    }
  }

  const standaloneLink = consumeStandaloneUrl(lines, startIndex);
  if (standaloneLink === undefined) return undefined;

  const escaped = escapeHtml(standaloneLink.url);
  return {
    html: `<p><a href="${escaped}">${escaped}</a>${escapeHtml(standaloneLink.trailingPunctuation)}</p>`,
    nextIndex: standaloneLink.nextIndex,
  };
}

function consumeStandaloneUrl(
  lines: TextLine[],
  startIndex: number,
  expectedPageLine?: TextLine,
): { url: string; trailingPunctuation: string; nextIndex: number } | undefined {
  const urlLine = lines[startIndex];
  if (!urlLine || !isSamePage(urlLine, expectedPageLine)) return undefined;
  const baseUrl = parseStandaloneUrlLine(urlLine.text);
  if (baseUrl === undefined) return undefined;

  const merged = parseStandaloneUrlContinuationCandidate(
    lines[startIndex + 1],
    baseUrl.url,
    urlLine,
    expectedPageLine,
  );
  if (merged === undefined) {
    return {
      url: baseUrl.url,
      trailingPunctuation: baseUrl.trailingPunctuation,
      nextIndex: startIndex + 1,
    };
  }
  return { ...merged, nextIndex: startIndex + 2 };
}

function isSamePage(line: TextLine, referenceLine: TextLine | undefined): boolean {
  return referenceLine === undefined || line.pageIndex === referenceLine.pageIndex;
}

function parseStandaloneUrlContinuationCandidate(
  line: TextLine | undefined,
  baseUrl: string,
  urlLine: TextLine,
  expectedPageLine: TextLine | undefined,
): { url: string; trailingPunctuation: string } | undefined {
  if (!baseUrl.endsWith("/") || line === undefined) return undefined;
  if (!isSamePage(line, expectedPageLine)) return undefined;
  if (!isSamePage(line, urlLine)) return undefined;

  const continuation = parseUrlContinuationLine(line.text);
  if (continuation === undefined) return undefined;

  const merged = `${baseUrl}${continuation.path}`;
  if (!isValidHttpUrl(merged)) return undefined;
  return { url: merged, trailingPunctuation: continuation.trailingPunctuation };
}

function parseStandaloneNumericFootnoteMarker(text: string): string | undefined {
  const normalized = normalizeSpacing(text);
  if (!FOOTNOTE_NUMERIC_MARKER_ONLY_PATTERN.test(normalized)) return undefined;
  return normalized;
}

function parseStandaloneUrlLine(
  text: string,
): { url: string; trailingPunctuation: string } | undefined {
  const normalized = normalizeTrailingPunctuationSpacing(normalizeSpacing(text));
  const match = STANDALONE_URL_LINE_PATTERN.exec(normalized);
  if (!match) return undefined;
  const candidate = match[1];
  if (!isValidHttpUrl(candidate)) return undefined;
  return { url: candidate, trailingPunctuation: match[2] ?? "" };
}

function parseUrlContinuationLine(
  text: string,
): { path: string; trailingPunctuation: string } | undefined {
  const normalized = normalizeTrailingPunctuationSpacing(normalizeSpacing(text));
  const match = URL_CONTINUATION_LINE_PATTERN.exec(normalized);
  if (!match) return undefined;
  if (!match[1].includes("/")) return undefined;

  const path = match[1].replace(/^\/+/, "");
  if (path.length === 0) return undefined;
  return { path, trailingPunctuation: match[2] ?? "" };
}

function normalizeTrailingPunctuationSpacing(text: string): string {
  return text.replace(/\s+([.,;:!?])/g, "$1");
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: code-block extraction requires ordered heuristic checks.
function renderNumberedCodeBlock(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): { html: string; consumedIndexes: number[] } | undefined {
  const startLine = lines[startIndex];
  const parsedStart = parseNumberedCodeLine(normalizeSpacing(startLine.text));
  if (parsedStart === undefined) return undefined;
  if (
    !isNumberedCodeStartLine(
      startLine,
      parsedStart,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    )
  ) {
    return undefined;
  }

  const codeParts = [normalizeSpacing(startLine.text)];
  const consumedIndexes = [startIndex];
  let previousCodeLine = startLine;
  let expectedNumber = parsedStart.lineNumber + 1;

  const maxScanIndex = Math.min(lines.length, startIndex + NUMBERED_CODE_BLOCK_MAX_LOOKAHEAD + 1);
  for (let scanIndex = startIndex + 1; scanIndex < maxScanIndex; scanIndex += 1) {
    const candidate = lines[scanIndex];
    if (candidate.pageIndex !== startLine.pageIndex) break;
    if (
      !isNumberedCodeContinuationCandidateLine(
        candidate,
        startLine,
        previousCodeLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      )
    ) {
      continue;
    }

    const normalized = normalizeSpacing(candidate.text);
    const parsedCandidate = parseNumberedCodeLine(normalized);
    if (parsedCandidate !== undefined) {
      if (!isLikelyCodeText(parsedCandidate.content)) continue;
      if (parsedCandidate.lineNumber < expectedNumber) continue;
      if (parsedCandidate.lineNumber > expectedNumber + NUMBERED_CODE_BLOCK_MAX_NUMBER_GAP) {
        if (codeParts.length >= NUMBERED_CODE_BLOCK_MIN_LINES) break;
        continue;
      }
      expectedNumber = parsedCandidate.lineNumber + 1;
    } else {
      if (candidate.x < startLine.x + NUMBERED_CODE_BLOCK_MIN_INDENT) continue;
      if (!isLikelyCodeContinuationText(normalized)) continue;
    }

    codeParts.push(normalized);
    consumedIndexes.push(scanIndex);
    previousCodeLine = candidate;
  }

  if (codeParts.length < NUMBERED_CODE_BLOCK_MIN_LINES) return undefined;
  return {
    html: `<pre><code>${escapeHtml(codeParts.join("\n"))}</code></pre>`,
    consumedIndexes,
  };
}

function parseNumberedCodeLine(text: string): NumberedCodeLine | undefined {
  const match = NUMBERED_CODE_BLOCK_LINE_PATTERN.exec(text);
  if (!match) return undefined;
  const lineNumber = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(lineNumber)) return undefined;
  const content = (match[2] ?? "").trim();
  if (content.length === 0) return undefined;
  return { lineNumber, content };
}

function isNumberedCodeStartLine(
  line: TextLine,
  parsedCodeLine: NumberedCodeLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  if (line === titleLine) return false;
  if (containsDocumentMetadata(parsedCodeLine.content)) return false;
  if (!STRONG_CODE_START_TEXT_PATTERN.test(parsedCodeLine.content)) return false;
  if (!isLikelyCodeText(parsedCodeLine.content)) return false;
  if (line.fontSize > bodyFontSize * NUMBERED_CODE_BLOCK_MAX_FONT_RATIO) return false;
  if (detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !== undefined) {
    return false;
  }
  return true;
}

function isNumberedCodeContinuationCandidateLine(
  line: TextLine,
  startLine: TextLine,
  previousCodeLine: TextLine,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  if (line.pageIndex !== startLine.pageIndex) return false;
  if (line.y >= previousCodeLine.y) return false;
  if (line.fontSize > bodyFontSize * NUMBERED_CODE_BLOCK_MAX_FONT_RATIO) return false;
  if (Math.abs(line.fontSize - startLine.fontSize) > NUMBERED_CODE_BLOCK_MAX_FONT_DELTA) return false;
  if (!isAlignedWithNumberedCodeColumn(line, startLine)) return false;
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return false;
  if (containsDocumentMetadata(normalized)) return false;
  if (detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !== undefined) {
    return false;
  }
  const maxVerticalGap = getFontScaledVerticalGapLimit(
    previousCodeLine.fontSize,
    NUMBERED_CODE_BLOCK_MAX_VERTICAL_GAP_RATIO,
  );
  return hasDescendingVerticalGapWithinLimit(previousCodeLine, line, maxVerticalGap);
}

function isAlignedWithNumberedCodeColumn(line: TextLine, startLine: TextLine): boolean {
  if (line.x < startLine.x - 2) return false;
  return line.x <= startLine.x + NUMBERED_CODE_BLOCK_MAX_LEFT_OFFSET;
}

function isLikelyCodeContinuationText(text: string): boolean {
  if (isLikelyCodeText(text)) return true;
  if (text.length < 2) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (!/[(){}\[\].,_]/.test(text)) return false;
  return true;
}

function isLikelyCodeText(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length === 0) return false;
  return CODE_STYLE_TEXT_PATTERN.test(normalized);
}

function computePageTypicalBodyWidths(lines: TextLine[], bodyFontSize: number): Map<number, number> {
  const pageWidths = new Map<number, number[]>();
  for (const line of lines) {
    if (Math.abs(line.fontSize - bodyFontSize) > 1.0) continue;
    if (normalizeSpacing(line.text).length < 20) continue;
    const existing = pageWidths.get(line.pageIndex);
    if (existing) {
      existing.push(line.estimatedWidth);
    } else {
      pageWidths.set(line.pageIndex, [line.estimatedWidth]);
    }
  }
  const result = new Map<number, number>();
  for (const [pageIndex, widths] of pageWidths) {
    if (widths.length < 5) continue;
    widths.sort((a, b) => a - b);
    const percentileIndex = Math.floor(widths.length * BODY_PARAGRAPH_TYPICAL_WIDTH_PERCENTILE);
    result.set(pageIndex, widths[percentileIndex]);
  }
  return result;
}

function consumeBodyParagraph(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  pageTypicalWidths: Map<number, number>,
): { text: string; nextIndex: number } | undefined {
  const startLine = lines[startIndex];
  const typicalWidth = pageTypicalWidths.get(startLine.pageIndex);
  if (typicalWidth === undefined) return undefined;

  const startNormalized = parseParagraphMergeCandidateText(startLine, {
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
  });
  if (startNormalized === undefined) return undefined;
  if (BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(startNormalized)) return undefined;
  if (STANDALONE_CAPTION_LABEL_PATTERN.test(startNormalized)) return undefined;
  if (
    !isBodyParagraphLead(
      lines,
      startIndex,
      startLine,
      startNormalized,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
      typicalWidth,
    )
  ) {
    return undefined;
  }

  const parts = [startNormalized];
  const nextIndex = consumeBodyParagraphContinuationParts(
    lines,
    startIndex + 1,
    startLine,
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
    typicalWidth,
    parts,
  );

  if (parts.length <= 1 && nextIndex === startIndex + 1) return undefined;
  return { text: normalizeSpacing(parts.join(" ")), nextIndex };
}

function isBodyParagraphLead(
  lines: TextLine[],
  startIndex: number,
  startLine: TextLine,
  startNormalized: string,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  typicalWidth: number,
): boolean {
  if (startLine.estimatedWidth >= typicalWidth * BODY_PARAGRAPH_FULL_WIDTH_RATIO) return true;
  if (
    consumeSameRowOperatorSplitBodyContinuation(
      lines,
      startIndex + 1,
      startLine,
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
      typicalWidth,
    ) !== undefined
  ) {
    return true;
  }
  return isShortWrappedBodyParagraphLead(
    lines,
    startIndex,
    startLine,
    startNormalized,
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
    typicalWidth,
  );
}

function consumeBodyParagraphContinuationParts(
  lines: TextLine[],
  continuationStartIndex: number,
  startLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  typicalWidth: number,
  parts: string[],
): number {
  let previousLine = startLine;
  let nextIndex = continuationStartIndex;

  while (nextIndex < lines.length) {
    const sameRowOperatorContinuation = consumeSameRowOperatorSplitBodyContinuation(
      lines,
      nextIndex,
      previousLine,
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
      typicalWidth,
    );
    if (sameRowOperatorContinuation !== undefined) {
      appendBodyParagraphPart(parts, sameRowOperatorContinuation.text);
      nextIndex = sameRowOperatorContinuation.nextIndex;
      continue;
    }

    const candidate = lines[nextIndex];
    const bridgedContinuationIndex = findBodyParagraphContinuationAfterInlineMathArtifacts(
      lines,
      nextIndex,
      previousLine,
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    );
    if (bridgedContinuationIndex !== undefined) {
      nextIndex = bridgedContinuationIndex;
      continue;
    }
    if (!isBodyParagraphContinuationLine(
      candidate,
      previousLine,
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    )) {
      break;
    }

    appendBodyParagraphPart(parts, normalizeSpacing(candidate.text));
    previousLine = candidate;
    nextIndex += 1;
    const isFullWidth = candidate.estimatedWidth >= typicalWidth * BODY_PARAGRAPH_FULL_WIDTH_RATIO;
    if (isFullWidth) continue;

    const sameRowContinuation = consumeTrailingSameRowSentenceContinuation(
      lines,
      nextIndex,
      candidate,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    );
    if (sameRowContinuation === undefined) break;
    parts.push(sameRowContinuation.text);
    previousLine = sameRowContinuation.line;
    nextIndex = sameRowContinuation.nextIndex;
  }

  return nextIndex;
}

function appendBodyParagraphPart(parts: string[], text: string): void {
  const previousText = parts[parts.length - 1];
  if (isHyphenWrappedLineText(previousText)) {
    parts[parts.length - 1] = mergeHyphenWrappedTexts(previousText, text);
    return;
  }
  parts.push(text);
}

function isShortWrappedBodyParagraphLead(
  lines: TextLine[],
  startIndex: number,
  startLine: TextLine,
  startNormalized: string,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  typicalWidth: number,
): boolean {
  if (startLine.estimatedWidth < typicalWidth * BODY_PARAGRAPH_SHORT_LEAD_MIN_WIDTH_RATIO) {
    return false;
  }
  if (INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(startNormalized)) return false;
  if (splitWords(startNormalized).length < BODY_PARAGRAPH_SHORT_LEAD_MIN_WORD_COUNT) return false;

  const previousLine = lines[startIndex - 1];
  if (!previousLine || previousLine.pageIndex !== startLine.pageIndex) return false;
  const maxSameRowDelta = Math.max(
    startLine.fontSize * BODY_PARAGRAPH_SHORT_LEAD_SAME_ROW_MAX_VERTICAL_DELTA_FONT_RATIO,
    1.5,
  );
  if (Math.abs(previousLine.y - startLine.y) > maxSameRowDelta) return false;
  if (previousLine.x >= startLine.x) return false;

  const previousText = normalizeSpacing(previousLine.text);
  if (!INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(previousText)) return false;

  const nextLine = lines[startIndex + 1];
  if (!nextLine || nextLine.pageIndex !== startLine.pageIndex) return false;
  if (nextLine.estimatedWidth < typicalWidth * BODY_PARAGRAPH_FULL_WIDTH_RATIO) return false;
  if (
    startLine.x - nextLine.x <
    startLine.pageWidth * BODY_PARAGRAPH_SHORT_LEAD_MIN_X_BACKSHIFT_RATIO
  ) {
    return false;
  }

  return isBodyParagraphContinuationLine(
    nextLine,
    startLine,
    startLine,
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
  );
}

function consumeTrailingSameRowSentenceContinuation(
  lines: TextLine[],
  continuationIndex: number,
  shortLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): { text: string; line: TextLine; nextIndex: number } | undefined {
  const continuation = lines[continuationIndex];
  if (!continuation) return undefined;
  if (
    !isSameRowSentenceSplitStartLine(
      shortLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    )
  ) {
    return undefined;
  }
  if (
    !isSameRowSentenceSplitContinuationLine(
      continuation,
      shortLine,
      shortLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    )
  ) {
    return undefined;
  }
  return {
    text: normalizeSpacing(continuation.text),
    line: continuation,
    nextIndex: continuationIndex + 1,
  };
}

function consumeSameRowOperatorSplitBodyContinuation(
  lines: TextLine[],
  continuationIndex: number,
  previousLine: TextLine,
  startLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  typicalWidth: number,
): { text: string; nextIndex: number } | undefined {
  const previousText = normalizeSpacing(previousLine.text);
  if (!BODY_PARAGRAPH_OPERATOR_TRAILING_PATTERN.test(previousText)) return undefined;
  if (
    previousLine.estimatedWidth >
    typicalWidth * BODY_PARAGRAPH_OPERATOR_SAME_ROW_MAX_PREVIOUS_WIDTH_RATIO
  ) {
    return undefined;
  }

  const continuation = lines[continuationIndex];
  if (!continuation) return undefined;
  const continuationText = parseParagraphMergeCandidateText(continuation, {
    samePageAs: previousLine,
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
    startPattern: BODY_PARAGRAPH_CONTINUATION_START_PATTERN,
  });
  if (continuationText === undefined) return undefined;
  if (
    continuation.estimatedWidth >
    typicalWidth * BODY_PARAGRAPH_OPERATOR_SAME_ROW_MAX_CONTINUATION_WIDTH_RATIO
  ) {
    return undefined;
  }

  const maxYDelta =
    Math.max(previousLine.fontSize, continuation.fontSize) *
    BODY_PARAGRAPH_OPERATOR_SAME_ROW_MAX_VERTICAL_DELTA_FONT_RATIO;
  if (Math.abs(previousLine.y - continuation.y) > maxYDelta) return undefined;
  const minXDelta = continuation.pageWidth * BODY_PARAGRAPH_OPERATOR_SAME_ROW_MIN_X_DELTA_RATIO;
  if (continuation.x - previousLine.x < minXDelta) return undefined;

  const nextLine = lines[continuationIndex + 1];
  if (!nextLine) return undefined;
  if (
    !isBodyParagraphContinuationLine(
      nextLine,
      previousLine,
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    )
  ) {
    return undefined;
  }

  return { text: continuationText, nextIndex: continuationIndex + 1 };
}

function findBodyParagraphContinuationAfterInlineMathArtifacts(
  lines: TextLine[],
  artifactStartIndex: number,
  previousLine: TextLine,
  startLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): number | undefined {
  const previousText = normalizeSpacing(previousLine.text);
  if (INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(previousText)) return undefined;

  let scanIndex = artifactStartIndex;
  const maxScanIndex = Math.min(lines.length, artifactStartIndex + INLINE_MATH_BRIDGE_MAX_LOOKAHEAD);
  while (scanIndex < maxScanIndex) {
    const artifact = lines[scanIndex];
    if (!isInlineMathArtifactBridgeLine(artifact, previousLine)) return undefined;

    const continuationIndex = scanIndex + 1;
    const continuationLine = lines[continuationIndex];
    if (!continuationLine) return undefined;
    if (continuationLine.pageIndex !== previousLine.pageIndex) return undefined;

    if (
      isBodyParagraphContinuationLine(
        continuationLine,
        previousLine,
        startLine,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      )
    ) {
      return continuationIndex;
    }
    scanIndex += 1;
  }

  return undefined;
}

function shouldSkipDetachedLowercaseMathSubscriptLine(
  lines: TextLine[],
  index: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  const line = lines[index];
  const previousLine = lines[index - 1];
  if (!line || !previousLine) return false;
  if (line.pageIndex !== previousLine.pageIndex) return false;

  const normalized = parseParagraphMergeCandidateText(line, {
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
  });
  if (normalized === undefined) return false;
  if (!DETACHED_LOWERCASE_MATH_SUBSCRIPT_PATTERN.test(normalized)) return false;

  const verticalGap = previousLine.y - line.y;
  const maxVerticalGap = Math.max(previousLine.fontSize * INLINE_MATH_BRIDGE_MAX_VERTICAL_GAP_RATIO, 3);
  if (verticalGap <= 0 || verticalGap > maxVerticalGap) return false;
  if (line.fontSize > previousLine.fontSize * INLINE_MATH_BRIDGE_SUBSCRIPT_MAX_FONT_RATIO) {
    return false;
  }
  if (
    line.estimatedWidth >
    line.pageWidth * DETACHED_LOWERCASE_MATH_SUBSCRIPT_MAX_WIDTH_RATIO
  ) {
    return false;
  }

  const previousText = normalizeSpacing(previousLine.text);
  const nextLine = lines[index + 1];
  const nextText =
    nextLine && nextLine.pageIndex === line.pageIndex ? normalizeSpacing(nextLine.text) : "";
  return hasDetachedMathSubscriptContext(previousText, nextText);
}

function hasDetachedMathSubscriptContext(previousText: string, nextText: string): boolean {
  if (DETACHED_MATH_SUBSCRIPT_TRAILING_VARIABLE_PATTERN.test(previousText)) return true;
  if (DETACHED_MATH_SUBSCRIPT_ASSIGNMENT_CONTEXT_PATTERN.test(previousText)) return true;
  return DETACHED_MATH_SUBSCRIPT_ASSIGNMENT_CONTEXT_PATTERN.test(nextText);
}

function isInlineMathArtifactBridgeLine(line: TextLine, previousLine: TextLine): boolean {
  if (line.pageIndex !== previousLine.pageIndex) return false;

  const verticalGap = previousLine.y - line.y;
  const maxVerticalGap = Math.max(
    previousLine.fontSize * INLINE_MATH_BRIDGE_MAX_VERTICAL_GAP_RATIO,
    3,
  );
  if (verticalGap <= 0 || verticalGap > maxVerticalGap) return false;
  if (line.estimatedWidth > previousLine.estimatedWidth * INLINE_MATH_BRIDGE_MAX_WIDTH_RATIO) {
    return false;
  }

  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0 || normalized.length > INLINE_MATH_BRIDGE_MAX_TEXT_LENGTH) return false;
  if (!INLINE_MATH_BRIDGE_ALLOWED_CHARS_PATTERN.test(normalized)) return false;

  const tokens = normalized.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0 || tokens.length > INLINE_MATH_BRIDGE_MAX_TOKEN_COUNT) return false;

  const hasNumericOrSymbol = tokens.some(
    (token) =>
      INLINE_MATH_BRIDGE_NUMERIC_TOKEN_PATTERN.test(token) ||
      INLINE_MATH_BRIDGE_SYMBOL_TOKEN_PATTERN.test(token),
  );
  if (!hasNumericOrSymbol) {
    return isLowercaseSubscriptBridgeTokenLine(tokens, line, previousLine);
  }

  return tokens.every(
    (token) =>
      INLINE_MATH_BRIDGE_NUMERIC_TOKEN_PATTERN.test(token) ||
      INLINE_MATH_BRIDGE_SYMBOL_TOKEN_PATTERN.test(token) ||
      INLINE_MATH_BRIDGE_VARIABLE_TOKEN_PATTERN.test(token),
  );
}

function isLowercaseSubscriptBridgeTokenLine(
  tokens: string[],
  line: TextLine,
  previousLine: TextLine,
): boolean {
  if (tokens.length === 0 || tokens.length > INLINE_MATH_BRIDGE_SUBSCRIPT_MAX_TOKEN_COUNT) {
    return false;
  }
  if (line.fontSize > previousLine.fontSize * INLINE_MATH_BRIDGE_SUBSCRIPT_MAX_FONT_RATIO) {
    return false;
  }
  if (!tokens.some((token) => token.length >= INLINE_MATH_BRIDGE_SUBSCRIPT_MIN_TOKEN_LENGTH)) {
    return false;
  }
  return tokens.every((token) => INLINE_MATH_BRIDGE_LOWERCASE_SUBSCRIPT_TOKEN_PATTERN.test(token));
}

function isBodyParagraphContinuationLine(
  line: TextLine,
  previousLine: TextLine,
  startLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  const normalized = parseParagraphMergeCandidateText(line, {
    samePageAs: previousLine,
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
    startPattern: BODY_PARAGRAPH_CONTINUATION_START_PATTERN,
  });
  if (normalized === undefined) return false;
  if (
    BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(normalized) &&
    !isCitationLeadingContinuationLine(normalized, previousLine)
  ) {
    return false;
  }
  if (STANDALONE_CAPTION_LABEL_PATTERN.test(normalized)) return false;

  if (Math.abs(line.fontSize - startLine.fontSize) > BODY_PARAGRAPH_MAX_FONT_DELTA) return false;

  const maxVerticalGap = getFontScaledVerticalGapLimit(
    previousLine.fontSize,
    BODY_PARAGRAPH_MAX_VERTICAL_GAP_RATIO,
  );
  if (!hasDescendingVerticalGapWithinLimit(previousLine, line, maxVerticalGap)) return false;

  const centerOffset = Math.abs(getLineCenter(line) - getLineCenter(previousLine));
  const leftOffset = Math.abs(line.x - previousLine.x);
  if (
    centerOffset > line.pageWidth * BODY_PARAGRAPH_MAX_CENTER_OFFSET_RATIO &&
    leftOffset > line.pageWidth * BODY_PARAGRAPH_MAX_LEFT_OFFSET_RATIO
  ) {
    return false;
  }

  return true;
}

function isCitationLeadingContinuationLine(normalized: string, previousLine: TextLine): boolean {
  if (!BODY_PARAGRAPH_CITATION_CONTINUATION_PATTERN.test(normalized)) return false;
  const previousText = normalizeSpacing(previousLine.text);
  return !INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(previousText);
}
