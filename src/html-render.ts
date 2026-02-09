// biome-ignore lint/nursery/noExcessiveLinesPerFile: HTML rendering heuristics are intentionally grouped.
import type { TextLine } from "./pdf-types.ts";
import { estimateBodyFontSize, normalizeSpacing } from "./text-lines.ts";
import { containsDocumentMetadata, findTitleLine } from "./title-detect.ts";
import { detectNamedSectionHeadingLevel, detectNumberedHeadingLevel } from "./heading-detect.ts";

const INLINE_ACKNOWLEDGEMENTS_HEADING_PATTERN =
  /^(acknowledg(?:e)?ments?)(?:(?:\s*[:\-–]\s*)|\s+)(.+)$/iu;
const INLINE_ACKNOWLEDGEMENTS_MIN_BODY_LENGTH = 8;
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
const STANDALONE_ACKNOWLEDGEMENTS_HEADING_PATTERN = /^acknowledg(?:e)?ments?$/iu;
const ACKNOWLEDGEMENTS_CONTINUATION_START_PATTERN = /^[a-z(“‘"']/u;
const ACKNOWLEDGEMENTS_MAX_FONT_DELTA = 0.8;
const ACKNOWLEDGEMENTS_MAX_LEFT_OFFSET_RATIO = 0.06;
const ACKNOWLEDGEMENTS_MAX_VERTICAL_GAP_RATIO = 2.8;
const HYPHEN_WRAPPED_LINE_PATTERN = /[A-Za-z]-$/;
const HYPHEN_WRAP_CONTINUATION_START_PATTERN = /^[A-Za-z]/;
const HYPHEN_WRAP_MAX_VERTICAL_GAP_RATIO = 2.8;
const HYPHEN_WRAP_MAX_LEFT_OFFSET_RATIO = 0.08;
const HYPHEN_WRAP_MAX_CENTER_OFFSET_RATIO = 0.12;
const HYPHEN_WRAP_MIN_LINE_WIDTH_RATIO = 0.45;
const HYPHEN_WRAP_MIN_CONTINUATION_WIDTH_RATIO = 0.45;
const SAME_ROW_SENTENCE_SPLIT_END_PATTERN = /[.!?]["')\]]?$/;
const SAME_ROW_SENTENCE_CONTINUATION_START_PATTERN = /^[A-Z0-9(“‘"']/u;
const SAME_ROW_SENTENCE_SPLIT_MAX_VERTICAL_DELTA_FONT_RATIO = 0.2;
const SAME_ROW_SENTENCE_SPLIT_MAX_FONT_DELTA = 0.7;
const SAME_ROW_SENTENCE_SPLIT_MIN_X_DELTA_RATIO = 0.01;
const SAME_ROW_SENTENCE_SPLIT_MAX_X_DELTA_RATIO = 0.14;
const SAME_ROW_SENTENCE_SPLIT_MAX_START_WIDTH_RATIO = 0.45;
const STANDALONE_CAPTION_LABEL_PATTERN =
  /^(?:Figure|Fig\.?|Table|Algorithm|Eq(?:uation)?\.?)\s+\d+[A-Za-z]?[.:]?$/iu;

interface HeadingCandidate {
  kind: "named" | "numbered";
  level: number;
}

interface NumberedHeadingSectionInfo {
  topLevelNumber: number;
  depth: number;
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
  const hasDottedSubsectionHeadings = lines.some((line) =>
    DOTTED_SUBSECTION_HEADING_PATTERN.test(normalizeSpacing(line.text)),
  );
  const seenTopLevelNumberedSections = new Set<number>();
  const consumedTitle = titleLine ? consumeTitleLines(lines, titleLine) : undefined;
  const consumedNumberedHeadingContinuationIndexes = new Set<number>();
  let index = consumedTitle?.startIndex ?? 0;
  while (index < lines.length) {
    if (consumedTitle && index === consumedTitle.startIndex) {
      bodyLines.push(`<h1>${escapeHtml(consumedTitle.text)}</h1>`);
      index = consumedTitle.nextIndex;
      continue;
    }
    if (consumedTitle && index > consumedTitle.startIndex && index < consumedTitle.nextIndex) {
      index += 1;
      continue;
    }
    if (consumedNumberedHeadingContinuationIndexes.has(index)) {
      index += 1;
      continue;
    }

    const currentLine = lines[index];

    let heading = detectHeadingCandidate(currentLine, bodyFontSize, hasDottedSubsectionHeadings);
    const numberedHeadingSectionInfo =
      heading?.kind === "numbered" ? parseNumberedHeadingSectionInfo(currentLine.text) : undefined;
    if (
      heading?.kind === "numbered" &&
      numberedHeadingSectionInfo !== undefined &&
      numberedHeadingSectionInfo.depth > 1 &&
      !seenTopLevelNumberedSections.has(numberedHeadingSectionInfo.topLevelNumber)
    ) {
      heading = undefined;
    }

    if (heading !== undefined) {
      let headingText = currentLine.text;
      if (heading.kind === "numbered") {
        const wrapped = consumeWrappedNumberedHeadingContinuation(
          lines,
          index,
          currentLine,
          bodyFontSize,
        );
        for (const continuationIndex of wrapped.continuationIndexes) {
          consumedNumberedHeadingContinuationIndexes.add(continuationIndex);
        }
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

    const inlineHeading = parseInlineAcknowledgementsHeading(currentLine.text);
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

    const hyphenWrappedParagraph = consumeHyphenWrappedParagraph(
      lines,
      index,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    );
    if (hyphenWrappedParagraph !== undefined) {
      bodyLines.push(`<p>${escapeHtml(hyphenWrappedParagraph.text)}</p>`);
      index = hyphenWrappedParagraph.nextIndex;
      continue;
    }

    const sameRowSentenceSplitParagraph = consumeSameRowSentenceSplitParagraph(
      lines,
      index,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    );
    if (sameRowSentenceSplitParagraph !== undefined) {
      bodyLines.push(`<p>${escapeHtml(sameRowSentenceSplitParagraph.text)}</p>`);
      index = sameRowSentenceSplitParagraph.nextIndex;
      continue;
    }

    bodyLines.push(`<p>${escapeHtml(currentLine.text)}</p>`);
    index += 1;
  }
  return bodyLines;
}

function parseNumberedHeadingSectionInfo(text: string): NumberedHeadingSectionInfo | undefined {
  const normalized = normalizeSpacing(text);
  const match = /^(\d+(?:\.\d+){0,4})\.?\s+/.exec(normalized);
  if (!match) return undefined;

  const sectionNumber = match[1];
  const topLevelNumber = Number.parseInt(sectionNumber.split(".")[0] ?? "", 10);
  if (!Number.isFinite(topLevelNumber)) return undefined;
  return { topLevelNumber, depth: sectionNumber.split(".").length };
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
  if (containsDocumentMetadata(normalized)) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;
  if (detectNumberedHeadingLevel(normalized) !== undefined) return false;
  if (detectNamedSectionHeadingLevel(normalized) !== undefined) return false;
  if (/[.!?]$/.test(normalized)) return false;
  if (normalized.split(/\s+/).length > MAX_NUMBERED_HEADING_CONTINUATION_WORDS) return false;
  if (line.fontSize < bodyFontSize * MIN_NUMBERED_HEADING_CONTINUATION_FONT_RATIO) return false;
  if (Math.abs(line.fontSize - headingLine.fontSize) > NUMBERED_HEADING_CONTINUATION_MAX_FONT_DELTA) {
    return false;
  }
  const verticalGap = previousPartLine.y - line.y;
  const maxVerticalGap = Math.max(
    headingLine.fontSize * NUMBERED_HEADING_CONTINUATION_MAX_VERTICAL_GAP_RATIO,
    headingLine.fontSize + 10,
  );
  return verticalGap > 0 && verticalGap <= maxVerticalGap;
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
): { startIndex: number; text: string; nextIndex: number } {
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
  if (containsDocumentMetadata(text)) return false;
  const words = text.split(" ").filter((token) => token.length > 0);
  const hasEnoughWords =
    words.length >= TITLE_CONTINUATION_MIN_WORD_COUNT || isLikelyShortTitleContinuation(words);
  if (!hasEnoughWords) return false;
  return (
    detectNumberedHeadingLevel(text) === undefined &&
    detectNamedSectionHeadingLevel(text) === undefined
  );
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
  const maxGap = Math.max(
    titleLine.fontSize * TITLE_CONTINUATION_MAX_VERTICAL_GAP_RATIO,
    titleLine.fontSize + 10,
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
  if (bodyText.length < INLINE_ACKNOWLEDGEMENTS_MIN_BODY_LENGTH) return undefined;
  if (!/[A-Za-z]/.test(bodyText)) return undefined;
  return { heading: headingText, body: bodyText, level: 2 };
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
  const normalized = parseSamePageParagraphMergeCandidateText(
    line,
    previousLine,
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
    HYPHEN_WRAP_CONTINUATION_START_PATTERN,
  );
  if (normalized === undefined) return false;

  const verticalGap = previousLine.y - line.y;
  const maxVerticalGap = Math.max(
    previousLine.fontSize * HYPHEN_WRAP_MAX_VERTICAL_GAP_RATIO,
    previousLine.fontSize + 10,
  );
  if (verticalGap <= 0 || verticalGap > maxVerticalGap) return false;
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
  const left = currentText.trimEnd();
  const right = nextLineText.trimStart();
  return normalizeSpacing(`${left}${right}`);
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
  const normalized = parseParagraphMergeCandidateText(
    line,
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
  );
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
  const normalized = parseSamePageParagraphMergeCandidateText(
    line,
    previousLine,
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
    SAME_ROW_SENTENCE_CONTINUATION_START_PATTERN,
  );
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

function parseSamePageParagraphMergeCandidateText(
  line: TextLine,
  previousLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  startPattern: RegExp,
): string | undefined {
  if (line.pageIndex !== previousLine.pageIndex) return undefined;
  return parseParagraphMergeCandidateText(
    line,
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
    startPattern,
  );
}

function parseParagraphMergeCandidateText(
  line: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  startPattern?: RegExp,
): string | undefined {
  if (line === titleLine) return undefined;
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return undefined;
  if (startPattern !== undefined && !startPattern.test(normalized)) return undefined;
  if (containsDocumentMetadata(normalized)) return undefined;
  if (parseBulletListItemText(normalized) !== undefined) return undefined;
  if (parseInlineAcknowledgementsHeading(normalized) !== undefined) return undefined;
  if (parseStandaloneUrlLine(normalized) !== undefined) return undefined;
  if (detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !== undefined) {
    return undefined;
  }
  return normalized;
}

function isAcknowledgementsBodyLine(line: TextLine, headingLine: TextLine): boolean {
  if (line.pageIndex !== headingLine.pageIndex) return false;
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;
  if (containsDocumentMetadata(normalized)) return false;
  if (parseBulletListItemText(normalized) !== undefined) return false;
  if (detectNumberedHeadingLevel(normalized) !== undefined) return false;
  if (detectNamedSectionHeadingLevel(normalized) !== undefined) return false;
  if (parseStandaloneUrlLine(normalized) !== undefined) return false;

  if (Math.abs(line.fontSize - headingLine.fontSize) > ACKNOWLEDGEMENTS_MAX_FONT_DELTA) {
    return false;
  }
  const verticalGap = headingLine.y - line.y;
  const maxVerticalGap = Math.max(
    headingLine.fontSize * ACKNOWLEDGEMENTS_MAX_VERTICAL_GAP_RATIO,
    headingLine.fontSize + 10,
  );
  if (verticalGap < 0 || verticalGap > maxVerticalGap) return false;

  return line.x >= headingLine.x - line.pageWidth * ACKNOWLEDGEMENTS_MAX_LEFT_OFFSET_RATIO;
}

function isAcknowledgementsBodyContinuationLine(
  line: TextLine,
  previousLine: TextLine,
  previousText: string,
  headingLine: TextLine,
): boolean {
  if (line.pageIndex !== previousLine.pageIndex || line.pageIndex !== headingLine.pageIndex) {
    return false;
  }
  if (/[.!?]$/.test(previousText)) return false;
  if (!isAcknowledgementsBodyLine(line, headingLine)) return false;

  const normalized = normalizeSpacing(line.text);
  if (!ACKNOWLEDGEMENTS_CONTINUATION_START_PATTERN.test(normalized)) return false;
  if (Math.abs(line.fontSize - previousLine.fontSize) > ACKNOWLEDGEMENTS_MAX_FONT_DELTA) {
    return false;
  }
  const verticalGap = previousLine.y - line.y;
  const maxVerticalGap = Math.max(
    previousLine.fontSize * ACKNOWLEDGEMENTS_MAX_VERTICAL_GAP_RATIO,
    previousLine.fontSize + 10,
  );
  if (verticalGap <= 0 || verticalGap > maxVerticalGap) return false;

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
  const baseUrl = parseStandaloneUrlLine(lines[startIndex].text);
  if (baseUrl === undefined) return undefined;

  let url = baseUrl.url;
  let trailingPunctuation = baseUrl.trailingPunctuation;
  let nextIndex = startIndex + 1;

  if (url.endsWith("/") && nextIndex < lines.length) {
    const continuation = parseUrlContinuationLine(lines[nextIndex].text);
    if (continuation !== undefined) {
      const merged = `${url}${continuation.path}`;
      if (isValidHttpUrl(merged)) {
        url = merged;
        trailingPunctuation = continuation.trailingPunctuation;
        nextIndex += 1;
      }
    }
  }

  const escaped = escapeHtml(url);
  return {
    html: `<p><a href="${escaped}">${escaped}</a>${escapeHtml(trailingPunctuation)}</p>`,
    nextIndex,
  };
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
