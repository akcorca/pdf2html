// biome-ignore lint/nursery/noExcessiveLinesPerFile: HTML rendering heuristics are intentionally grouped.
import type { ExtractedDocument, TextLine } from "./pdf-types.ts";
import { estimateBodyFontSize, normalizeSpacing, splitWords } from "./text-lines.ts";
import { containsDocumentMetadata, findTitleLine } from "./title-detect.ts";
import { detectNamedSectionHeadingLevel, detectNumberedHeadingLevel } from "./heading-detect.ts";
import { detectTable, renderTableHtml } from "./table-detect.ts";

const INLINE_ACKNOWLEDGEMENTS_HEADING_PATTERN =
  /^(acknowledg(?:e)?ments?)(?:(?:\s*[:\-–]\s*)|\s+)(.+)$/iu;
const INLINE_ACKNOWLEDGEMENTS_MIN_BODY_LENGTH = 8;
const INLINE_NAMED_SECTION_HEADING_PATTERN = /^(.+?)(?:\s*[:\-–]\s*)(.+)$/u;
const INLINE_NAMED_SECTION_HEADING_MIN_BODY_LENGTH = 8;
const AUTHOR_BLOCK_END_PATTERN = /^(abstract|introduction)/iu;
const AUTHOR_BLOCK_MAX_LINES = 20;
const AUTHOR_BLOCK_MAX_FONT_DELTA = 2.5;
const AUTHOR_EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu;
const AUTHOR_ROW_MERGE_MAX_Y_DELTA = 2;
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
const URL_NON_SLASH_CONTINUATION_FRAGMENT_PATTERN = /[-._~%=&]|\d/u;
const STANDALONE_URL_CONTINUATION_MAX_LOOKAHEAD = 4;
const STANDALONE_URL_CONTINUATION_MAX_LEFT_OFFSET_RATIO = 0.08;
const STANDALONE_URL_CONTINUATION_MAX_VERTICAL_GAP_RATIO = 3.2;
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
const REFERENCE_ENTRY_CONTINUATION_MAX_VERTICAL_GAP_RATIO = 2.8;
const REFERENCE_ENTRY_CONTINUATION_MAX_FONT_DELTA = 0.8;
const REFERENCE_ENTRY_CONTINUATION_MAX_LEFT_OFFSET_RATIO = 0.08;
const REFERENCE_ENTRY_CONTINUATION_MAX_CENTER_OFFSET_RATIO = 0.12;
const BODY_PARAGRAPH_CITATION_CONTINUATION_PATTERN =
  /^\[\d+(?:\s*,\s*\d+)*\]\s*[,;:]\s+[A-Za-z(“‘"']/u;
const BODY_PARAGRAPH_INDENT_LEAD_START_PATTERN = /^[A-Z(“‘"']/u;
const BODY_PARAGRAPH_INDENT_LEAD_MIN_WIDTH_RATIO = 0.5;
const BODY_PARAGRAPH_INDENT_LEAD_MIN_WORD_COUNT = 4;
const BODY_PARAGRAPH_INDENT_LEAD_MIN_X_OFFSET_RATIO = 0.01;
const BODY_PARAGRAPH_INDENT_LEAD_MAX_X_OFFSET_RATIO = 0.06;
const BODY_PARAGRAPH_SHORT_LEAD_MIN_WIDTH_RATIO = 0.55;
const BODY_PARAGRAPH_SHORT_LEAD_MIN_WORD_COUNT = 4;
const BODY_PARAGRAPH_SHORT_LEAD_MIN_X_BACKSHIFT_RATIO = 0.08;
const BODY_PARAGRAPH_SHORT_LEAD_SAME_ROW_MAX_VERTICAL_DELTA_FONT_RATIO = 0.25;
const BODY_PARAGRAPH_INLINE_MATH_ARTIFACT_LEAD_MIN_WIDTH_RATIO = 0.8;
// Same-row fragments can split after math operators or citation open brackets.
const BODY_PARAGRAPH_OPERATOR_TRAILING_PATTERN = /[+\-−/=\[]$/u;
const BODY_PARAGRAPH_OPERATOR_SAME_ROW_MIN_X_DELTA_RATIO = 0.18;
const BODY_PARAGRAPH_OPERATOR_SAME_ROW_MAX_VERTICAL_DELTA_FONT_RATIO = 0.25;
const BODY_PARAGRAPH_OPERATOR_SAME_ROW_MAX_PREVIOUS_WIDTH_RATIO = 0.7;
const BODY_PARAGRAPH_OPERATOR_SAME_ROW_MAX_CONTINUATION_WIDTH_RATIO = 0.65;
const INLINE_MATH_BRIDGE_MAX_LOOKAHEAD = 4;
const INLINE_MATH_BRIDGE_MAX_TEXT_LENGTH = 24;
const INLINE_MATH_BRIDGE_MAX_TOKEN_COUNT = 8;
const INLINE_MATH_BRIDGE_MAX_VERTICAL_GAP_RATIO = 1.0;
const INLINE_MATH_BRIDGE_MAX_WIDTH_RATIO = 0.55;
const INLINE_MATH_BRIDGE_ALLOWED_CHARS_PATTERN = /^[A-Za-z0-9\s−\-+*/=(){}\[\],.;:√∞]+$/u;
const INLINE_MATH_BRIDGE_VARIABLE_TOKEN_PATTERN = /^[A-Za-z]$/;
const INLINE_MATH_BRIDGE_DETACHED_SINGLE_TOKEN_PATTERN = /^[A-Za-z0-9]$/u;
const INLINE_MATH_BRIDGE_DETACHED_SINGLE_TOKEN_MAX_FONT_RATIO = 0.82;
const INLINE_MATH_BRIDGE_DETACHED_SINGLE_TOKEN_MAX_WIDTH_RATIO = 0.08;
const INLINE_MATH_BRIDGE_LOWERCASE_SUBSCRIPT_TOKEN_PATTERN = /^[a-z]{1,6}$/u;
const INLINE_MATH_BRIDGE_APPENDABLE_LOWERCASE_TOKEN_PATTERN = /^[a-z]{1,3}$/u;
const INLINE_MATH_BRIDGE_NUMERIC_TOKEN_PATTERN = /^\d{1,4}$/;
const INLINE_MATH_BRIDGE_SYMBOL_TOKEN_PATTERN = /^[−\-+*/=(){}\[\],.;:√∞]+$/u;
const INLINE_MATH_BRIDGE_LEADING_NUMERIC_MARKER_PATTERN = /^\d{1,4}(?:\s+\d{1,4}){1,2}$/;
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
const DISPLAY_MATH_FRAGMENT_MAX_WIDTH_RATIO = 0.40;
const DISPLAY_MATH_FRAGMENT_MAX_VERTICAL_GAP_RATIO = 2.5;
// Matches math operators but not hyphens embedded in words (e.g., "pre-trained").
// For - and −, require word boundary or surrounding space to distinguish from hyphenation.
const DISPLAY_MATH_EQUATION_PATTERN = /[=+×·∑∏∫√∈∉⊂⊃≤≥≈≠∼≡]|(?:^|(?<=\s))[\-−]|\\[a-z]/u;
const DISPLAY_MATH_SUPERSCRIPT_MAX_FONT_RATIO = 0.85;

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

interface NumberedCodeBlockCandidate {
  index: number;
  line: TextLine;
  normalizedText: string;
  parsedNumberedLine?: NumberedCodeLine;
}

interface ReferenceListItem {
  text: string;
  marker?: number;
  sourceOrder: number;
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

interface Author {
  name: string;
  affiliations: string[];
  email?: string;
}

interface AuthorRow {
  y: number;
  cells: Array<{ x: number; text: string }>;
}

export function renderHtml(lines: TextLine[], document?: ExtractedDocument): string {
  const titleLine = findTitleLine(lines);
  const bodyLines = renderBodyLines(lines, titleLine, document);

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
function renderBodyLines(lines: TextLine[], titleLine: TextLine | undefined, document?: ExtractedDocument): string[] {
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
      const authorBlock = titleLine ? consumeAuthorBlock(lines, consumedTitle.nextIndex, titleLine, pageTypicalWidths, bodyFontSize) : undefined;
      if (authorBlock) {
        bodyLines.push(authorBlock.html);
        index = authorBlock.nextIndex;
      } else {
        index = consumedTitle.nextIndex;
      }
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

    const renderedReferenceList = renderReferenceList(
      lines,
      index,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    );
    if (renderedReferenceList !== undefined) {
      bodyLines.push(...renderedReferenceList.htmlLines);
      index = renderedReferenceList.nextIndex;
      continue;
    }

    const renderedStandaloneLink = renderStandaloneLinkParagraph(lines, index);
    if (renderedStandaloneLink !== undefined) {
      bodyLines.push(renderedStandaloneLink.html);
      addConsumedIndexes(consumedBodyLineIndexes, renderedStandaloneLink.consumedIndexes, index);
      index = renderedStandaloneLink.nextIndex;
      continue;
    }

    const detectedTable = detectTable(lines, index, bodyFontSize, document);
    if (detectedTable !== undefined) {
      bodyLines.push(...renderTableHtml(detectedTable));
      index = detectedTable.nextIndex;
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

    const displayMathBlock = consumeDisplayMathBlock(
      lines,
      index,
      bodyFontSize,
      titleLine,
      hasDottedSubsectionHeadings,
    );
    if (displayMathBlock !== undefined) {
      if (displayMathBlock.text.length > 0) {
        bodyLines.push(`<p>${escapeHtml(displayMathBlock.text)}</p>`);
      }
      index = displayMathBlock.nextIndex;
      continue;
    }

    bodyLines.push(`<p>${escapeHtml(currentLine.text)}</p>`);
    index += 1;
  }
  return bodyLines;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: author block boundary detection requires multiple sequential guards.
function consumeAuthorBlock(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine,
  pageTypicalWidths: Map<string, number>,
  bodyFontSize: number,
): { html: string; nextIndex: number } | undefined {
  const authorBlockLines: TextLine[] = [];
  let nextIndex = startIndex;
  let firstAuthorLine: TextLine | undefined;

  while (nextIndex < lines.length && authorBlockLines.length < AUTHOR_BLOCK_MAX_LINES) {
    const line = lines[nextIndex];
    if (line.pageIndex !== titleLine.pageIndex) break;

    if (firstAuthorLine && Math.abs(line.fontSize - firstAuthorLine.fontSize) > AUTHOR_BLOCK_MAX_FONT_DELTA) {
      break;
    }

    const normalized = normalizeSpacing(line.text);
    if (normalized.length === 0) {
      nextIndex++;
      continue;
    }

    if (AUTHOR_BLOCK_END_PATTERN.test(normalized)) {
      break;
    }
    if (detectNamedSectionHeadingLevel(normalized)) {
      break;
    }
    // Author blocks appear in the title area (often full-width), so always use
    // page-wide typical width to avoid false paragraph-lead detection from
    // column-specific widths.
    const typicalWidth = pageTypicalWidths.get(typicalWidthKey(line.pageIndex)) ?? line.pageWidth;
    if (
      isBodyParagraphLead(lines, nextIndex, line, normalized, titleLine, bodyFontSize, false, typicalWidth)
    ) {
      break;
    }

    if (!firstAuthorLine) {
      firstAuthorLine = line;
    }
    authorBlockLines.push(line);
    nextIndex++;
  }

  if (authorBlockLines.length === 0) return undefined;

  const parsedAuthors = parseAuthors(authorBlockLines);
  if (parsedAuthors.length === 0) {
    const fallbackLines = authorBlockLines.map((line) => escapeHtml(line.text));
    const html = `<div class="authors">\n${fallbackLines.join("<br>\n")}\n</div>`;
    return { html, nextIndex };
  }

  const html = renderAuthorBlockHtml(parsedAuthors);

  return { html, nextIndex };
}

function parseAuthors(lines: TextLine[]): Author[] {
  const rows = groupAuthorRows(lines);
  const authors: Author[] = [];
  let pendingRows: AuthorRow[] = [];

  for (const row of rows) {
    const parsedBlock = parseAuthorBlockRows(pendingRows, row);
    if (parsedBlock === undefined) {
      if (row.cells.some((cell) => extractEmails(cell.text).length > 0)) {
        pendingRows = [];
      } else {
        pendingRows.push(row);
      }
      continue;
    }

    authors.push(...parsedBlock);
    pendingRows = [];
  }

  return authors;
}

function parseAuthorBlockRows(pendingRows: AuthorRow[], row: AuthorRow): Author[] | undefined {
  const emailsByCell = row.cells.map((cell) => extractEmails(cell.text));
  const flattenedEmails = emailsByCell.flat();
  if (flattenedEmails.length === 0) return undefined;

  const nameRow = pendingRows[0];
  if (!nameRow) return undefined;

  const entriesPerCell = deriveEntriesPerCell(row, emailsByCell);
  const names = splitRowIntoEntries(nameRow, entriesPerCell);
  if (names.length !== flattenedEmails.length) return undefined;

  const blockAuthors = names.map((name, index): Author => ({
    name,
    affiliations: [],
    email: flattenedEmails[index],
  }));
  appendAuthorAffiliations(blockAuthors, pendingRows.slice(1), entriesPerCell);
  return blockAuthors;
}

function appendAuthorAffiliations(
  authors: Author[],
  affiliationRows: AuthorRow[],
  entriesPerCell: number[],
): void {
  for (const row of affiliationRows) {
    const affiliations = splitRowIntoEntries(row, entriesPerCell);
    for (let index = 0; index < authors.length && index < affiliations.length; index += 1) {
      const affiliation = affiliations[index];
      if (affiliation) authors[index].affiliations.push(affiliation);
    }
  }
}

function groupAuthorRows(lines: TextLine[]): AuthorRow[] {
  const sorted = [...lines].sort((left, right) => right.y - left.y);
  const rows: AuthorRow[] = [];

  for (const line of sorted) {
    const text = normalizeSpacing(line.text);
    if (text.length === 0) continue;

    const currentRow = rows[rows.length - 1];
    if (!currentRow || Math.abs(currentRow.y - line.y) > AUTHOR_ROW_MERGE_MAX_Y_DELTA) {
      rows.push({ y: line.y, cells: [{ x: line.x, text }] });
      continue;
    }
    currentRow.cells.push({ x: line.x, text });
  }

  for (const row of rows) {
    row.cells.sort((left, right) => left.x - right.x);
  }

  return rows;
}

function deriveEntriesPerCell(row: AuthorRow, emailsByCell: string[][]): number[] {
  return row.cells.map((cell, index) => {
    const emailCount = emailsByCell[index]?.length ?? 0;
    if (emailCount > 0) return emailCount;
    return normalizeSpacing(cell.text).length > 0 ? 1 : 0;
  });
}

function splitRowIntoEntries(row: AuthorRow, entriesPerCell: number[]): string[] {
  const entries: string[] = [];
  const maxCellCount = Math.max(row.cells.length, entriesPerCell.length);
  for (let index = 0; index < maxCellCount; index += 1) {
    const text = row.cells[index]?.text ?? "";
    const count = entriesPerCell[index] ?? 1;
    entries.push(...splitCellIntoEntries(text, count));
  }
  return entries.filter((entry) => entry.length > 0);
}

function splitCellIntoEntries(text: string, expectedCount: number): string[] {
  const normalized = normalizeSpacing(text);
  if (normalized.length === 0) return [];
  if (expectedCount <= 1) return [normalized];

  const emails = extractEmails(normalized);
  if (emails.length === expectedCount) return emails;

  const tokens = normalized.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length <= expectedCount) return [normalized];

  const baseSize = Math.floor(tokens.length / expectedCount);
  const remainder = tokens.length % expectedCount;
  const entries: string[] = [];
  let tokenIndex = 0;
  for (let index = 0; index < expectedCount; index += 1) {
    const entrySize = baseSize + (index >= expectedCount - remainder ? 1 : 0);
    const nextTokenIndex = Math.min(tokens.length, tokenIndex + entrySize);
    const entry = tokens.slice(tokenIndex, nextTokenIndex).join(" ");
    if (entry.length > 0) entries.push(entry);
    tokenIndex = nextTokenIndex;
  }

  if (tokenIndex < tokens.length && entries.length > 0) {
    const tail = tokens.slice(tokenIndex).join(" ");
    entries[entries.length - 1] = normalizeSpacing(`${entries[entries.length - 1]} ${tail}`);
  }

  return entries.filter((entry) => entry.length > 0);
}

function extractEmails(text: string): string[] {
  return text.match(AUTHOR_EMAIL_PATTERN) ?? [];
}

function renderAuthorBlockHtml(authors: Author[]): string {
  const authorHtml = authors
    .map((author) => {
      const details = [
        `    <div class="name">${escapeHtml(author.name)}</div>`,
        ...author.affiliations.map(
          (affiliation) => `    <div class="affiliation">${escapeHtml(affiliation)}</div>`,
        ),
        author.email ? `    <div class="email">${escapeHtml(author.email)}</div>` : "",
      ]
        .filter((line) => line.length > 0)
        .join("\n");
      return `  <div class="author">\n${details}\n  </div>`;
    })
    .join("\n");

  return `<div class="authors">\n${authorHtml}\n</div>`;
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

function consumeReferenceEntryParagraph(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): ConsumedParagraph | undefined {
  const startLine = lines[startIndex];
  const startNormalized = parseParagraphMergeCandidateText(startLine, {
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
  });
  if (startNormalized === undefined) return undefined;
  if (!BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(startNormalized)) return undefined;

  const parts = [startNormalized];
  let previousLine = startLine;
  let nextIndex = startIndex + 1;

  while (nextIndex < lines.length) {
    const candidate = lines[nextIndex];
    if (!isReferenceEntryContinuationLine(
      candidate,
      previousLine,
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    )) {
      break;
    }
    const candidateText = normalizeSpacing(candidate.text);
    appendBodyParagraphPart(parts, candidateText);
    previousLine = candidate;
    nextIndex += 1;
  }

  if (parts.length <= 1) return undefined;
  return { text: normalizeSpacing(parts.join(" ")), nextIndex };
}

function isReferenceEntryContinuationLine(
  line: TextLine,
  previousLine: TextLine,
  startLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  if (line.pageIndex !== previousLine.pageIndex) return false;
  if (isCrossColumnPair(previousLine, line)) return false;
  if (line === titleLine) return false;
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return false;
  // Stop at the next reference entry
  if (BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(normalized)) return false;
  // Stop at headings
  if (detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !== undefined) {
    return false;
  }
  if (containsDocumentMetadata(normalized)) return false;
  // Font size must be similar
  if (Math.abs(line.fontSize - startLine.fontSize) > REFERENCE_ENTRY_CONTINUATION_MAX_FONT_DELTA) {
    return false;
  }
  // Vertical gap check
  const maxVerticalGap = getFontScaledVerticalGapLimit(
    previousLine.fontSize,
    REFERENCE_ENTRY_CONTINUATION_MAX_VERTICAL_GAP_RATIO,
  );
  if (!hasDescendingVerticalGapWithinLimit(previousLine, line, maxVerticalGap)) return false;
  // Horizontal alignment check
  const centerOffset = Math.abs(getLineCenter(line) - getLineCenter(previousLine));
  const leftOffset = Math.abs(line.x - startLine.x);
  if (
    centerOffset > line.pageWidth * REFERENCE_ENTRY_CONTINUATION_MAX_CENTER_OFFSET_RATIO &&
    leftOffset > line.pageWidth * REFERENCE_ENTRY_CONTINUATION_MAX_LEFT_OFFSET_RATIO
  ) {
    return false;
  }
  return true;
}

function isDisplayMathFragmentLine(
  line: TextLine,
  bodyFontSize: number,
  titleLine: TextLine | undefined,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  if (line === titleLine) return false;
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return false;
  // Reject if it's a heading, bullet, URL, or metadata
  if (containsDocumentMetadata(normalized)) return false;
  if (parseBulletListItemText(normalized) !== undefined) return false;
  if (parseStandaloneUrlLine(normalized) !== undefined) return false;
  if (detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !== undefined) {
    return false;
  }
  if (STANDALONE_CAPTION_LABEL_PATTERN.test(normalized)) return false;
  if (BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(normalized)) return false;
  // Must be short relative to page width
  if (line.estimatedWidth > line.pageWidth * DISPLAY_MATH_FRAGMENT_MAX_WIDTH_RATIO) return false;
  // Check that content looks math-like rather than natural language.
  // First reject lines containing natural-language words (4+ consecutive letters)
  // — these are prose, code, or captions, not math fragments.
  const tokens = normalized.split(/\s+/).filter((t) => t.length > 0);
  const hasLongWord = tokens.some((t) => /[A-Za-z]{4,}/.test(t));
  if (hasLongWord) return false;
  // If the line contains a math operator (=, +, -, √, ×, etc.), it's likely math
  if (DISPLAY_MATH_EQUATION_PATTERN.test(normalized)) return true;
  // Small font sub/superscript — require also narrow width to avoid matching
  // table data that happens to be slightly smaller than body text
  if (
    line.fontSize < bodyFontSize * DISPLAY_MATH_SUPERSCRIPT_MAX_FONT_RATIO &&
    line.estimatedWidth < line.pageWidth * 0.15
  ) {
    return true;
  }
  // Very short tokens (≤ 2 chars each) that look like math variables/subscripts
  if (tokens.length > 0 && tokens.every((t) => t.length <= 2)) return true;
  return false;
}

function isDisplayMathEquationLine(
  line: TextLine,
  bodyFontSize: number,
  titleLine: TextLine | undefined,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  if (line === titleLine) return false;
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return false;
  if (containsDocumentMetadata(normalized)) return false;
  if (detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !== undefined) {
    return false;
  }
  // Display equations often contain = and math notation, may be wider than fragments
  // but are typically centered and shorter than full body text
  if (line.estimatedWidth > line.pageWidth * 0.65) return false;
  return DISPLAY_MATH_EQUATION_PATTERN.test(normalized);
}

function consumeDisplayMathBlock(
  lines: TextLine[],
  startIndex: number,
  bodyFontSize: number,
  titleLine: TextLine | undefined,
  hasDottedSubsectionHeadings: boolean,
): ConsumedParagraph | undefined {
  const startLine = lines[startIndex];
  // Only a display math fragment (short, no long words) can START a block.
  // Display math equation lines (which may contain function names) can only
  // continue an existing block — they can't start one to avoid false positives.
  if (!isDisplayMathFragmentLine(startLine, bodyFontSize, titleLine, hasDottedSubsectionHeadings)) {
    return undefined;
  }

  const parts: string[] = [normalizeSpacing(startLine.text)];
  let nextIndex = startIndex + 1;
  let previousLine = startLine;

  while (nextIndex < lines.length) {
    const candidate = lines[nextIndex];
    // Must be on the same page
    if (candidate.pageIndex !== startLine.pageIndex) break;

    // Vertical gap check
    const verticalGap = previousLine.y - candidate.y;
    const maxGap = Math.max(
      previousLine.fontSize * DISPLAY_MATH_FRAGMENT_MAX_VERTICAL_GAP_RATIO,
      bodyFontSize * DISPLAY_MATH_FRAGMENT_MAX_VERTICAL_GAP_RATIO,
    );
    if (verticalGap <= 0 || verticalGap > maxGap) break;

    const candidateIsFragment = isDisplayMathFragmentLine(candidate, bodyFontSize, titleLine, hasDottedSubsectionHeadings);
    const candidateIsEquation = !candidateIsFragment && isDisplayMathEquationLine(candidate, bodyFontSize, titleLine, hasDottedSubsectionHeadings);
    if (!candidateIsFragment && !candidateIsEquation) break;

    parts.push(normalizeSpacing(candidate.text));
    previousLine = candidate;
    nextIndex += 1;
  }

  // For single-line fragments: skip (don't render) if clearly a detached sub/superscript.
  // For multi-line blocks: merge into a single paragraph.
  if (parts.length < 2) {
    const normalized = normalizeSpacing(startLine.text);
    const isSmallFont = startLine.fontSize < bodyFontSize * DISPLAY_MATH_SUPERSCRIPT_MAX_FONT_RATIO;
    const isNarrow = startLine.estimatedWidth < startLine.pageWidth * 0.12;
    const isShortText = normalized.length <= 12;
    // A single detached math artifact (subscript/superscript) that is small, narrow,
    // and short should be dropped — it's a rendering artifact from the PDF.
    if (isSmallFont && isNarrow && isShortText) {
      return { text: "", nextIndex };
    }
    return undefined;
  }

  return { text: parts.join(" "), nextIndex };
}

function consumeParagraph(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  pageTypicalWidths: Map<string, number>,
): ConsumedParagraph | undefined {
  return (
    consumeReferenceEntryParagraph(
      lines,
      startIndex,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    ) ??
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

/** Returns true when two lines belong to different columns on the same multi-column page. */
function isCrossColumnPair(a: TextLine, b: TextLine): boolean {
  if (a.column === undefined || b.column === undefined) return false;
  return a.column !== b.column;
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

const REFERENCE_LIST_MIN_ITEMS = 3;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: reference list parsing handles orphan fragments between entries.
function renderReferenceList(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): { htmlLines: string[]; nextIndex: number } | undefined {
  const startNormalized = normalizeSpacing(lines[startIndex].text);
  if (!BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(startNormalized)) return undefined;

  const items: ReferenceListItem[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const normalized = normalizeSpacing(lines[index].text);
    if (!BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(normalized)) break;

    // Start a new reference entry — collect its text and continuation lines
    const parts = [normalized];
    let nextIndex = index + 1;

    while (nextIndex < lines.length) {
      const candidate = lines[nextIndex];
      const candidateNormalized = normalizeSpacing(candidate.text);
      if (candidateNormalized.length === 0) { nextIndex += 1; continue; }
      // Stop at the next reference entry
      if (BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(candidateNormalized)) break;
      // Stop at headings
      if (detectHeadingCandidate(candidate, bodyFontSize, hasDottedSubsectionHeadings) !== undefined) break;
      if (candidate === titleLine) break;
      // Skip cross-column lines (e.g., right column content interleaved with left column references)
      if (isCrossColumnPair(lines[index], candidate)) { nextIndex += 1; continue; }
      // Stop at footnote-only markers (e.g., page numbers)
      if (FOOTNOTE_NUMERIC_MARKER_ONLY_PATTERN.test(candidateNormalized)) break;
      // Font size must be similar to the entry start
      if (Math.abs(candidate.fontSize - lines[index].fontSize) > REFERENCE_ENTRY_CONTINUATION_MAX_FONT_DELTA) break;
      appendBodyParagraphPart(parts, candidateNormalized);
      nextIndex += 1;
    }

    const itemText = normalizeSpacing(parts.join(" "));
    items.push({
      text: itemText,
      marker: parseReferenceListMarker(itemText),
      sourceOrder: items.length,
    });
    index = nextIndex;
  }

  if (items.length < REFERENCE_LIST_MIN_ITEMS) return undefined;
  const orderedItems = reorderReferenceItemsByMarkerWhenInterleaved(items);

  return {
    htmlLines: [
      "<ol>",
      ...orderedItems.map((item) => `<li>${escapeHtml(item.text)}</li>`),
      "</ol>",
    ],
    nextIndex: index,
  };
}

function parseReferenceListMarker(text: string): number | undefined {
  const match = /^\[(\d{1,4})\]/.exec(text);
  if (!match) return undefined;
  const marker = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(marker) ? marker : undefined;
}

function reorderReferenceItemsByMarkerWhenInterleaved(items: ReferenceListItem[]): ReferenceListItem[] {
  if (items.some((item) => item.marker === undefined)) return items;
  const markers = items.map((item) => item.marker ?? 0);
  if (!hasNumericReferenceOrderInversion(markers)) return items;
  if (!hasLikelySequentialReferenceRange(markers)) return items;

  return [...items].sort(
    (left, right) => (left.marker ?? 0) - (right.marker ?? 0) || left.sourceOrder - right.sourceOrder,
  );
}

function hasNumericReferenceOrderInversion(markers: number[]): boolean {
  for (let index = 1; index < markers.length; index += 1) {
    if (markers[index] < markers[index - 1]) return true;
  }
  return false;
}

function hasLikelySequentialReferenceRange(markers: number[]): boolean {
  if (markers.length === 0) return false;
  const uniqueMarkers = Array.from(new Set(markers));
  const minMarker = Math.min(...uniqueMarkers);
  const maxMarker = Math.max(...uniqueMarkers);
  const rangeSize = maxMarker - minMarker + 1;
  const missingMarkerCount = rangeSize - uniqueMarkers.length;
  return missingMarkerCount <= Math.max(3, Math.floor(uniqueMarkers.length * 0.35));
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
  if (isCrossColumnPair(previousLine, line)) return false;
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
  const maxLeftOffset = line.pageWidth * ACKNOWLEDGEMENTS_MAX_LEFT_OFFSET_RATIO;
  if (
    isCrossColumnPair(previousLine, line) &&
    Math.abs(line.x - headingLine.x) > maxLeftOffset
  ) {
    return false;
  }
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
  return (
    Math.abs(line.x - headingLine.x) <= maxLeftOffset ||
    Math.abs(line.x - previousLine.x) <= maxLeftOffset
  );
}

function renderStandaloneLinkParagraph(
  lines: TextLine[],
  startIndex: number,
): { html: string; nextIndex: number; consumedIndexes: number[] } | undefined {
  const footnoteMarker = parseStandaloneNumericFootnoteMarker(lines[startIndex].text);
  const linkStartIndex = footnoteMarker ? startIndex + 1 : startIndex;
  const standaloneLink = consumeStandaloneUrl(
    lines,
    linkStartIndex,
    footnoteMarker ? lines[startIndex] : undefined,
  );
  if (standaloneLink === undefined) return undefined;

  return {
    html: renderStandaloneLinkHtml(standaloneLink, footnoteMarker),
    nextIndex: startIndex + 1,
    consumedIndexes: footnoteMarker
      ? [linkStartIndex, ...standaloneLink.consumedIndexes]
      : standaloneLink.consumedIndexes,
  };
}

function renderStandaloneLinkHtml(
  standaloneLink: { url: string; trailingPunctuation: string },
  footnoteMarker: string | undefined,
): string {
  const escaped = escapeHtml(standaloneLink.url);
  const markerPrefix = footnoteMarker ? `${escapeHtml(footnoteMarker)} ` : "";
  return `<p>${markerPrefix}<a href="${escaped}">${escaped}</a>${escapeHtml(standaloneLink.trailingPunctuation)}</p>`;
}

function consumeStandaloneUrl(
  lines: TextLine[],
  startIndex: number,
  expectedPageLine?: TextLine,
): { url: string; trailingPunctuation: string; consumedIndexes: number[] } | undefined {
  const urlLine = lines[startIndex];
  if (!urlLine || !isSamePage(urlLine, expectedPageLine)) return undefined;
  const baseUrl = parseStandaloneUrlLine(urlLine.text);
  if (baseUrl === undefined) return undefined;

  const merged = findStandaloneUrlContinuationCandidate(
    lines,
    startIndex,
    baseUrl.url,
    urlLine,
    expectedPageLine,
  );
  const resolved = merged ?? {
    url: baseUrl.url,
    trailingPunctuation: baseUrl.trailingPunctuation,
    consumedIndexes: [],
  };
  return resolved;
}

function isSamePage(line: TextLine, referenceLine: TextLine | undefined): boolean {
  return referenceLine === undefined || line.pageIndex === referenceLine.pageIndex;
}

type UrlContinuationResult = { url: string; trailingPunctuation: string; consumedIndexes: number[] };

function findStandaloneUrlContinuationCandidate(
  lines: TextLine[],
  urlStartIndex: number,
  baseUrl: string,
  urlLine: TextLine,
  expectedPageLine: TextLine | undefined,
): UrlContinuationResult | undefined {
  const allowPathWithoutSlash = baseUrl.endsWith("-");
  if (!baseUrl.endsWith("/") && !allowPathWithoutSlash) return undefined;

  const maxVerticalGap = getFontScaledVerticalGapLimit(
    urlLine.fontSize,
    STANDALONE_URL_CONTINUATION_MAX_VERTICAL_GAP_RATIO,
  );
  const maxScanIndex = Math.min(
    lines.length,
    urlStartIndex + STANDALONE_URL_CONTINUATION_MAX_LOOKAHEAD + 1,
  );

  for (let continuationIndex = urlStartIndex + 1; continuationIndex < maxScanIndex; continuationIndex += 1) {
    const line = lines[continuationIndex];
    if (!line || !isSamePage(line, expectedPageLine) || !isSamePage(line, urlLine)) break;

    const result = tryMatchUrlContinuationLine(line, urlLine, baseUrl, maxVerticalGap, allowPathWithoutSlash, continuationIndex);
    if (result === "break") break;
    if (result !== undefined) return result;
  }

  return undefined;
}

function tryMatchUrlContinuationLine(
  line: TextLine,
  urlLine: TextLine,
  baseUrl: string,
  maxVerticalGap: number,
  allowPathWithoutSlash: boolean,
  continuationIndex: number,
): UrlContinuationResult | "break" | undefined {
  const verticalGap = urlLine.y - line.y;
  if (verticalGap > maxVerticalGap) return "break";
  if (verticalGap < 0) return undefined;
  if (parseStandaloneUrlLine(line.text) !== undefined) return "break";

  const continuation = parseUrlContinuationLine(line.text, { allowPathWithoutSlash });
  if (continuation === undefined) return undefined;
  if (!continuation.hasSlash && !isStandaloneUrlContinuationAligned(line, urlLine)) return undefined;

  const merged = `${baseUrl}${continuation.path}`;
  if (!isValidHttpUrl(merged)) return undefined;
  return {
    url: merged,
    trailingPunctuation: continuation.trailingPunctuation,
    consumedIndexes: [continuationIndex],
  };
}

function isStandaloneUrlContinuationAligned(line: TextLine, urlLine: TextLine): boolean {
  return (
    Math.abs(line.x - urlLine.x) <= line.pageWidth * STANDALONE_URL_CONTINUATION_MAX_LEFT_OFFSET_RATIO
  );
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
  options?: { allowPathWithoutSlash?: boolean },
): { path: string; trailingPunctuation: string; hasSlash: boolean } | undefined {
  const normalized = normalizeTrailingPunctuationSpacing(normalizeSpacing(text));
  const match = URL_CONTINUATION_LINE_PATTERN.exec(normalized);
  if (!match) return undefined;

  const rawPath = match[1];
  const hasSlash = rawPath.includes("/");
  if (!hasSlash && !options?.allowPathWithoutSlash) return undefined;
  if (
    !hasSlash &&
    options?.allowPathWithoutSlash &&
    !URL_NON_SLASH_CONTINUATION_FRAGMENT_PATTERN.test(rawPath)
  ) {
    return undefined;
  }

  const path = rawPath.replace(/^\/+/, "");
  if (path.length === 0) return undefined;
  return { path, trailingPunctuation: match[2] ?? "", hasSlash };
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
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: code-block extraction collects and reorders sparse candidates in one pass.
function renderNumberedCodeBlock(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): { html: string; consumedIndexes: number[] } | undefined {
  const startLine = lines[startIndex];
  const startNormalized = normalizeSpacing(startLine.text);
  const parsedStart = parseNumberedCodeLine(startNormalized);
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

  const codeCandidates: NumberedCodeBlockCandidate[] = [
    {
      index: startIndex,
      line: startLine,
      normalizedText: startNormalized,
      parsedNumberedLine: parsedStart,
    },
  ];

  const maxScanIndex = Math.min(lines.length, startIndex + NUMBERED_CODE_BLOCK_MAX_LOOKAHEAD + 1);
  for (let scanIndex = startIndex + 1; scanIndex < maxScanIndex; scanIndex += 1) {
    const candidate = lines[scanIndex];
    if (candidate.pageIndex !== startLine.pageIndex) break;
    if (
      !isNumberedCodeCandidateLine(
        candidate,
        startLine,
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
    } else {
      if (candidate.x < startLine.x + NUMBERED_CODE_BLOCK_MIN_INDENT) continue;
      if (!isLikelyCodeContinuationText(normalized)) continue;
    }

    codeCandidates.push({
      index: scanIndex,
      line: candidate,
      normalizedText: normalized,
      parsedNumberedLine: parsedCandidate,
    });
  }

  const orderedCandidates = [...codeCandidates].sort((left, right) => {
    if (left.line.y !== right.line.y) return right.line.y - left.line.y;
    return left.line.x - right.line.x;
  });

  const codeParts: string[] = [];
  const consumedIndexes: number[] = [];
  let expectedNumber: number | undefined;
  let numberedLineCount = 0;
  let previousSelectedLine: TextLine | undefined;

  for (const candidate of orderedCandidates) {
    if (previousSelectedLine !== undefined) {
      const maxVerticalGap = getFontScaledVerticalGapLimit(
        Math.max(previousSelectedLine.fontSize, candidate.line.fontSize),
        NUMBERED_CODE_BLOCK_MAX_VERTICAL_GAP_RATIO,
      );
      if (!hasDescendingVerticalGapWithinLimit(previousSelectedLine, candidate.line, maxVerticalGap)) {
        if (numberedLineCount >= NUMBERED_CODE_BLOCK_MIN_LINES) break;
        continue;
      }
    }

    if (candidate.parsedNumberedLine !== undefined) {
      if (
        expectedNumber !== undefined &&
        candidate.parsedNumberedLine.lineNumber < expectedNumber
      ) {
        continue;
      }
      if (
        expectedNumber !== undefined &&
        candidate.parsedNumberedLine.lineNumber > expectedNumber + NUMBERED_CODE_BLOCK_MAX_NUMBER_GAP
      ) {
        if (numberedLineCount >= NUMBERED_CODE_BLOCK_MIN_LINES) break;
        continue;
      }
      expectedNumber = candidate.parsedNumberedLine.lineNumber + 1;
      numberedLineCount += 1;
      codeParts.push(candidate.normalizedText);
      consumedIndexes.push(candidate.index);
      previousSelectedLine = candidate.line;
      continue;
    }

    if (numberedLineCount === 0) continue;
    codeParts.push(candidate.normalizedText);
    consumedIndexes.push(candidate.index);
    previousSelectedLine = candidate.line;
  }

  if (numberedLineCount < NUMBERED_CODE_BLOCK_MIN_LINES) return undefined;
  if (!consumedIndexes.includes(startIndex)) return undefined;
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

function isNumberedCodeCandidateLine(
  line: TextLine,
  startLine: TextLine,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  if (line.pageIndex !== startLine.pageIndex) return false;
  if (line.fontSize > bodyFontSize * NUMBERED_CODE_BLOCK_MAX_FONT_RATIO) return false;
  if (Math.abs(line.fontSize - startLine.fontSize) > NUMBERED_CODE_BLOCK_MAX_FONT_DELTA) return false;
  if (!isAlignedWithNumberedCodeColumn(line, startLine)) return false;
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return false;
  if (containsDocumentMetadata(normalized)) return false;
  if (detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !== undefined) {
    return false;
  }
  return true;
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

function typicalWidthKey(pageIndex: number, column?: "left" | "right"): string {
  return column ? `${pageIndex}:${column}` : `${pageIndex}`;
}

const COLUMN_WIDTH_SIGNIFICANT_REDUCTION_RATIO = 0.90;

function getTypicalWidth(
  pageTypicalWidths: Map<string, number>,
  line: TextLine,
): number | undefined {
  const pageWidth = pageTypicalWidths.get(typicalWidthKey(line.pageIndex));
  // Use column-specific typical width only when it is significantly lower
  // than the page-wide width (indicating a genuine narrower column).
  // When both are similar, page-wide is more stable for merge decisions.
  if (line.column) {
    const colWidth = pageTypicalWidths.get(typicalWidthKey(line.pageIndex, line.column));
    if (colWidth !== undefined && pageWidth !== undefined) {
      if (colWidth < pageWidth * COLUMN_WIDTH_SIGNIFICANT_REDUCTION_RATIO) {
        return colWidth;
      }
    } else if (colWidth !== undefined) {
      return colWidth;
    }
  }
  return pageWidth;
}

const MIN_COLUMN_BODY_LINES_FOR_COLUMN_WIDTH = 5;

function widthPercentile(widths: number[]): number {
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length * BODY_PARAGRAPH_TYPICAL_WIDTH_PERCENTILE)];
}

function appendToMapBucket<K>(map: Map<K, number[]>, key: K, value: number): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function computePageTypicalBodyWidths(lines: TextLine[], bodyFontSize: number): Map<string, number> {
  const pageWidths = new Map<number, number[]>();
  const colWidths = new Map<string, number[]>();
  for (const line of lines) {
    if (Math.abs(line.fontSize - bodyFontSize) > 1.0) continue;
    if (normalizeSpacing(line.text).length < 20) continue;
    appendToMapBucket(pageWidths, line.pageIndex, line.estimatedWidth);
    if (line.column) {
      appendToMapBucket(colWidths, typicalWidthKey(line.pageIndex, line.column), line.estimatedWidth);
    }
  }
  const result = new Map<string, number>();
  for (const [pageIndex, widths] of pageWidths) {
    if (widths.length < 5) continue;
    result.set(typicalWidthKey(pageIndex), widthPercentile(widths));
  }
  // Store column-specific typical widths only when BOTH columns on the same
  // page have enough body-text lines.  This prevents false column detection
  // (e.g. figures on single-column pages) from producing misleading widths.
  for (const [pageIndex] of pageWidths) {
    const leftWidths = colWidths.get(typicalWidthKey(pageIndex, "left"));
    const rightWidths = colWidths.get(typicalWidthKey(pageIndex, "right"));
    if (
      leftWidths && leftWidths.length >= MIN_COLUMN_BODY_LINES_FOR_COLUMN_WIDTH &&
      rightWidths && rightWidths.length >= MIN_COLUMN_BODY_LINES_FOR_COLUMN_WIDTH
    ) {
      result.set(typicalWidthKey(pageIndex, "left"), widthPercentile(leftWidths));
      result.set(typicalWidthKey(pageIndex, "right"), widthPercentile(rightWidths));
    }
  }
  return result;
}

const LOCAL_FONT_SIZE_TYPICAL_WIDTH_MIN_LINES = 8;
const LOCAL_FONT_SIZE_MAX_DELTA = 0.5;

function computeLocalFontSizeTypicalWidth(
  lines: TextLine[],
  referenceLine: TextLine,
): number | undefined {
  const widths: number[] = [];
  for (const line of lines) {
    if (line.pageIndex !== referenceLine.pageIndex) continue;
    if (Math.abs(line.fontSize - referenceLine.fontSize) > LOCAL_FONT_SIZE_MAX_DELTA) continue;
    if (normalizeSpacing(line.text).length < 20) continue;
    widths.push(line.estimatedWidth);
  }
  if (widths.length < LOCAL_FONT_SIZE_TYPICAL_WIDTH_MIN_LINES) return undefined;
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length * BODY_PARAGRAPH_TYPICAL_WIDTH_PERCENTILE)];
}

const LOCAL_COLUMN_REGION_MIN_LINES = 5;
const LOCAL_COLUMN_REGION_MAX_X_DELTA = 12;
const LOCAL_COLUMN_REGION_MAX_Y_DELTA_FONT_RATIO = 18;
const LOCAL_COLUMN_REGION_MIN_Y_DELTA = 120;

/**
 * Compute a typical width from same-column lines sharing a similar left margin.
 * This handles cases where a column has sub-regions with different text widths
 * (e.g. text next to a figure or abstract box is narrower than full-column text).
 */
function computeLocalColumnRegionTypicalWidth(
  lines: TextLine[],
  referenceLine: TextLine,
  bodyFontSize: number,
): number | undefined {
  if (!referenceLine.column) return undefined;
  const maxYDelta = Math.max(
    referenceLine.fontSize * LOCAL_COLUMN_REGION_MAX_Y_DELTA_FONT_RATIO,
    LOCAL_COLUMN_REGION_MIN_Y_DELTA,
  );
  const widths: number[] = [];
  for (const line of lines) {
    if (line.pageIndex !== referenceLine.pageIndex) continue;
    if (line.column !== referenceLine.column) continue;
    if (Math.abs(line.fontSize - bodyFontSize) > 1.0) continue;
    if (normalizeSpacing(line.text).length < 20) continue;
    if (Math.abs(line.x - referenceLine.x) > LOCAL_COLUMN_REGION_MAX_X_DELTA) continue;
    if (Math.abs(line.y - referenceLine.y) > maxYDelta) continue;
    widths.push(line.estimatedWidth);
  }
  if (widths.length < LOCAL_COLUMN_REGION_MIN_LINES) return undefined;
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length * BODY_PARAGRAPH_TYPICAL_WIDTH_PERCENTILE)];
}

function consumeBodyParagraph(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  pageTypicalWidths: Map<string, number>,
): { text: string; nextIndex: number } | undefined {
  const startLine = lines[startIndex];
  let typicalWidth = getTypicalWidth(pageTypicalWidths, startLine);
  if (typicalWidth === undefined) return undefined;
  // When the start line's font size differs from body font, compute a local
  // typical width from same-font-size lines on the same page so that
  // narrower text blocks (e.g. abstracts) can qualify as full-width leads.
  if (Math.abs(startLine.fontSize - bodyFontSize) > 1.0) {
    const localTypical = computeLocalFontSizeTypicalWidth(lines, startLine);
    if (localTypical !== undefined) typicalWidth = localTypical;
  }
  // On multi-column pages, local figure-adjacent regions can be much narrower
  // than the page-wide column width. Prefer a nearby local width when available.
  if (
    startLine.column &&
    pageTypicalWidths.has(typicalWidthKey(startLine.pageIndex, startLine.column))
  ) {
    const localColTypical = computeLocalColumnRegionTypicalWidth(lines, startLine, bodyFontSize);
    if (localColTypical !== undefined && localColTypical < typicalWidth) {
      typicalWidth = localColTypical;
    }
  }

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
  if (
    startLine.estimatedWidth >=
      typicalWidth * BODY_PARAGRAPH_INLINE_MATH_ARTIFACT_LEAD_MIN_WIDTH_RATIO &&
    findBodyParagraphContinuationAfterInlineMathArtifacts(
      lines,
      startIndex + 1,
      startLine,
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    ) !== undefined
  ) {
    return true;
  }
  if (
    isIndentedBodyParagraphLead(
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

function isIndentedBodyParagraphLead(
  lines: TextLine[],
  startIndex: number,
  startLine: TextLine,
  startNormalized: string,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  typicalWidth: number,
): boolean {
  if (startLine.estimatedWidth < typicalWidth * BODY_PARAGRAPH_INDENT_LEAD_MIN_WIDTH_RATIO) {
    return false;
  }
  if (!BODY_PARAGRAPH_INDENT_LEAD_START_PATTERN.test(startNormalized)) return false;
  if (splitWords(startNormalized).length < BODY_PARAGRAPH_INDENT_LEAD_MIN_WORD_COUNT) {
    return false;
  }

  const previousLine = lines[startIndex - 1];
  if (!previousLine || previousLine.pageIndex !== startLine.pageIndex) return false;
  const previousText = normalizeSpacing(previousLine.text);
  if (!INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(previousText)) return false;

  const continuation = lines[startIndex + 1];
  if (!continuation || continuation.pageIndex !== startLine.pageIndex) return false;
  if (isCrossColumnPair(startLine, continuation)) return false;

  const minIndent = startLine.pageWidth * BODY_PARAGRAPH_INDENT_LEAD_MIN_X_OFFSET_RATIO;
  const maxIndent = startLine.pageWidth * BODY_PARAGRAPH_INDENT_LEAD_MAX_X_OFFSET_RATIO;
  const indentOffset = startLine.x - continuation.x;
  if (indentOffset < minIndent || indentOffset > maxIndent) return false;

  return isBodyParagraphContinuationLine(
    continuation,
    startLine,
    startLine,
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: paragraph continuation collects multiple merge types in one pass.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: paragraph continuation collects multiple merge types in one pass.
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
    const inlineMathBridge = findBodyParagraphContinuationAfterInlineMathArtifacts(
      lines,
      nextIndex,
      previousLine,
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    );
    if (inlineMathBridge !== undefined) {
      const shouldDropLeadingNumericMarkers =
        previousLine === startLine &&
        startLine.estimatedWidth < typicalWidth * BODY_PARAGRAPH_FULL_WIDTH_RATIO &&
        startLine.estimatedWidth >=
          typicalWidth * BODY_PARAGRAPH_INLINE_MATH_ARTIFACT_LEAD_MIN_WIDTH_RATIO;
      for (const artifactText of inlineMathBridge.artifactTexts) {
        if (
          shouldDropLeadingNumericMarkers &&
          INLINE_MATH_BRIDGE_LEADING_NUMERIC_MARKER_PATTERN.test(artifactText)
        ) {
          continue;
        }
        appendBodyParagraphPart(parts, artifactText);
      }
      nextIndex = inlineMathBridge.continuationIndex;
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
    if (sameRowContinuation !== undefined) {
      parts.push(sameRowContinuation.text);
      previousLine = sameRowContinuation.line;
      nextIndex = sameRowContinuation.nextIndex;
      continue;
    }
    if (shouldContinuePastShortBodyLine(
      candidate,
      lines,
      nextIndex,
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    )) {
      continue;
    }
    break;
  }

  return nextIndex;
}

function shouldContinuePastShortBodyLine(
  currentLine: TextLine,
  lines: TextLine[],
  nextIndex: number,
  startLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  if (INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(normalizeSpacing(currentLine.text))) {
    return false;
  }
  const nextLine = lines[nextIndex];
  if (!nextLine) return false;
  if (
    isBodyParagraphContinuationLine(
      nextLine,
      currentLine,
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    )
  ) {
    return true;
  }
  return (
    findBodyParagraphContinuationAfterInlineMathArtifacts(
      lines,
      nextIndex,
      currentLine,
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    ) !== undefined
  );
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
): { continuationIndex: number; artifactTexts: string[] } | undefined {
  const previousText = normalizeSpacing(previousLine.text);
  if (INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(previousText)) return undefined;

  let scanIndex = artifactStartIndex;
  const artifactTexts: string[] = [];
  const maxScanIndex = Math.min(lines.length, artifactStartIndex + INLINE_MATH_BRIDGE_MAX_LOOKAHEAD);
  while (scanIndex < maxScanIndex) {
    const artifact = lines[scanIndex];
    const artifactBridge = analyzeInlineMathArtifactBridgeLine(artifact, previousLine);
    if (!artifactBridge) return undefined;
    if (artifactBridge.artifactText !== undefined) artifactTexts.push(artifactBridge.artifactText);

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
      return { continuationIndex, artifactTexts };
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

  if (!hasPositiveInlineMathBridgeVerticalGap(line, previousLine)) return false;
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

type InlineMathArtifactBridgeKind =
  | "detachedSingleToken"
  | "numericOrSymbol"
  | "lowercaseSubscript";

function analyzeInlineMathArtifactBridgeLine(
  line: TextLine,
  previousLine: TextLine,
): { artifactText: string | undefined } | undefined {
  if (line.pageIndex !== previousLine.pageIndex) return undefined;
  const parsed = parseInlineMathArtifactBridgeTextParts(line);
  if (!parsed) return undefined;
  if (!hasPositiveInlineMathBridgeVerticalGap(line, previousLine)) return undefined;
  const bridgeKind = classifyInlineMathArtifactBridgeKind(parsed.tokens, line, previousLine);
  if (!bridgeKind) return undefined;
  return {
    artifactText: toInlineMathArtifactBridgeText(bridgeKind, parsed.normalized, parsed.tokens),
  };
}

function hasPositiveInlineMathBridgeVerticalGap(
  line: TextLine,
  previousLine: TextLine,
): boolean {
  const verticalGap = previousLine.y - line.y;
  const maxVerticalGap = Math.max(previousLine.fontSize * INLINE_MATH_BRIDGE_MAX_VERTICAL_GAP_RATIO, 3);
  return verticalGap > 0 && verticalGap <= maxVerticalGap;
}

function parseInlineMathArtifactBridgeTextParts(
  line: TextLine,
): { normalized: string; tokens: string[] } | undefined {
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0 || normalized.length > INLINE_MATH_BRIDGE_MAX_TEXT_LENGTH) return undefined;
  if (!INLINE_MATH_BRIDGE_ALLOWED_CHARS_PATTERN.test(normalized)) return undefined;

  const tokens = normalized.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0 || tokens.length > INLINE_MATH_BRIDGE_MAX_TOKEN_COUNT) return undefined;
  return { normalized, tokens };
}

function classifyInlineMathArtifactBridgeKind(
  tokens: string[],
  line: TextLine,
  previousLine: TextLine,
): InlineMathArtifactBridgeKind | undefined {
  const isDetachedSingleTokenArtifact = isDetachedSingleTokenInlineMathArtifact(
    tokens,
    line,
    previousLine,
  );
  if (
    !isDetachedSingleTokenArtifact &&
    line.estimatedWidth > previousLine.estimatedWidth * INLINE_MATH_BRIDGE_MAX_WIDTH_RATIO
  ) {
    return undefined;
  }
  if (isDetachedSingleTokenArtifact) return "detachedSingleToken";

  const hasNumericOrSymbol = tokens.some(
    (token) =>
      INLINE_MATH_BRIDGE_NUMERIC_TOKEN_PATTERN.test(token) ||
      INLINE_MATH_BRIDGE_SYMBOL_TOKEN_PATTERN.test(token),
  );
  if (!hasNumericOrSymbol) {
    return isLowercaseSubscriptBridgeTokenLine(tokens, line, previousLine)
      ? "lowercaseSubscript"
      : undefined;
  }

  const hasValidNumericOrSymbolTokens = tokens.every(
    (token) =>
      INLINE_MATH_BRIDGE_NUMERIC_TOKEN_PATTERN.test(token) ||
      INLINE_MATH_BRIDGE_SYMBOL_TOKEN_PATTERN.test(token) ||
      INLINE_MATH_BRIDGE_VARIABLE_TOKEN_PATTERN.test(token),
  );
  return hasValidNumericOrSymbolTokens ? "numericOrSymbol" : undefined;
}

function toInlineMathArtifactBridgeText(
  kind: InlineMathArtifactBridgeKind,
  normalized: string,
  tokens: string[],
): string | undefined {
  if (kind !== "lowercaseSubscript") return normalized;
  if (tokens.every((token) => INLINE_MATH_BRIDGE_APPENDABLE_LOWERCASE_TOKEN_PATTERN.test(token))) {
    return normalized;
  }
  return undefined;
}

function isDetachedSingleTokenInlineMathArtifact(
  tokens: string[],
  line: TextLine,
  previousLine: TextLine,
): boolean {
  if (tokens.length !== 1) return false;
  const token = tokens[0];
  if (!token || !INLINE_MATH_BRIDGE_DETACHED_SINGLE_TOKEN_PATTERN.test(token)) return false;
  if (line.fontSize > previousLine.fontSize * INLINE_MATH_BRIDGE_DETACHED_SINGLE_TOKEN_MAX_FONT_RATIO) {
    return false;
  }
  return (
    line.estimatedWidth <= line.pageWidth * INLINE_MATH_BRIDGE_DETACHED_SINGLE_TOKEN_MAX_WIDTH_RATIO
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
  // Prevent merging lines from different columns on multi-column pages
  if (isCrossColumnPair(previousLine, line)) return false;

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
