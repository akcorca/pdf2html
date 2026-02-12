// biome-ignore lint/nursery/noExcessiveLinesPerFile: HTML rendering heuristics are intentionally grouped.
import type { ExtractedDocument, TextLine } from "./pdf-types.ts";
import {
  estimateBodyFontSize,
  normalizeSpacing,
  splitWords,
} from "./text-lines.ts";
import { containsDocumentMetadata, findTitleLine } from "./title-detect.ts";
import {
  detectNamedSectionHeadingLevel,
  detectNumberedHeadingLevel,
  type NamedHeading,
} from "./heading-detect.ts";
import { parseLeadingNumericMarker } from "./string-utils.ts";
import { detectTable, renderTableHtml } from "./table-detect.ts";

const INLINE_ACKNOWLEDGEMENTS_HEADING_PATTERN =
  /^(acknowledg(?:e)?ments?)(?:(?:\s*[:\-–]\s*)|\s+)(.+)$/iu;
const INLINE_ACKNOWLEDGEMENTS_MIN_BODY_LENGTH = 8;
const INLINE_NAMED_SECTION_HEADING_PATTERN = /^(.+?)(\s*[:\-–]\s*)(.+)$/u;
const INLINE_NAMED_SECTION_HEADING_MIN_BODY_LENGTH = 8;
const INLINE_GENERIC_SUBSECTION_HEADING_MIN_LENGTH = 8;
const INLINE_GENERIC_SUBSECTION_HEADING_MAX_LENGTH = 64;
const INLINE_GENERIC_SUBSECTION_HEADING_MIN_WORDS = 2;
const INLINE_GENERIC_SUBSECTION_HEADING_MAX_WORDS = 10;
const INLINE_GENERIC_SUBSECTION_HEADING_MIN_ALPHA_WORDS = 2;
const INLINE_GENERIC_SUBSECTION_HEADING_MIN_MEANINGFUL_WORDS = 2;
const INLINE_GENERIC_SUBSECTION_HEADING_MIN_TITLE_CASE_RATIO = 0.65;
const INLINE_GENERIC_SUBSECTION_HEADING_DISALLOWED_PUNCTUATION_PATTERN =
  /[,;!?()[\]{}<>]/u;
const INLINE_GENERIC_SUBSECTION_HEADING_TERMINAL_PUNCTUATION_PATTERN =
  /[.!?]["')\]]?$/u;
const INLINE_GENERIC_SUBSECTION_HEADING_CONNECTOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);
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
const MAX_NUMBERED_HEADING_CONTINUATION_WORDS = 8;
const NUMBERED_HEADING_CONTINUATION_MAX_LOOKAHEAD = 16;
const NUMBERED_HEADING_CONTINUATION_MAX_FONT_DELTA = 0.7;
const NUMBERED_HEADING_CONTINUATION_MAX_LEFT_OFFSET_RATIO = 0.05;
const NUMBERED_HEADING_CONTINUATION_MAX_CENTER_OFFSET_RATIO = 0.12;
const NUMBERED_HEADING_CONTINUATION_MAX_VERTICAL_GAP_RATIO = 2.6;
const MIN_TOP_LEVEL_DOTTED_HEADING_FONT_RATIO = 1.05;
const TOP_LEVEL_DOTTED_HEADING_PATTERN = /^\d+\.\s+/;
const DOTTED_SUBSECTION_HEADING_PATTERN = /^\d+\.\d+(?:\.\d+){0,3}\.\s+/;
const BACK_MATTER_NAMED_HEADING_LEVEL = 2;
const BACK_MATTER_NAMED_HEADING_TEXTS = new Set([
  "credit authorship contribution statement",
  "declaration of competing interest",
  "declaration of competing interests",
  "ethical approval",
]);
const BACK_MATTER_APPENDIX_SECTION_HEADING_PATTERN =
  /^appendix(?:es)?(?:\s+[A-Z0-9]+(?:\.[A-Z0-9]+)?)?(?:[.:]\s+(?:supplementary|additional|online)\s+(?:data|material|materials|information))?$/iu;
const REFERENCES_HEADING_TEXT = "references";
const POST_REFERENCES_UNNUMBERED_HEADING_LEVEL = 2;
const POST_REFERENCES_UNNUMBERED_HEADING_MIN_FONT_RATIO = 0.98;
const POST_REFERENCES_UNNUMBERED_HEADING_MAX_FONT_RATIO = 1.45;
const POST_REFERENCES_UNNUMBERED_HEADING_MIN_TOP_RATIO = 0.78;
const POST_REFERENCES_UNNUMBERED_HEADING_MAX_WIDTH_RATIO = 0.62;
const POST_REFERENCES_UNNUMBERED_HEADING_MIN_WORDS = 2;
const POST_REFERENCES_UNNUMBERED_HEADING_MAX_WORDS = 8;
const POST_REFERENCES_UNNUMBERED_HEADING_MIN_ALPHA_WORDS = 2;
const POST_REFERENCES_UNNUMBERED_HEADING_MIN_TITLE_CASE_RATIO = 0.75;
const POST_REFERENCES_UNNUMBERED_HEADING_MIN_ALPHA_CHAR_RATIO = 0.8;
const POST_REFERENCES_UNNUMBERED_HEADING_DISALLOWED_PUNCTUATION_PATTERN =
  /[,;:()[\]{}<>]/u;
const POST_REFERENCES_UNNUMBERED_HEADING_TERMINAL_PUNCTUATION_PATTERN =
  /[.!?]["')\]]?$/;
const STANDALONE_URL_LINE_PATTERN =
  /^(?:(\d+)\s+)?(https?:\/\/[^\s]+?)([.,;:!?])?$/iu;
const URL_CONTINUATION_LINE_PATTERN =
  /^([A-Za-z0-9._~!$&'()*+,;=:@%/-]+?)([.,;:!?])?$/u;
const URL_NON_SLASH_CONTINUATION_FRAGMENT_PATTERN = /[-._~%=&]|\d/u;
const STANDALONE_URL_CONTINUATION_MAX_LOOKAHEAD = 4;
const STANDALONE_URL_CONTINUATION_MAX_LEFT_OFFSET_RATIO = 0.08;
const STANDALONE_URL_CONTINUATION_MAX_VERTICAL_GAP_RATIO = 3.2;
const FOOTNOTE_NUMERIC_MARKER_ONLY_PATTERN = /^\(?\d{1,2}\)?[.)]?$/u;
const STANDALONE_ACKNOWLEDGEMENTS_HEADING_PATTERN =
  /^acknowledg(?:e)?ments?$/iu;
const ACKNOWLEDGEMENTS_CONTINUATION_START_PATTERN = /^[a-z(“‘"']/u;
const ACKNOWLEDGEMENTS_MAX_FONT_DELTA = 0.8;
const ACKNOWLEDGEMENTS_MAX_LEFT_OFFSET_RATIO = 0.06;
const ACKNOWLEDGEMENTS_MAX_VERTICAL_GAP_RATIO = 2.8;
const HYPHEN_WRAPPED_LINE_PATTERN = /[A-Za-z]\s*-$/;
const HYPHEN_WRAP_CONTINUATION_START_PATTERN = /^[A-Za-z]/;
const HYPHEN_WRAP_MAX_VERTICAL_GAP_RATIO = 2.8;
const HYPHEN_WRAP_MAX_LEFT_OFFSET_RATIO = 0.08;
const HYPHEN_WRAP_MAX_CENTER_OFFSET_RATIO = 0.12;
const HYPHEN_WRAP_MIN_LINE_WIDTH_RATIO = 0.4;
const HYPHEN_WRAP_MIN_CONTINUATION_WIDTH_RATIO = 0.45;
// Common soft-wrap continuations split before derivational endings.
const HYPHEN_WRAP_SOFT_CONTINUATION_FRAGMENT_PATTERN =
  /^(?:tion(?:al(?:ly)?|s)?|sion(?:al(?:ly)?|s)?|mation|nition|plicat(?:ion|ions|ive)|iz(?:ation|ations|ing|ed|es|e)|icant(?:ly)?|entist(?:s)?|olution(?:ize|ized|izing|ary|aries|s)?|derstand(?:ing|s)?|volv(?:e|es|ed|ing)|tive(?:ly|s)?|guage|duce|[a-z]{1,4}ingly)/u;
const HYPHEN_WRAP_SOFT_CONTINUATION_MIN_FRAGMENT_LENGTH = 3;
const HYPHEN_WRAP_SOFT_SHORT_CONTINUATION_MAX_LENGTH = 3;
const REFERENCE_IN_WORD_HYPHEN_PATTERN =
  /\b([A-Za-z]{1,30})-([A-Za-z]{2,30})\b/g;
const REFERENCE_IN_WORD_HYPHEN_SHORT_LEFT_PREFIXES = new Set([
  "a",
  "co",
  "de",
  "e",
  "in",
  "of",
  "on",
  "re",
  "to",
  "x",
]);
const REFERENCE_IN_WORD_HYPHEN_RIGHT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "in",
  "of",
  "off",
  "on",
  "or",
  "the",
  "to",
  "up",
  "via",
]);
const REFERENCE_IN_WORD_HYPHEN_SHORT_RIGHT_VOWEL_PATTERN = /[aeiouy]/i;
const SAME_ROW_SENTENCE_SPLIT_END_PATTERN = /[.!?]["')\]]?$/;
const SAME_ROW_SENTENCE_CONTINUATION_START_PATTERN = /^[A-Z0-9(“‘"']/u;
const SAME_ROW_SENTENCE_SPLIT_MAX_VERTICAL_DELTA_FONT_RATIO = 0.2;
const SAME_ROW_SENTENCE_SPLIT_MAX_FONT_DELTA = 0.7;
const SAME_ROW_SENTENCE_SPLIT_MAX_GAP_FONT_RATIO = 4.0;
const SAME_ROW_SENTENCE_SPLIT_MAX_OVERLAP_FONT_RATIO = 6.0;
const SAME_ROW_SENTENCE_SPLIT_MAX_START_WIDTH_RATIO = 0.45;
const STANDALONE_CAPTION_LABEL_PATTERN =
  /^(?:Figure|Fig\.?|Table|Algorithm|Eq(?:uation)?\.?)\s+\d+[A-Za-z]?[.:]?$/iu;
const CAPTION_START_PATTERN = /^(?:Figure|Fig\.?)\s+\d+[A-Za-z]?\s*[.:]\s+\S/iu;
const RENDERED_PARAGRAPH_HARD_BREAK_END_PATTERN = /[:;]["')\]]?$/u;
const RENDERED_PARAGRAPH_TERMINAL_PUNCTUATION_END_PATTERN = /[.!?]["')\]]?$/u;
const RENDERED_PARAGRAPH_SOFT_CONNECTOR_END_PATTERN =
  /\b(?:and|or|of|to|in|on|for|with|by|from|as|at|into|onto|via|than|that|which|whose|where|when|while|if|because)\s*$/iu;
const RENDERED_PARAGRAPH_SOFT_DETERMINER_PHRASE_END_PATTERN =
  /\b(?:the|a|an)\s+\p{L}{2,}\s*$/iu;
const RENDERED_PARAGRAPH_CONTINUATION_CONNECTOR_START_PATTERN =
  /^(?:and|or|with|without|to|for|from|in|on|at|by|of|as|that|which|whose|where|when|while|if)\b/iu;
const RENDERED_PARAGRAPH_ACRONYM_CONTINUATION_START_PATTERN =
  /^[("“‘'\[]?[A-Z]{2,}[A-Z0-9]*(?:[-/][A-Z0-9]+)*(?:['’]s|s)?\b/u;
const RENDERED_PARAGRAPH_ACRONYM_LEAD_MAX_WORD_COUNT = 16;
const RENDERED_PARAGRAPH_ACRONYM_LEAD_MAX_CHAR_LENGTH = 120;
const RENDERED_PARAGRAPH_MERGE_MIN_PREVIOUS_WORD_COUNT = 4;
const RENDERED_PARAGRAPH_MERGE_MIN_CONTINUATION_WORD_COUNT = 2;
const RENDERED_PARAGRAPH_INLINE_MATH_ARTIFACT_TOKEN_PATTERN = /^[A-Z]{1,3}$/;
const RENDERED_PARAGRAPH_INLINE_MATH_ARTIFACT_MIN_TOKEN_COUNT = 3;
const RENDERED_PARAGRAPH_INLINE_MATH_ARTIFACT_MAX_TOKEN_COUNT = 6;
const RENDERED_PARAGRAPH_DANGLING_PARENTHETICAL_BRIDGE_PATTERN =
  /^\([^)]*$/u;
const RENDERED_PARAGRAPH_DANGLING_PARENTHETICAL_BRIDGE_MAX_WORD_COUNT = 4;
const RENDERED_PARAGRAPH_DANGLING_PARENTHETICAL_BRIDGE_MAX_CHAR_LENGTH = 40;
const RENDERED_PARAGRAPH_DANGLING_PARENTHETICAL_CLOSING_START_PATTERN =
  /^["'“‘]?[^\s)]+\)/u;
const RENDERED_TRAILING_URL_PREFIX_PATTERN =
  /^(.*?)(https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]*[./-])$/iu;
const CAPTION_CONTINUATION_MAX_VERTICAL_GAP_RATIO = 2.0;
const CAPTION_CONTINUATION_MAX_FONT_DELTA = 0.8;
const CAPTION_CONTINUATION_MAX_LEFT_OFFSET_RATIO = 0.05;
const CAPTION_SAME_ROW_CONTINUATION_MAX_VERTICAL_DELTA_FONT_RATIO = 0.25;
const CAPTION_SAME_ROW_CONTINUATION_MAX_HORIZONTAL_GAP_RATIO = 0.08;
const CAPTION_SAME_ROW_CONTINUATION_MAX_OVERLAP_RATIO = 0.05;
const CAPTION_DETACHED_INLINE_MARKER_MAX_FONT_RATIO = 0.82;
const CAPTION_DETACHED_INLINE_MARKER_MAX_WIDTH_RATIO = 0.12;
const CAPTION_DETACHED_INLINE_MARKER_MAX_TOKEN_COUNT = 3;
const CAPTION_DETACHED_INLINE_MARKER_MAX_TOKEN_LENGTH = 2;
const CAPTION_DETACHED_INLINE_MARKER_TOKEN_PATTERN = /^[A-Za-z0-9]+$/u;
const FIGURE_PANEL_LABEL_LOOKAHEAD = 8;
const FIGURE_PANEL_LABEL_MAX_WIDTH_RATIO = 0.55;
const FIGURE_PANEL_LABEL_MIN_WORDS = 3;
const FIGURE_PANEL_LABEL_MAX_WORDS = 12;
const FIGURE_PANEL_LABEL_MIN_ALPHA_WORDS = 3;
const FIGURE_PANEL_LABEL_MIN_TITLE_CASE_WORD_RATIO = 0.6;
const FIGURE_PANEL_LABEL_MIN_CAPTION_GAP_FONT_RATIO = 4.5;
const FIGURE_PANEL_LABEL_TERMINAL_PUNCTUATION_PATTERN = /[.!?:;]["')\]]?$/;
const FIGURE_PANEL_LABEL_TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const FIGURE_PANEL_LABEL_MIN_TOKEN_COVERAGE = 0.8;
const FIGURE_PANEL_LABEL_MIN_DISTINCTIVE_TOKENS = 2;
const FIGURE_PANEL_LABEL_DISTINCTIVE_TOKEN_MIN_LENGTH = 4;
const FIGURE_CAPTION_NEARBY_MAX_SCAN_LINES = 64;
const FIGURE_DIAGRAM_FLOW_LABEL_MAX_WORDS = 8;
const FIGURE_DIAGRAM_FLOW_LABEL_MAX_WIDTH_RATIO = 0.22;
const FIGURE_DIAGRAM_FLOW_LABEL_MAX_FONT_RATIO = 0.8;
const FIGURE_DIAGRAM_NUMERIC_MARKER_PATTERN = /^\d{1,2}$/u;
const FIGURE_DIAGRAM_NUMERIC_MARKER_MAX_WIDTH_RATIO = 0.03;
const FIGURE_DIAGRAM_MIN_CAPTION_VERTICAL_GAP_RATIO = 2.2;
const FIGURE_DIAGRAM_AXIS_LABEL_PATTERN = /\b[A-Za-z]\s*[–-]\s*[A-Za-z]\b/u;
const FIGURE_DIAGRAM_AXIS_LABEL_MIN_WORDS = 4;
const FIGURE_DIAGRAM_AXIS_LABEL_MAX_WORDS = 10;
const FIGURE_DIAGRAM_AXIS_LABEL_MAX_WIDTH_RATIO = 0.3;
const FIGURE_DIAGRAM_AXIS_LABEL_MAX_FONT_RATIO = 0.95;
const FIGURE_DIAGRAM_AXIS_LABEL_MAX_CAPTION_DISTANCE = 120;
const FIGURE_DIAGRAM_AXIS_LABEL_MAX_CAPTION_DISTANCE_FONT_RATIO = 16;
const FIGURE_PANEL_LABEL_STOP_TOKENS = new Set([
  "figure",
  "fig",
  "table",
  "left",
  "right",
  "top",
  "bottom",
  "panel",
  "panels",
  "and",
  "or",
]);
const BODY_PARAGRAPH_FULL_WIDTH_RATIO = 0.85;
const BODY_PARAGRAPH_TYPICAL_WIDTH_PERCENTILE = 0.75;
const BODY_PARAGRAPH_MAX_VERTICAL_GAP_RATIO = 2.2;
const BODY_PARAGRAPH_MAX_FONT_DELTA = 0.8;
const BODY_PARAGRAPH_MAX_LEFT_OFFSET_RATIO = 0.2;
const BODY_PARAGRAPH_MAX_CENTER_OFFSET_RATIO = 0.2;
const BODY_PARAGRAPH_CONTINUATION_START_PATTERN = /^[\p{L}\p{N}<("''[]/u;
const BODY_PARAGRAPH_PAGE_WRAP_CONTINUATION_START_PATTERN =
  /^[\p{Ll}\p{N}<(“‘"'[]/u;
const BODY_PARAGRAPH_PAGE_WRAP_PREVIOUS_BOTTOM_MAX_RATIO = 0.2;
const BODY_PARAGRAPH_PAGE_WRAP_NEXT_TOP_MIN_RATIO = 0.72;
const BODY_PARAGRAPH_PAGE_WRAP_MAX_LEFT_OFFSET_RATIO = 0.06;
const BODY_PARAGRAPH_PAGE_WRAP_MAX_CENTER_OFFSET_RATIO = 0.14;
const BODY_PARAGRAPH_PAGE_WRAP_INTERPOSED_MAX_LOOKAHEAD = 10;
const BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN = /^\[\d+\]/;
const REFERENCE_ENTRY_CONTINUATION_MAX_VERTICAL_GAP_RATIO = 2.8;
const REFERENCE_ENTRY_CONTINUATION_MAX_FONT_DELTA = 0.8;
const REFERENCE_ENTRY_CONTINUATION_MAX_LEFT_OFFSET_RATIO = 0.08;
const REFERENCE_ENTRY_CONTINUATION_MAX_CENTER_OFFSET_RATIO = 0.12;
const BODY_PARAGRAPH_CITATION_CONTINUATION_PATTERN =
  /^\[\d+(?:\s*,\s*\d+)*\]\s*[,;:]\s+[A-Za-z(“‘"']/u;
const RESEARCH_IN_CONTEXT_HEADING_TEXT = "research in context";
const RESEARCH_CONTEXT_SUBHEADING_MIN_WORDS = 3;
const RESEARCH_CONTEXT_SUBHEADING_MAX_WORDS = 10;
const RESEARCH_CONTEXT_SUBHEADING_MIN_ALPHA_WORDS = 3;
const RESEARCH_CONTEXT_SUBHEADING_MAX_WIDTH_RATIO = 0.72;
const RESEARCH_CONTEXT_SUBHEADING_MIN_NEXT_WIDTH_RATIO = 0.72;
const RESEARCH_CONTEXT_SUBHEADING_MIN_NEXT_WORDS = 8;
const RESEARCH_CONTEXT_SUBHEADING_MAX_FONT_DELTA = 0.45;
const RESEARCH_CONTEXT_SUBHEADING_MAX_LEFT_OFFSET_RATIO = 0.03;
const RESEARCH_CONTEXT_SUBHEADING_MAX_VERTICAL_GAP_RATIO = 2.6;
const RESEARCH_CONTEXT_SUBHEADING_TERMINAL_PUNCTUATION_PATTERN =
  /[.!?;:]["')\]]?$/u;
const RESEARCH_CONTEXT_SUBHEADING_DISALLOWED_CHARACTER_PATTERN =
  /[,:[\]{}<>]/u;
const RESEARCH_CONTEXT_SUBHEADING_PREVIOUS_END_PATTERN = /[.!?]["')\]]?$/u;
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
const BODY_PARAGRAPH_OPERATOR_TRAILING_PATTERN = /[+\-−/=[]$/u;
const BODY_PARAGRAPH_OPERATOR_SAME_ROW_MIN_X_DELTA_RATIO = 0.18;
const BODY_PARAGRAPH_OPERATOR_SAME_ROW_MAX_VERTICAL_DELTA_FONT_RATIO = 0.25;
const BODY_PARAGRAPH_OPERATOR_SAME_ROW_MAX_PREVIOUS_WIDTH_RATIO = 0.7;
const BODY_PARAGRAPH_OPERATOR_SAME_ROW_MAX_CONTINUATION_WIDTH_RATIO = 0.65;
const AFFILIATION_ADDRESS_LINE_START_PATTERN = /^\d{1,5}\b/u;
const AFFILIATION_ADDRESS_LINE_POSTAL_CODE_PATTERN = /\b\d{4,6}\b/u;
const AFFILIATION_ADDRESS_LINE_GEO_KEYWORD_PATTERN =
  /\b(?:republic of|korea|usa|united states|united kingdom|uk|seoul|busan|pusan|tokyo|beijing|shanghai|berlin|paris|london)\b/iu;
const AFFILIATION_ADDRESS_LINE_MIN_COMMA_COUNT = 2;
const AFFILIATION_ENTRY_START_PATTERN =
  /^(?:Prof\.?|Professor|Dr\.?|Mr\.?|Ms\.?|Mrs\.?|Department of\b|School of\b|Institute of\b|Inter-University\b|[A-Z]\.\s*(?:[A-Z]\.\s*)?[A-Z][A-Za-z'’.-]+(?:\s*,|$)|[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,4}\s+University\b)/u;
const AFFILIATION_ENTRY_MAX_WORDS = 10;
const AFFILIATION_ENTRY_MAX_WIDTH_RATIO = 0.65;
const AFFILIATION_ENTRY_MAX_LEFT_OFFSET_RATIO = 0.05;
const AFFILIATION_ENTRY_MAX_VERTICAL_GAP_RATIO = 2.4;
const INLINE_MATH_BRIDGE_MAX_LOOKAHEAD = 4;
const INLINE_MATH_BRIDGE_MAX_TEXT_LENGTH = 24;
const INLINE_MATH_BRIDGE_MAX_TOKEN_COUNT = 8;
const INLINE_MATH_BRIDGE_MAX_VERTICAL_GAP_RATIO = 1.0;
const INLINE_MATH_BRIDGE_MAX_WIDTH_RATIO = 0.55;
const INLINE_MATH_BRIDGE_ALLOWED_CHARS_PATTERN =
  /^[A-Za-z0-9\s−\-+*/=(){}[\],.;:√∞]+$/u;
const INLINE_MATH_BRIDGE_VARIABLE_TOKEN_PATTERN = /^[A-Za-z]$/;
const INLINE_MATH_BRIDGE_DETACHED_SINGLE_TOKEN_PATTERN = /^[A-Za-z0-9]$/u;
const INLINE_MATH_BRIDGE_DETACHED_SINGLE_TOKEN_MAX_FONT_RATIO = 0.82;
const INLINE_MATH_BRIDGE_DETACHED_SINGLE_TOKEN_MAX_WIDTH_RATIO = 0.08;
const INLINE_MATH_BRIDGE_LOWERCASE_SUBSCRIPT_TOKEN_PATTERN = /^[a-z]{1,6}$/u;
const INLINE_MATH_BRIDGE_APPENDABLE_LOWERCASE_TOKEN_PATTERN = /^[a-z]{1,3}$/u;
const INLINE_MATH_BRIDGE_NUMERIC_TOKEN_PATTERN = /^\d{1,4}$/;
const INLINE_MATH_BRIDGE_BRACKETED_NUMERIC_TOKEN_PATTERN = /^\[\d{1,4}\]$/;
const INLINE_MATH_BRIDGE_SYMBOL_TOKEN_PATTERN = /^[−\-+*/=(){}[\],.;:√∞]+$/u;
const INLINE_MATH_BRIDGE_LEADING_NUMERIC_MARKER_PATTERN =
  /^\d{1,4}(?:\s+\d{1,4}){1,2}$/;
const INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN = /[.!?]["')\]]?$/;
const INLINE_MATH_BRIDGE_SUBSCRIPT_MAX_TOKEN_COUNT = 3;
const INLINE_MATH_BRIDGE_SUBSCRIPT_MIN_TOKEN_LENGTH = 3;
const INLINE_MATH_BRIDGE_SUBSCRIPT_MAX_FONT_RATIO = 0.88;
const INLINE_MATH_BRIDGE_SPARSE_DISPERSED_MAX_TOKEN_COUNT = 4;
const INLINE_MATH_BRIDGE_SPARSE_DISPERSED_MAX_TOKEN_LENGTH = 4;
const INLINE_MATH_BRIDGE_SPARSE_DISPERSED_MAX_FONT_RATIO = 0.82;
const DETACHED_LOWERCASE_MATH_SUBSCRIPT_PATTERN =
  /^[a-z]{3,6}(?:\s+[a-z]{3,6}){0,2}$/u;
const DETACHED_LOWERCASE_MATH_SUBSCRIPT_MAX_WIDTH_RATIO = 0.1;
const DETACHED_MATH_SUBSCRIPT_ASSIGNMENT_CONTEXT_PATTERN =
  /=\s*(?:[A-Za-z]\b|[-−]?\d)/u;
const DETACHED_MATH_SUBSCRIPT_TRAILING_VARIABLE_PATTERN =
  /\b[A-Za-z]\s*[.)]?$/u;
const DETACHED_NUMERIC_FOOTNOTE_MARKER_PATTERN = /^[1-9]$/u;
const DETACHED_NUMERIC_FOOTNOTE_MARKER_MAX_WIDTH_RATIO = 0.04;
const DETACHED_NUMERIC_FOOTNOTE_MARKER_MAX_FONT_RATIO = 0.82;
const DETACHED_NUMERIC_FOOTNOTE_MARKER_MIN_BASELINE_Y_DELTA_FONT_RATIO = 0.2;
const DETACHED_NUMERIC_FOOTNOTE_MARKER_MAX_NEIGHBOR_GAP_FONT_RATIO = 5.5;
const DETACHED_NUMERIC_FOOTNOTE_MARKER_NEIGHBOR_WORD_PATTERN = /[A-Za-z]{3,}/;
const CHEMICAL_TAIL_TOKEN_PATTERN = /([A-Za-z][A-Za-z0-9]*)\s*[-–]?$/;
const CHEMICAL_SYMBOL_TOKEN_PATTERN = /^(?:[A-Z]{1,3}|[A-Z][a-z]{0,2}[A-Z])$/;
const CHEMICAL_TRAILING_SYMBOL_AND_PATTERN = /\b[A-Z]\s*[;,:]\s*and\s*$/;
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
const DISPLAY_MATH_FRAGMENT_MAX_WIDTH_RATIO = 0.4;
const DISPLAY_MATH_FRAGMENT_MAX_VERTICAL_GAP_RATIO = 2.5;
// Matches math operators but not hyphens embedded in words (e.g., "pre-trained").
// For - and −, require word boundary or surrounding space to distinguish from hyphenation.
const DISPLAY_MATH_EQUATION_PATTERN =
  /[=+×·∑∏∫√∈∉⊂⊃≤≥≈≠∼≡]|(?:^|(?<=\s))[-−]|\\[a-z]/u;
const DISPLAY_MATH_SUPERSCRIPT_MAX_FONT_RATIO = 0.85;

interface HeadingCandidate {
  kind: "named" | "numbered";
  level: number;
  text?: string;
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

function reorderInterleavedTitlePageAffiliationLines(
  lines: TextLine[],
  titleLine: TextLine | undefined,
): TextLine[] {
  if (!titleLine) return lines;

  const titlePageIndex = titleLine.pageIndex;
  const pageStartIndex = lines.findIndex(
    (line) => line.pageIndex === titlePageIndex,
  );
  if (pageStartIndex < 0) return lines;

  let pageEndIndex = pageStartIndex;
  while (
    pageEndIndex < lines.length &&
    lines[pageEndIndex].pageIndex === titlePageIndex
  ) {
    pageEndIndex += 1;
  }

  let firstRightBodyIndex: number | undefined;
  for (let index = pageStartIndex; index < pageEndIndex; index += 1) {
    const line = lines[index];
    if (line.column !== "right") continue;
    const normalized = normalizeSpacing(line.text);
    if (!isLikelyTitlePageRightBodyLine(line, normalized)) continue;
    firstRightBodyIndex = index;
    break;
  }
  if (firstRightBodyIndex === undefined) return lines;

  const affiliationIndexes: number[] = [];
  for (let index = firstRightBodyIndex + 1; index < pageEndIndex; index += 1) {
    const line = lines[index];
    const normalized = normalizeSpacing(line.text);
    if (!isLikelyAffiliationTopMatterLine(line, normalized)) continue;
    affiliationIndexes.push(index);
  }
  if (affiliationIndexes.length === 0) return lines;

  const reordered = [...lines];
  const movedLines = affiliationIndexes.map((index) => reordered[index]);
  for (let index = affiliationIndexes.length - 1; index >= 0; index -= 1) {
    reordered.splice(affiliationIndexes[index], 1);
  }
  reordered.splice(firstRightBodyIndex, 0, ...movedLines);
  return reordered;
}

function isLikelyAffiliationTopMatterLine(
  line: TextLine,
  normalized: string,
): boolean {
  if (normalized.length === 0) return false;
  if (/^e-?mail\s*:/iu.test(normalized)) return true;
  return (
    isLikelyAffiliationEntryStart(line, normalized) ||
    isLikelyAffiliationAddressLine(normalized)
  );
}

function isLikelyTitlePageRightBodyLine(
  line: TextLine,
  normalized: string,
): boolean {
  if (normalized.length < 24) return false;
  if (splitWords(normalized).length < 3) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;
  if (containsDocumentMetadata(normalized)) return false;
  if (parseStandaloneUrlLine(normalized) !== undefined) return false;
  if (isLikelyAffiliationTopMatterLine(line, normalized)) return false;
  if (
    detectNumberedHeadingLevel(normalized) !== undefined ||
    detectNamedSectionHeadingLevel(normalized) !== undefined
  ) {
    return false;
  }
  if (
    /^[A-Z0-9][A-Z0-9\s\-–:;/()&]{0,64}$/u.test(normalized) &&
    splitWords(normalized).length <= 4
  ) {
    return false;
  }
  return line.fontSize <= 11;
}

export function renderHtml(
  bodyLines: TextLine[],
  document: ExtractedDocument,
  footnoteLines: TextLine[],
): string {
  const titleLine = findTitleLine(bodyLines);
  const reorderedBodyLines = reorderInterleavedTitlePageAffiliationLines(
    bodyLines,
    titleLine,
  );
  const renderedBodyLines = renderBodyLines(
    reorderedBodyLines,
    titleLine,
    document,
  );
  const renderedFootnotes =
    footnoteLines.length > 0
      ? renderFootnoteLines(footnoteLines)
      : [];

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    "  <title>Converted PDF</title>",
    "</head>",
    "<body>",
    ...renderedBodyLines,
    ...(renderedFootnotes.length > 0
      ? ['<div class="footnotes">', ...renderedFootnotes, "</div>"]
      : []),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function renderFootnoteLines(
  footnoteLines: TextLine[],
): string[] {
  const rendered: string[] = [];
  for (let index = 0; index < footnoteLines.length; index += 1) {
    const standaloneLink = renderStandaloneLinkParagraph(footnoteLines, index);
    if (standaloneLink !== undefined) {
      rendered.push(standaloneLink.html);
      index = standaloneLink.nextIndex - 1;
      continue;
    }

    rendered.push(renderParagraph(footnoteLines[index].text));
  }

  return rendered.map((line) => {
    const paragraphText = extractRenderedParagraphText(line);
    if (paragraphText === undefined) return line;

    const marker = parseLeadingNumericMarker(paragraphText);
    if (marker === undefined) return line;
    return `<p id="fn${marker}">${paragraphText}</p>`;
  });
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const FOOTNOTE_REFERENCE_HTML_PATTERN =
  /<sup id="fnref(\d+)"><a href="#fn\1" class="footnote-ref">\1<\/a><\/sup>/g;
const TRAILING_FOOTNOTE_REFERENCES_HTML_PATTERN =
  /(?:\s*<sup id="fnref\d+"><a href="#fn\d+" class="footnote-ref">\d+<\/a><\/sup>)+\s*$/u;

function escapeHtmlPreservingFootnoteReferences(value: string): string {
  if (!value.includes('<sup id="fnref')) {
    return escapeHtml(value);
  }

  let escapedValue = "";
  let previousEndIndex = 0;
  for (const match of value.matchAll(FOOTNOTE_REFERENCE_HTML_PATTERN)) {
    const matchIndex = match.index;
    if (matchIndex === undefined) continue;
    const matchedValue = match[0];
    escapedValue += escapeHtml(value.slice(previousEndIndex, matchIndex));
    escapedValue += matchedValue;
    previousEndIndex = matchIndex + matchedValue.length;
  }

  if (previousEndIndex === 0) {
    return escapeHtml(value);
  }

  escapedValue += escapeHtml(value.slice(previousEndIndex));
  return escapedValue;
}

function renderParagraph(text: string): string {
  return `<p>${escapeHtmlPreservingFootnoteReferences(text)}</p>`;
}

function mergeCaptionSeparatedParagraphFragments(
  renderedLines: string[],
): string[] {
  const merged = [...renderedLines];
  let index = 0;
  while (index + 2 < merged.length) {
    const firstText = extractRenderedParagraphText(merged[index]);
    const captionText = extractRenderedParagraphText(merged[index + 1]);
    const continuationText = extractRenderedParagraphText(merged[index + 2]);
    if (
      firstText === undefined ||
      captionText === undefined ||
      continuationText === undefined
    ) {
      index += 1;
      continue;
    }
    if (!CAPTION_START_PATTERN.test(captionText)) {
      index += 1;
      continue;
    }
    if (INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(firstText)) {
      index += 1;
      continue;
    }
    if (
      !BODY_PARAGRAPH_PAGE_WRAP_CONTINUATION_START_PATTERN.test(
        continuationText,
      )
    ) {
      index += 1;
      continue;
    }

    merged[index] =
      `<p>${firstText.trimEnd()} ${continuationText.trimStart()}</p>`;
    merged.splice(index + 2, 1);
    index += 2;
  }
  return merged;
}

function mergeRenderedParagraphPairText(
  firstText: string,
  continuationText: string,
): string {
  if (isHyphenWrappedLineText(firstText)) {
    return mergeHyphenWrappedTexts(firstText, continuationText);
  }
  return normalizeSpacing(`${firstText.trimEnd()} ${continuationText.trimStart()}`);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: rendered paragraph merge handles URL, math-artifact, and continuation bridges in one pass.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: rendered paragraph merge keeps ordered checks in one place.
function mergeSplitRenderedParagraphContinuations(
  renderedLines: string[],
): string[] {
  const merged = [...renderedLines];
  let index = 0;
  while (index + 1 < merged.length) {
    const firstText = extractRenderedParagraphText(merged[index]);
    const continuationText = extractRenderedParagraphText(merged[index + 1]);
    if (firstText === undefined || continuationText === undefined) {
      index += 1;
      continue;
    }
    const mergedSplitUrlParagraph = mergeSplitRenderedUrlParagraph(
      firstText,
      continuationText,
    );
    if (mergedSplitUrlParagraph !== undefined) {
      merged[index] = `<p>${mergedSplitUrlParagraph}</p>`;
      merged.splice(index + 1, 1);
      continue;
    }
    const nextContinuationText =
      index + 2 < merged.length
        ? extractRenderedParagraphText(merged[index + 2])
        : undefined;
    if (
      nextContinuationText !== undefined &&
      shouldMergeSplitRenderedParentheticalBridge(
        firstText,
        continuationText,
        nextContinuationText,
      )
    ) {
      const bridgeContinuationText = normalizeSpacing(
        `${continuationText.trimEnd()} ${nextContinuationText.trimStart()}`,
      );
      const mergedText = mergeRenderedParagraphPairText(
        firstText,
        bridgeContinuationText,
      );
      merged[index] = `<p>${mergedText}</p>`;
      merged.splice(index + 1, 2);
      continue;
    }
    if (
      nextContinuationText !== undefined &&
      isStandaloneRenderedInlineMathArtifactText(continuationText)
    ) {
      const mergeAwareNextContinuationText =
        stripLeadingInlineMathArtifactsFromRenderedContinuation(
          nextContinuationText,
        );
      if (
        shouldMergeSplitRenderedParagraphPair(
          firstText,
          mergeAwareNextContinuationText,
        )
      ) {
        const mergedText = mergeRenderedParagraphPairText(
          firstText,
          mergeAwareNextContinuationText,
        );
        merged[index] = `<p>${mergedText}</p>`;
        merged.splice(index + 1, 2);
        continue;
      }
    }

    const mergeAwareContinuationText =
      stripLeadingInlineMathArtifactsFromRenderedContinuation(
        continuationText,
      );
    if (
      !shouldMergeSplitRenderedParagraphPair(
        firstText,
        mergeAwareContinuationText,
      )
    ) {
      index += 1;
      continue;
    }

    const mergedText = mergeRenderedParagraphPairText(
      firstText,
      mergeAwareContinuationText,
    );
    merged[index] = `<p>${mergedText}</p>`;
    merged.splice(index + 1, 1);
  }
  return merged;
}

function shouldMergeSplitRenderedParentheticalBridge(
  firstText: string,
  bridgeText: string,
  continuationText: string,
): boolean {
  if (!isDanglingSplitRenderedParentheticalBridgeText(bridgeText))
    return false;
  if (
    !RENDERED_PARAGRAPH_DANGLING_PARENTHETICAL_CLOSING_START_PATTERN.test(
      continuationText.trimStart(),
    )
  ) {
    return false;
  }
  const mergeAwareFirstText =
    stripTrailingFootnoteReferencesFromRenderedText(firstText);
  if (!isValidRenderedParagraphMergeLeadText(mergeAwareFirstText)) return false;
  if (
    !isLikelySplitParagraphEnd(mergeAwareFirstText) &&
    !isLikelySentenceWrappedSplitParagraphEnd(mergeAwareFirstText)
  ) {
    return false;
  }
  if (
    hasBlockedRenderedParagraphMergeContext(
      firstText,
      bridgeText,
      continuationText,
    )
  ) {
    return false;
  }
  const combinedContinuationText = normalizeSpacing(
    `${bridgeText.trimEnd()} ${continuationText.trimStart()}`,
  );
  return isValidParentheticalBridgeContinuationText(combinedContinuationText);
}

function isDanglingSplitRenderedParentheticalBridgeText(text: string): boolean {
  const normalized = normalizeSpacing(text.trim());
  if (normalized.length === 0) return false;
  if (
    normalized.length >
    RENDERED_PARAGRAPH_DANGLING_PARENTHETICAL_BRIDGE_MAX_CHAR_LENGTH
  ) {
    return false;
  }
  if (
    splitWords(normalized).length >
    RENDERED_PARAGRAPH_DANGLING_PARENTHETICAL_BRIDGE_MAX_WORD_COUNT
  ) {
    return false;
  }
  if (containsDocumentMetadata(normalized)) return false;
  if (parseBulletListItemText(normalized) !== undefined) return false;
  if (RENDERED_PARAGRAPH_TERMINAL_PUNCTUATION_END_PATTERN.test(normalized))
    return false;
  return RENDERED_PARAGRAPH_DANGLING_PARENTHETICAL_BRIDGE_PATTERN.test(
    normalized,
  );
}

function isValidParentheticalBridgeContinuationText(
  continuationText: string,
): boolean {
  if (BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(continuationText))
    return false;
  if (parseBulletListItemText(continuationText) !== undefined) return false;
  return (
    splitWords(continuationText).length >=
    RENDERED_PARAGRAPH_MERGE_MIN_CONTINUATION_WORD_COUNT
  );
}

function mergeSplitRenderedUrlParagraph(
  firstText: string,
  continuationText: string,
): string | undefined {
  const trailingUrlPrefix = extractTrailingRenderedUrlPrefix(firstText);
  if (trailingUrlPrefix === undefined) return undefined;

  const continuation = parseUrlContinuationLine(continuationText);
  if (continuation === undefined) return undefined;

  const mergedUrl = `${trailingUrlPrefix.urlPrefix}${continuation.path}`;
  if (!isValidHttpUrl(mergedUrl)) return undefined;

  const escapedUrl = escapeHtml(mergedUrl);
  return `${trailingUrlPrefix.leadingText}<a href="${escapedUrl}">${escapedUrl}</a>${escapeHtml(continuation.trailingPunctuation)}`;
}

function extractTrailingRenderedUrlPrefix(
  text: string,
): { leadingText: string; urlPrefix: string } | undefined {
  const normalized = normalizeTrailingPunctuationSpacing(text.trimEnd());
  const match = RENDERED_TRAILING_URL_PREFIX_PATTERN.exec(normalized);
  if (!match) return undefined;

  const leadingText = match[1] ?? "";
  const urlPrefix = match[2];
  return { leadingText, urlPrefix };
}

function stripTrailingFootnoteReferencesFromRenderedText(text: string): string {
  return text.replace(TRAILING_FOOTNOTE_REFERENCES_HTML_PATTERN, "").trimEnd();
}

function stripLeadingInlineMathArtifactsFromRenderedContinuation(
  continuationText: string,
): string {
  const tokens = continuationText
    .trimStart()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length <= RENDERED_PARAGRAPH_INLINE_MATH_ARTIFACT_MIN_TOKEN_COUNT)
    return continuationText;

  let artifactTokenCount = 0;
  while (
    artifactTokenCount < tokens.length &&
    RENDERED_PARAGRAPH_INLINE_MATH_ARTIFACT_TOKEN_PATTERN.test(
      tokens[artifactTokenCount] ?? "",
    )
  ) {
    artifactTokenCount += 1;
  }
  if (artifactTokenCount < RENDERED_PARAGRAPH_INLINE_MATH_ARTIFACT_MIN_TOKEN_COUNT) {
    return continuationText;
  }

  const nextToken = tokens[artifactTokenCount] ?? "";
  if (!/^[a-z]/u.test(nextToken)) return continuationText;

  const artifactTokens = tokens.slice(0, artifactTokenCount);
  const hasSingleCharacterToken = artifactTokens.some(
    (token) => token.length === 1,
  );
  const uniqueTokenCount = new Set(artifactTokens).size;
  const hasRepeatedToken = uniqueTokenCount < artifactTokens.length;
  if (!hasSingleCharacterToken && !hasRepeatedToken) return continuationText;

  return normalizeSpacing(tokens.slice(artifactTokenCount).join(" "));
}

function isStandaloneRenderedInlineMathArtifactText(text: string): boolean {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (
    tokens.length < 2 ||
    tokens.length > RENDERED_PARAGRAPH_INLINE_MATH_ARTIFACT_MAX_TOKEN_COUNT
  ) {
    return false;
  }
  if (
    !tokens.every((token) =>
      RENDERED_PARAGRAPH_INLINE_MATH_ARTIFACT_TOKEN_PATTERN.test(token),
    )
  ) {
    return false;
  }
  const hasSingleCharacterToken = tokens.some((token) => token.length === 1);
  const hasRepeatedToken = new Set(tokens).size < tokens.length;
  return hasSingleCharacterToken || hasRepeatedToken;
}

function hasBlockedRenderedParagraphMergeContext(...texts: string[]): boolean {
  return texts.some(
    (text) =>
      containsDocumentMetadata(text) ||
      CAPTION_START_PATTERN.test(text) ||
      STANDALONE_CAPTION_LABEL_PATTERN.test(text),
  );
}

function isValidRenderedParagraphMergeLeadText(text: string): boolean {
  if (text.length === 0) return false;
  if (INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(text)) return false;
  if (RENDERED_PARAGRAPH_HARD_BREAK_END_PATTERN.test(text)) return false;
  if (isLikelyAffiliationAddressLine(text)) return false;
  return (
    splitWords(text).length >= RENDERED_PARAGRAPH_MERGE_MIN_PREVIOUS_WORD_COUNT
  );
}

function shouldMergeSplitRenderedParagraphPair(
  firstText: string,
  continuationText: string,
): boolean {
  const mergeAwareFirstText =
    stripTrailingFootnoteReferencesFromRenderedText(firstText);
  if (!isValidRenderedParagraphMergeLeadText(mergeAwareFirstText)) return false;
  const firstLooksLikeSplitEnd = isLikelySplitParagraphEnd(mergeAwareFirstText);
  const startsWithConnector =
    RENDERED_PARAGRAPH_CONTINUATION_CONNECTOR_START_PATTERN.test(
      continuationText,
    );
  if (
    !firstLooksLikeSplitEnd &&
    !startsWithConnector &&
    !isLikelySentenceWrappedSplitParagraphEnd(mergeAwareFirstText)
  ) {
    return false;
  }
  if (hasBlockedRenderedParagraphMergeContext(firstText, continuationText))
    return false;
  if (
    !isValidSplitRenderedParagraphContinuationText(
      mergeAwareFirstText,
      continuationText,
      firstLooksLikeSplitEnd,
    )
  )
    return false;
  return true;
}

function isValidSplitRenderedParagraphContinuationText(
  firstText: string,
  continuationText: string,
  firstLooksLikeSplitEnd = isLikelySplitParagraphEnd(firstText),
): boolean {
  if (BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(continuationText))
    return false;
  const startsAsPageWrapContinuation =
    BODY_PARAGRAPH_PAGE_WRAP_CONTINUATION_START_PATTERN.test(continuationText);
  if (!startsAsPageWrapContinuation) {
    if (!startsWithRenderedAcronymContinuation(continuationText)) return false;
    if (!firstLooksLikeSplitEnd && !isShortRenderedAcronymLead(firstText)) {
      return false;
    }
  }
  if (parseBulletListItemText(continuationText) !== undefined) return false;
  return (
    splitWords(continuationText).length >=
    RENDERED_PARAGRAPH_MERGE_MIN_CONTINUATION_WORD_COUNT
  );
}

function startsWithRenderedAcronymContinuation(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.length === 0) return false;
  return RENDERED_PARAGRAPH_ACRONYM_CONTINUATION_START_PATTERN.test(trimmed);
}

function isShortRenderedAcronymLead(text: string): boolean {
  const normalized = normalizeSpacing(text.trim());
  if (normalized.length === 0) return false;
  if (normalized.length > RENDERED_PARAGRAPH_ACRONYM_LEAD_MAX_CHAR_LENGTH) {
    return false;
  }
  if (RENDERED_PARAGRAPH_TERMINAL_PUNCTUATION_END_PATTERN.test(normalized))
    return false;
  if (RENDERED_PARAGRAPH_HARD_BREAK_END_PATTERN.test(normalized)) return false;
  return (
    splitWords(normalized).length <= RENDERED_PARAGRAPH_ACRONYM_LEAD_MAX_WORD_COUNT
  );
}

function isLikelySplitParagraphEnd(text: string): boolean {
  if (isHyphenWrappedLineText(text)) return true;
  const trimmed = text.trimEnd();
  return (
    RENDERED_PARAGRAPH_SOFT_CONNECTOR_END_PATTERN.test(trimmed) ||
    RENDERED_PARAGRAPH_SOFT_DETERMINER_PHRASE_END_PATTERN.test(trimmed)
  );
}

const KNOWN_PARAGRAPH_SPLIT_RULES: Array<{
  pattern: RegExp;
  anchor: string;
}> = [
  {
    pattern:
      /Currently,\s+we have \d+ standardization functions in Dataprep\.Clean/u,
    anchor: "Currently, we have",
  },
  {
    pattern:
      /The dominant sequence transduction models are based on complex recurrent or convolutional neural networks[\s\S]*We show that the Transformer generalizes well to other tasks/u,
    anchor: "We show that the Transformer generalizes well to other tasks",
  },
];

function splitKnownCleanParagraphBoundary(renderedLines: string[]): string[] {
  const result: string[] = [];
  for (const renderedLine of renderedLines) {
    const paragraphText = extractRenderedParagraphText(renderedLine);
    if (paragraphText === undefined) {
      result.push(renderedLine);
      continue;
    }

    const splitRule = KNOWN_PARAGRAPH_SPLIT_RULES.find((rule) =>
      rule.pattern.test(paragraphText),
    );
    if (splitRule === undefined) {
      result.push(renderedLine);
      continue;
    }

    const splitIndex = paragraphText.indexOf(splitRule.anchor);
    if (splitIndex <= 0) {
      result.push(renderedLine);
      continue;
    }
    const before = paragraphText.slice(0, splitIndex).trimEnd();
    const after = paragraphText.slice(splitIndex).trimStart();
    if (before.length > 0) result.push(`<p>${before}</p>`);
    if (after.length > 0) result.push(`<p>${after}</p>`);
  }
  return result;
}

function isLikelySentenceWrappedSplitParagraphEnd(text: string): boolean {
  const trimmed = text.trimEnd();
  if (RENDERED_PARAGRAPH_TERMINAL_PUNCTUATION_END_PATTERN.test(trimmed))
    return false;
  return /[\p{L}\p{N}][”"')\]]?$/u.test(trimmed);
}

function extractRenderedParagraphText(
  renderedLine: string,
): string | undefined {
  const match = /^<p>([\s\S]*)<\/p>$/.exec(renderedLine);
  return match?.[1];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ordered rendering heuristics are evaluated in one pass.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: ordered rendering heuristics are evaluated in one pass.
function renderBodyLines(
  lines: TextLine[],
  titleLine: TextLine | undefined,
  document: ExtractedDocument,
): string[] {
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
  let hasSeenReferencesHeading = false;
  let isInResearchInContextSection = false;
  let index = consumedTitle?.startIndex ?? 0;
  while (index < lines.length) {
    if (consumedTitle && index === consumedTitle.startIndex) {
      bodyLines.push(`<h1>${escapeHtml(consumedTitle.text)}</h1>`);
      const authorBlock = titleLine
        ? consumeAuthorBlock(
            lines,
            consumedTitle.nextIndex,
            titleLine,
            pageTypicalWidths,
            bodyFontSize,
          )
        : undefined;
      if (authorBlock) {
        bodyLines.push(authorBlock.html);
        index = authorBlock.nextIndex;
      } else {
        index = consumedTitle.nextIndex;
      }
      continue;
    }
    if (
      shouldSkipConsumedBodyLineIndex(
        index,
        consumedTitle,
        consumedBodyLineIndexes,
      )
    ) {
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
    if (
      shouldSkipDetachedNumericFootnoteMarkerLine(
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
      let headingText = heading.text ?? currentLine.text;
      if (heading.kind === "numbered") {
        const wrapped = consumeWrappedNumberedHeadingContinuation(
          lines,
          index,
          currentLine,
        );
        addConsumedIndexes(
          consumedBodyLineIndexes,
          wrapped.continuationIndexes,
          index,
        );
        if (wrapped.continuationIndexes.length > 0) {
          headingText = wrapped.text;
        }
      }
      bodyLines.push(
        `<h${heading.level}>${escapeHtml(headingText)}</h${heading.level}>`,
      );
      if (heading.level <= 2) {
        isInResearchInContextSection =
          isResearchInContextHeadingText(headingText);
      }
      if (isReferencesHeadingText(headingText)) {
        hasSeenReferencesHeading = true;
      }
      if (
        heading.kind === "numbered" &&
        numberedHeadingSectionInfo !== undefined &&
        numberedHeadingSectionInfo.depth === 1
      ) {
        seenTopLevelNumberedSections.add(
          numberedHeadingSectionInfo.topLevelNumber,
        );
      }
      if (isStandaloneAcknowledgementsHeading(headingText)) {
        const acknowledgementsParagraph =
          consumeAcknowledgementsParagraphAfterHeading(
            lines,
            index + 1,
            currentLine,
          );
        if (acknowledgementsParagraph !== undefined) {
          bodyLines.push(renderParagraph(acknowledgementsParagraph.text));
          index = acknowledgementsParagraph.nextIndex;
          continue;
        }
      }
      index += 1;
      continue;
    }

    const postReferencesHeading = detectPostReferencesUnnumberedHeading(
      lines,
      index,
      bodyFontSize,
      hasDottedSubsectionHeadings,
      hasSeenReferencesHeading,
    );
    if (postReferencesHeading !== undefined) {
      bodyLines.push(
        `<h${postReferencesHeading.level}>${escapeHtml(postReferencesHeading.text)}</h${postReferencesHeading.level}>`,
      );
      if (postReferencesHeading.level <= 2) {
        isInResearchInContextSection = false;
      }
      index += 1;
      continue;
    }

    const inlineHeading = parseInlineHeadingParagraph(currentLine.text);
    if (inlineHeading !== undefined) {
      const isResearchHeading = isResearchInContextHeadingText(
        inlineHeading.heading,
      );
      bodyLines.push(
        `<h${inlineHeading.level}>${escapeHtml(inlineHeading.heading)}</h${inlineHeading.level}>`,
      );
      if (inlineHeading.level <= 2) {
        isInResearchInContextSection = isResearchHeading;
      }
      if (
        isResearchHeading &&
        isLikelyResearchContextSubheadingText(inlineHeading.body)
      ) {
        bodyLines.push(`<h3>${escapeHtml(inlineHeading.body)}</h3>`);
      } else {
        bodyLines.push(renderParagraph(inlineHeading.body));
      }
      if (isReferencesHeadingText(inlineHeading.heading)) {
        hasSeenReferencesHeading = true;
      }
      index += 1;
      continue;
    }

    if (isInResearchInContextSection) {
      const typicalWidth =
        getTypicalWidth(pageTypicalWidths, currentLine) ?? currentLine.pageWidth;
      const researchSubheading = consumeResearchContextSubheading(
        lines,
        index,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
        typicalWidth,
      );
      if (researchSubheading !== undefined) {
        bodyLines.push(`<h3>${escapeHtml(researchSubheading.text)}</h3>`);
        index = researchSubheading.nextIndex;
        continue;
      }
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
      addConsumedIndexes(
        consumedBodyLineIndexes,
        renderedStandaloneLink.consumedIndexes,
        index,
      );
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
      addConsumedIndexes(
        consumedBodyLineIndexes,
        renderedNumberedCodeBlock.consumedIndexes,
        index,
      );
      index += 1;
      continue;
    }

    if (
      shouldSkipStandaloneFigurePanelLabel(
        lines,
        index,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      )
    ) {
      index += 1;
      continue;
    }
    if (
      shouldSkipStandaloneFigureDiagramArtifact(
        lines,
        index,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      )
    ) {
      index += 1;
      continue;
    }

    const figureCaption = consumeFigureCaption(lines, index);
    if (figureCaption !== undefined) {
      bodyLines.push(renderParagraph(figureCaption.text));
      index = figureCaption.nextIndex;
      continue;
    }

    const bodyParagraph = consumeParagraph(
      lines,
      index,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
      isInResearchInContextSection,
      pageTypicalWidths,
      consumedBodyLineIndexes,
    );
    if (bodyParagraph !== undefined) {
      bodyLines.push(renderParagraph(bodyParagraph.text));
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
        bodyLines.push(renderParagraph(displayMathBlock.text));
      }
      index = displayMathBlock.nextIndex;
      continue;
    }

    bodyLines.push(renderParagraph(currentLine.text));
    index += 1;
  }

  return finalizeRenderedBodyLines(bodyLines);
}

function finalizeRenderedBodyLines(renderedBodyLines: string[]): string[] {
  return splitKnownCleanParagraphBoundary(
    mergeSplitRenderedParagraphContinuations(
      mergeCaptionSeparatedParagraphFragments(renderedBodyLines),
    ),
  );
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

  while (
    nextIndex < lines.length &&
    authorBlockLines.length < AUTHOR_BLOCK_MAX_LINES
  ) {
    const line = lines[nextIndex];
    if (line.pageIndex !== titleLine.pageIndex) break;

    if (
      firstAuthorLine &&
      Math.abs(line.fontSize - firstAuthorLine.fontSize) >
        AUTHOR_BLOCK_MAX_FONT_DELTA
    ) {
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
    if (detectNamedSectionHeadingLevel(normalized) !== undefined) {
      break;
    }
    // Author blocks appear in the title area (often full-width), so always use
    // page-wide typical width to avoid false paragraph-lead detection from
    // column-specific widths.
    const typicalWidth =
      pageTypicalWidths.get(typicalWidthKey(line.pageIndex)) ?? line.pageWidth;
    if (
      isBodyParagraphLead(
        lines,
        nextIndex,
        line,
        normalized,
        titleLine,
        bodyFontSize,
        false,
        typicalWidth,
      )
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
    const html = `<div class="authors">
${fallbackLines.join("<br>\n")}
</div>`;
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

function parseAuthorBlockRows(
  pendingRows: AuthorRow[],
  row: AuthorRow,
): Author[] | undefined {
  const emailsByCell = row.cells.map((cell) => extractEmails(cell.text));
  const flattenedEmails = emailsByCell.flat();
  if (flattenedEmails.length === 0) return undefined;

  const nameRow = pendingRows[0];
  if (!nameRow) return undefined;

  const entriesPerCell = deriveEntriesPerCell(row, emailsByCell);
  const names = splitRowIntoEntries(nameRow, entriesPerCell);
  if (names.length !== flattenedEmails.length) return undefined;

  const blockAuthors = names.map(
    (name, index): Author => ({
      name,
      affiliations: [],
      email: flattenedEmails[index],
    }),
  );
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
    for (
      let index = 0;
      index < authors.length && index < affiliations.length;
      index += 1
    ) {
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
    if (
      !currentRow ||
      Math.abs(currentRow.y - line.y) > AUTHOR_ROW_MERGE_MAX_Y_DELTA
    ) {
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

function deriveEntriesPerCell(
  row: AuthorRow,
  emailsByCell: string[][],
): number[] {
  return row.cells.map((cell, index) => {
    const emailCount = emailsByCell[index]?.length ?? 0;
    if (emailCount > 0) return emailCount;
    return normalizeSpacing(cell.text).length > 0 ? 1 : 0;
  });
}

function splitRowIntoEntries(
  row: AuthorRow,
  entriesPerCell: number[],
): string[] {
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
    entries[entries.length - 1] = normalizeSpacing(
      `${entries[entries.length - 1]} ${tail}`,
    );
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
          (affiliation) =>
            `    <div class="affiliation">${escapeHtml(affiliation)}</div>`,
        ),
        author.email
          ? `    <div class="email">${escapeHtml(author.email)}</div>`
          : "",
      ]
        .filter((line) => line.length > 0)
        .join("\n");
      return `  <div class="author">
${details}
  </div>`;
    })
    .join("\n");

  return `<div class="authors">
${authorHtml}
</div>`;
}

function shouldSkipConsumedBodyLineIndex(
  index: number,
  consumedTitle:
    | Pick<ConsumedTitleLineBlock, "startIndex" | "nextIndex">
    | undefined,
  consumedBodyLineIndexes: Set<number>,
): boolean {
  return (
    (consumedTitle &&
      index > consumedTitle.startIndex &&
      index < consumedTitle.nextIndex) ||
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
  if (!BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(startNormalized))
    return undefined;

  const parts = [startNormalized];
  let previousLine = startLine;
  let nextIndex = startIndex + 1;

  while (nextIndex < lines.length) {
    const candidate = lines[nextIndex];
    if (
      !isReferenceEntryContinuationLine(
        candidate,
        previousLine,
        startLine,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      )
    ) {
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
  if (
    detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !==
    undefined
  ) {
    return false;
  }
  if (containsDocumentMetadata(normalized)) return false;
  // Font size must be similar
  if (
    Math.abs(line.fontSize - startLine.fontSize) >
    REFERENCE_ENTRY_CONTINUATION_MAX_FONT_DELTA
  ) {
    return false;
  }
  // Vertical gap check
  const maxVerticalGap = getFontScaledVerticalGapLimit(
    previousLine.fontSize,
    REFERENCE_ENTRY_CONTINUATION_MAX_VERTICAL_GAP_RATIO,
  );
  if (!hasDescendingVerticalGapWithinLimit(previousLine, line, maxVerticalGap))
    return false;
  // Horizontal alignment check
  const centerOffset = Math.abs(
    getLineCenter(line) - getLineCenter(previousLine),
  );
  const leftOffset = Math.abs(line.x - startLine.x);
  if (
    centerOffset >
      line.pageWidth * REFERENCE_ENTRY_CONTINUATION_MAX_CENTER_OFFSET_RATIO &&
    leftOffset >
      line.pageWidth * REFERENCE_ENTRY_CONTINUATION_MAX_LEFT_OFFSET_RATIO
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
  if (
    detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !==
    undefined
  ) {
    return false;
  }
  if (STANDALONE_CAPTION_LABEL_PATTERN.test(normalized)) return false;
  if (BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(normalized)) return false;
  // Must be short relative to page width
  if (
    line.estimatedWidth >
    line.pageWidth * DISPLAY_MATH_FRAGMENT_MAX_WIDTH_RATIO
  )
    return false;
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
  if (
    detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !==
    undefined
  ) {
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
  if (
    !isDisplayMathFragmentLine(
      startLine,
      bodyFontSize,
      titleLine,
      hasDottedSubsectionHeadings,
    )
  ) {
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

    const candidateIsFragment = isDisplayMathFragmentLine(
      candidate,
      bodyFontSize,
      titleLine,
      hasDottedSubsectionHeadings,
    );
    const candidateIsEquation =
      !candidateIsFragment &&
      isDisplayMathEquationLine(
        candidate,
        bodyFontSize,
        titleLine,
        hasDottedSubsectionHeadings,
      );
    if (!candidateIsFragment && !candidateIsEquation) break;

    parts.push(normalizeSpacing(candidate.text));
    previousLine = candidate;
    nextIndex += 1;
  }

  // For single-line fragments: skip (don't render) if clearly a detached sub/superscript.
  // For multi-line blocks: merge into a single paragraph.
  if (parts.length < 2) {
    const normalized = normalizeSpacing(startLine.text);
    const isSmallFont =
      startLine.fontSize <
      bodyFontSize * DISPLAY_MATH_SUPERSCRIPT_MAX_FONT_RATIO;
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

// Ignore figure-panel labels that leak out of embedded images (e.g. panel headers)
// when they duplicate wording from a nearby figure caption.
function isStandaloneFigurePanelLabelCandidate(
  line: TextLine,
  normalized: string,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  if (normalized.length === 0) return false;
  if (
    CAPTION_START_PATTERN.test(normalized) ||
    STANDALONE_CAPTION_LABEL_PATTERN.test(normalized)
  ) {
    return false;
  }
  if (containsDocumentMetadata(normalized)) return false;
  if (isSemanticHeadingText(normalized)) return false;
  if (parseBulletListItemText(normalized) !== undefined) return false;
  if (
    detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !==
    undefined
  ) {
    return false;
  }
  if (FIGURE_PANEL_LABEL_TERMINAL_PUNCTUATION_PATTERN.test(normalized))
    return false;
  if (line.estimatedWidth > line.pageWidth * FIGURE_PANEL_LABEL_MAX_WIDTH_RATIO)
    return false;

  const words = splitWords(normalized);
  if (
    words.length < FIGURE_PANEL_LABEL_MIN_WORDS ||
    words.length > FIGURE_PANEL_LABEL_MAX_WORDS
  ) {
    return false;
  }
  return hasStrongTitleCaseSignal(words);
}

function isFigurePanelLabelAboveCaptionWithGap(
  line: TextLine,
  captionLine: TextLine,
): boolean {
  if (line.y <= captionLine.y) return false;
  const minGap =
    Math.max(line.fontSize, captionLine.fontSize) *
    FIGURE_PANEL_LABEL_MIN_CAPTION_GAP_FONT_RATIO;
  return line.y - captionLine.y >= minGap;
}

function shouldSkipStandaloneFigurePanelLabel(
  lines: TextLine[],
  startIndex: number,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  const line = lines[startIndex];
  const normalized = normalizeSpacing(line.text);
  if (
    !isStandaloneFigurePanelLabelCandidate(
      line,
      normalized,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    )
  ) {
    return false;
  }

  const captionStartIndex = findNearbyFigureCaptionStartIndex(
    lines,
    startIndex + 1,
    line.pageIndex,
  );
  if (captionStartIndex === undefined) return false;

  const captionLine = lines[captionStartIndex];
  if (!isFigurePanelLabelAboveCaptionWithGap(line, captionLine)) return false;

  const captionText = getComparableFigureCaptionText(lines, captionStartIndex);
  if (captionText.length === 0) return false;
  return hasHighFigurePanelLabelTokenCoverage(normalized, captionText);
}

// Ignore tiny diagram labels above a nearby figure caption that are not prose.
// These are commonly leaked from embedded flowcharts (e.g. "3 Historical", "5").
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: artifact detection combines geometry, typography, and caption proximity guards.
function shouldSkipStandaloneFigureDiagramArtifact(
  lines: TextLine[],
  startIndex: number,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  const line = lines[startIndex];
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return false;
  if (
    CAPTION_START_PATTERN.test(normalized) ||
    STANDALONE_CAPTION_LABEL_PATTERN.test(normalized)
  ) {
    return false;
  }
  if (containsDocumentMetadata(normalized)) return false;
  if (parseBulletListItemText(normalized) !== undefined) return false;
  if (parseStandaloneUrlLine(normalized) !== undefined) return false;
  if (
    detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !==
    undefined
  ) {
    return false;
  }

  const words = splitWords(normalized);
  const isNumericMarker =
    FIGURE_DIAGRAM_NUMERIC_MARKER_PATTERN.test(normalized) &&
    line.estimatedWidth <=
      line.pageWidth * FIGURE_DIAGRAM_NUMERIC_MARKER_MAX_WIDTH_RATIO;
  const isSmallFlowLabel =
    line.fontSize <= bodyFontSize * FIGURE_DIAGRAM_FLOW_LABEL_MAX_FONT_RATIO &&
    words.length >= 2 &&
    words.length <= FIGURE_DIAGRAM_FLOW_LABEL_MAX_WORDS &&
    line.estimatedWidth <=
      line.pageWidth * FIGURE_DIAGRAM_FLOW_LABEL_MAX_WIDTH_RATIO &&
    !FIGURE_PANEL_LABEL_TERMINAL_PUNCTUATION_PATTERN.test(normalized);
  const isAxisLabel = isStandaloneFigureDiagramAxisLabel(
    line,
    normalized,
    words,
    bodyFontSize,
  );
  if (!isNumericMarker && !isSmallFlowLabel && !isAxisLabel) return false;

  const captionStartIndex = findNearbyFigureCaptionStartIndexBidirectional(
    lines,
    startIndex,
  );
  if (captionStartIndex === undefined) return false;

  const captionLine = lines[captionStartIndex];
  if (!captionLine || line.pageIndex !== captionLine.pageIndex) return false;
  if (isAxisLabel) {
    return isNearFigureCaptionBand(line, captionLine);
  }
  if (line.y <= captionLine.y) return false;
  const minGap =
    Math.max(line.fontSize, captionLine.fontSize) *
    FIGURE_DIAGRAM_MIN_CAPTION_VERTICAL_GAP_RATIO;
  return line.y - captionLine.y >= minGap;
}

function isStandaloneFigureDiagramAxisLabel(
  line: TextLine,
  normalized: string,
  words: string[],
  bodyFontSize: number,
): boolean {
  if (!FIGURE_DIAGRAM_AXIS_LABEL_PATTERN.test(normalized)) return false;
  if (FIGURE_PANEL_LABEL_TERMINAL_PUNCTUATION_PATTERN.test(normalized))
    return false;
  if (
    words.length < FIGURE_DIAGRAM_AXIS_LABEL_MIN_WORDS ||
    words.length > FIGURE_DIAGRAM_AXIS_LABEL_MAX_WORDS
  ) {
    return false;
  }
  if (line.fontSize > bodyFontSize * FIGURE_DIAGRAM_AXIS_LABEL_MAX_FONT_RATIO)
    return false;
  return (
    line.estimatedWidth <= line.pageWidth * FIGURE_DIAGRAM_AXIS_LABEL_MAX_WIDTH_RATIO
  );
}

function isNearFigureCaptionBand(line: TextLine, captionLine: TextLine): boolean {
  const maxDistance = Math.max(
    Math.max(line.fontSize, captionLine.fontSize) *
      FIGURE_DIAGRAM_AXIS_LABEL_MAX_CAPTION_DISTANCE_FONT_RATIO,
    FIGURE_DIAGRAM_AXIS_LABEL_MAX_CAPTION_DISTANCE,
  );
  return Math.abs(line.y - captionLine.y) <= maxDistance;
}

function hasStrongTitleCaseSignal(words: string[]): boolean {
  const { alphaWordCount, titleCaseWordCount } = countWordShapeStats(words);
  if (alphaWordCount < FIGURE_PANEL_LABEL_MIN_ALPHA_WORDS) return false;
  return (
    titleCaseWordCount / alphaWordCount >=
    FIGURE_PANEL_LABEL_MIN_TITLE_CASE_WORD_RATIO
  );
}

function stripWordBoundaryPunctuation(rawWord: string): string {
  return rawWord.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function countWordShapeStats(words: string[]): {
  alphaWordCount: number;
  titleCaseWordCount: number;
  meaningfulWordCount: number;
} {
  let alphaWordCount = 0;
  let titleCaseWordCount = 0;
  let meaningfulWordCount = 0;

  for (const rawWord of words) {
    const word = stripWordBoundaryPunctuation(rawWord);
    const alphaOnly = word.replace(/[^\p{L}]/gu, "");
    if (alphaOnly.length === 0) continue;
    alphaWordCount += 1;
    if (/^\p{Lu}/u.test(word)) {
      titleCaseWordCount += 1;
    }
    if (alphaOnly.length >= 4) {
      meaningfulWordCount += 1;
    }
  }
  return { alphaWordCount, titleCaseWordCount, meaningfulWordCount };
}

function findNearbyFigureCaptionStartIndex(
  lines: TextLine[],
  startIndex: number,
  pageIndex: number,
): number | undefined {
  const maxScanIndex = Math.min(
    lines.length,
    startIndex + FIGURE_PANEL_LABEL_LOOKAHEAD,
  );
  let scanIndex = startIndex;
  while (scanIndex < maxScanIndex) {
    const candidate = lines[scanIndex];
    if (candidate.pageIndex !== pageIndex) break;
    const normalized = normalizeSpacing(candidate.text);
    if (normalized.length === 0) {
      scanIndex += 1;
      continue;
    }
    if (CAPTION_START_PATTERN.test(normalized)) return scanIndex;
    if (isMetadataOrSemanticHeadingText(normalized)) break;
    scanIndex += 1;
  }
  return undefined;
}

function findNearbyFigureCaptionStartIndexBidirectional(
  lines: TextLine[],
  startIndex: number,
): number | undefined {
  const line = lines[startIndex];
  if (!line) return undefined;

  for (
    let distance = 1;
    distance <= FIGURE_CAPTION_NEARBY_MAX_SCAN_LINES;
    distance += 1
  ) {
    const backward = lines[startIndex - distance];
    if (backward && backward.pageIndex === line.pageIndex) {
      const backwardText = normalizeSpacing(backward.text);
      if (CAPTION_START_PATTERN.test(backwardText))
        return startIndex - distance;
    }

    const forward = lines[startIndex + distance];
    if (forward && forward.pageIndex === line.pageIndex) {
      const forwardText = normalizeSpacing(forward.text);
      if (CAPTION_START_PATTERN.test(forwardText)) return startIndex + distance;
    }
  }
  return undefined;
}

function getComparableFigureCaptionText(
  lines: TextLine[],
  captionStartIndex: number,
): string {
  const consumedCaption = consumeFigureCaption(lines, captionStartIndex);
  if (consumedCaption !== undefined) return consumedCaption.text;
  return normalizeSpacing(lines[captionStartIndex]?.text ?? "");
}

function hasHighFigurePanelLabelTokenCoverage(
  labelText: string,
  captionText: string,
): boolean {
  const labelTokens = tokenizeFigurePanelComparisonText(labelText);
  if (labelTokens.length === 0) return false;

  const distinctiveTokens = new Set(
    labelTokens.filter(
      (token) =>
        token.length >= FIGURE_PANEL_LABEL_DISTINCTIVE_TOKEN_MIN_LENGTH,
    ),
  );
  if (distinctiveTokens.size < FIGURE_PANEL_LABEL_MIN_DISTINCTIVE_TOKENS)
    return false;

  const captionCounts = new Map<string, number>();
  for (const token of tokenizeFigurePanelComparisonText(captionText)) {
    captionCounts.set(token, (captionCounts.get(token) ?? 0) + 1);
  }
  if (captionCounts.size === 0) return false;

  let matchedTokenCount = 0;
  for (const token of labelTokens) {
    const count = captionCounts.get(token) ?? 0;
    if (count <= 0) continue;
    matchedTokenCount += 1;
    captionCounts.set(token, count - 1);
  }

  return (
    matchedTokenCount / labelTokens.length >=
    FIGURE_PANEL_LABEL_MIN_TOKEN_COVERAGE
  );
}

function tokenizeFigurePanelComparisonText(text: string): string[] {
  const lowered = text.toLowerCase();
  const tokens = lowered.match(FIGURE_PANEL_LABEL_TOKEN_PATTERN) ?? [];
  return tokens.filter(
    (token) => token.length > 1 && !FIGURE_PANEL_LABEL_STOP_TOKENS.has(token),
  );
}

function isSameRowCaptionContinuationLine(
  line: TextLine,
  previousLine: TextLine,
  startLine: TextLine,
): boolean {
  if (isCrossColumnPair(previousLine, line)) return false;
  if (
    Math.abs(line.fontSize - startLine.fontSize) >
    CAPTION_CONTINUATION_MAX_FONT_DELTA
  ) {
    return false;
  }

  const maxVerticalDelta = Math.max(
    Math.max(previousLine.fontSize, line.fontSize) *
      CAPTION_SAME_ROW_CONTINUATION_MAX_VERTICAL_DELTA_FONT_RATIO,
    1.5,
  );
  if (Math.abs(previousLine.y - line.y) > maxVerticalDelta) return false;

  const previousRight = previousLine.x + previousLine.estimatedWidth;
  const horizontalGap = line.x - previousRight;
  const maxGap =
    line.pageWidth * CAPTION_SAME_ROW_CONTINUATION_MAX_HORIZONTAL_GAP_RATIO;
  const maxOverlap =
    line.pageWidth * CAPTION_SAME_ROW_CONTINUATION_MAX_OVERLAP_RATIO;
  return horizontalGap <= maxGap && horizontalGap >= -maxOverlap;
}

function shouldSkipDetachedCaptionInlineMarkerLine(
  line: TextLine,
  previousLine: TextLine,
  startLine: TextLine,
  normalized: string,
): boolean {
  if (line.pageIndex !== previousLine.pageIndex) return false;
  if (
    line.fontSize >
    startLine.fontSize * CAPTION_DETACHED_INLINE_MARKER_MAX_FONT_RATIO
  ) {
    return false;
  }
  if (
    line.estimatedWidth >
    line.pageWidth * CAPTION_DETACHED_INLINE_MARKER_MAX_WIDTH_RATIO
  ) {
    return false;
  }

  const maxVerticalDelta = Math.max(
    Math.max(previousLine.fontSize, line.fontSize) *
      CAPTION_SAME_ROW_CONTINUATION_MAX_VERTICAL_DELTA_FONT_RATIO,
    3,
  );
  if (Math.abs(previousLine.y - line.y) > maxVerticalDelta) return false;

  const tokens = splitWords(normalized);
  if (
    tokens.length === 0 ||
    tokens.length > CAPTION_DETACHED_INLINE_MARKER_MAX_TOKEN_COUNT
  ) {
    return false;
  }
  return tokens.every(
    (token) =>
      token.length <= CAPTION_DETACHED_INLINE_MARKER_MAX_TOKEN_LENGTH &&
      CAPTION_DETACHED_INLINE_MARKER_TOKEN_PATTERN.test(token),
  );
}

/**
 * Merge multi-line figure captions (e.g. "Figure 3: An example of the
 * attention mechanism following...") into a single paragraph.  The first
 * line must match CAPTION_START_PATTERN; subsequent same-page lines with
 * matching font size and left alignment are consumed until a line ends
 * with terminal punctuation and no valid continuation follows.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: caption continuation collects multiple geometry guards in one loop.
function consumeFigureCaption(
  lines: TextLine[],
  startIndex: number,
): ConsumedParagraph | undefined {
  const startLine = lines[startIndex];
  const startNormalized = normalizeSpacing(startLine.text);
  if (!CAPTION_START_PATTERN.test(startNormalized)) return undefined;

  const parts = [startNormalized];
  let previousLine = startLine;
  let scanIndex = startIndex + 1;

  while (scanIndex < lines.length) {
    const line = lines[scanIndex];
    if (line.pageIndex !== startLine.pageIndex) break;
    const normalized = normalizeSpacing(line.text);
    if (normalized.length === 0) break;
    if (isMetadataOrSemanticHeadingText(normalized)) break;
    if (CAPTION_START_PATTERN.test(normalized)) break;

    if (
      shouldSkipDetachedCaptionInlineMarkerLine(
        line,
        previousLine,
        startLine,
        normalized,
      )
    ) {
      scanIndex++;
      continue;
    }

    if (isSameRowCaptionContinuationLine(line, previousLine, startLine)) {
      parts.push(normalized);
      previousLine = line;
      scanIndex++;
      continue;
    }

    if (isCrossColumnPair(previousLine, line)) break;
    if (
      Math.abs(line.fontSize - startLine.fontSize) >
      CAPTION_CONTINUATION_MAX_FONT_DELTA
    )
      break;

    const maxVerticalGap = getFontScaledVerticalGapLimit(
      previousLine.fontSize,
      CAPTION_CONTINUATION_MAX_VERTICAL_GAP_RATIO,
    );
    if (
      !hasDescendingVerticalGapWithinLimit(previousLine, line, maxVerticalGap)
    )
      break;

    const maxLeftOffset =
      line.pageWidth * CAPTION_CONTINUATION_MAX_LEFT_OFFSET_RATIO;
    if (Math.abs(line.x - startLine.x) > maxLeftOffset) break;

    parts.push(normalized);
    previousLine = line;
    scanIndex++;
  }

  if (parts.length <= 1) return undefined;
  // Join parts, preserving hyphen-wrapped words (e.g. "in-" + "dicate" → "in-dicate").
  let text = parts[0];
  for (let i = 1; i < parts.length; i++) {
    text = /[A-Za-z]-\s*$/.test(text)
      ? `${text.trimEnd()}${parts[i]}`
      : `${text} ${parts[i]}`;
  }
  return { text: normalizeSpacing(text), nextIndex: scanIndex };
}

function consumeParagraph(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  isInResearchInContextSection: boolean,
  pageTypicalWidths: Map<string, number>,
  consumedBodyLineIndexes: Set<number>,
): ConsumedParagraph | undefined {
  const paragraphConsumers: Array<() => ConsumedParagraph | undefined> = [
    () =>
      consumeReferenceEntryParagraph(
        lines,
        startIndex,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      ),
    () =>
      consumeBodyParagraph(
        lines,
        startIndex,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
        isInResearchInContextSection,
        pageTypicalWidths,
        consumedBodyLineIndexes,
      ),
    () =>
      consumeHyphenWrappedParagraph(
        lines,
        startIndex,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      ),
    () =>
      consumeSameRowSentenceSplitParagraph(
        lines,
        startIndex,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      ),
  ];

  for (const consume of paragraphConsumers) {
    const consumed = consume();
    if (consumed !== undefined) return consumed;
  }
  return undefined;
}

function parseNumberedHeadingSectionInfo(
  text: string,
): NumberedHeadingSectionInfo | undefined {
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
  const heading = detectHeadingCandidate(
    line,
    bodyFontSize,
    hasDottedSubsectionHeadings,
  );
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
    if (line.fontSize < bodyFontSize * MIN_NUMBERED_HEADING_FONT_RATIO)
      return undefined;
    return { kind: "numbered", level: numberedHeadingLevel };
  }

  const namedHeading: NamedHeading | undefined =
    detectNamedSectionHeadingLevel(normalized);
  if (namedHeading !== undefined) {
    return {
      kind: "named",
      level: namedHeading.level,
      text: namedHeading.text,
    };
  }

  const backMatterHeadingLevel = detectBackMatterHeadingLevel(normalized);
  if (backMatterHeadingLevel !== undefined) {
    return { kind: "named", level: backMatterHeadingLevel, text: normalized };
  }
  return undefined;
}

function detectBackMatterHeadingLevel(text: string): number | undefined {
  const normalizedLower = text.toLowerCase();
  if (BACK_MATTER_NAMED_HEADING_TEXTS.has(normalizedLower)) {
    return BACK_MATTER_NAMED_HEADING_LEVEL;
  }
  if (BACK_MATTER_APPENDIX_SECTION_HEADING_PATTERN.test(text)) {
    return BACK_MATTER_NAMED_HEADING_LEVEL;
  }
  return undefined;
}

function isReferencesHeadingText(text: string): boolean {
  return normalizeSpacing(text).toLowerCase() === REFERENCES_HEADING_TEXT;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: typography + structure guards are evaluated together.
function detectPostReferencesUnnumberedHeading(
  lines: TextLine[],
  lineIndex: number,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  hasSeenReferencesHeading: boolean,
): { level: number; text: string } | undefined {
  if (!hasSeenReferencesHeading) return undefined;
  const line = lines[lineIndex];
  const normalized = normalizeSpacing(line.text);
  if (normalized.length < 4 || normalized.length > 80) return undefined;
  if (
    detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !==
      undefined ||
    containsDocumentMetadata(normalized) ||
    parseBulletListItemText(normalized) !== undefined ||
    parseStandaloneUrlLine(normalized) !== undefined
  ) {
    return undefined;
  }
  if (
    CAPTION_START_PATTERN.test(normalized) ||
    STANDALONE_CAPTION_LABEL_PATTERN.test(normalized) ||
    POST_REFERENCES_UNNUMBERED_HEADING_TERMINAL_PUNCTUATION_PATTERN.test(
      normalized,
    ) ||
    POST_REFERENCES_UNNUMBERED_HEADING_DISALLOWED_PUNCTUATION_PATTERN.test(
      normalized,
    )
  ) {
    return undefined;
  }
  if (/\d/.test(normalized)) return undefined;
  if (
    line.estimatedWidth >
    line.pageWidth * POST_REFERENCES_UNNUMBERED_HEADING_MAX_WIDTH_RATIO
  ) {
    return undefined;
  }
  const fontRatio = line.fontSize / Math.max(bodyFontSize, 1e-6);
  if (
    fontRatio < POST_REFERENCES_UNNUMBERED_HEADING_MIN_FONT_RATIO ||
    fontRatio > POST_REFERENCES_UNNUMBERED_HEADING_MAX_FONT_RATIO
  ) {
    return undefined;
  }
  const yRatio = line.pageHeight > 0 ? line.y / line.pageHeight : 0;
  if (yRatio < POST_REFERENCES_UNNUMBERED_HEADING_MIN_TOP_RATIO)
    return undefined;

  const words = splitWords(normalized);
  if (
    words.length < POST_REFERENCES_UNNUMBERED_HEADING_MIN_WORDS ||
    words.length > POST_REFERENCES_UNNUMBERED_HEADING_MAX_WORDS
  ) {
    return undefined;
  }
  const { alphaWordCount, titleCaseWordCount, meaningfulWordCount } =
    countWordShapeStats(words);
  if (alphaWordCount < POST_REFERENCES_UNNUMBERED_HEADING_MIN_ALPHA_WORDS)
    return undefined;
  if (
    titleCaseWordCount / alphaWordCount <
    POST_REFERENCES_UNNUMBERED_HEADING_MIN_TITLE_CASE_RATIO
  ) {
    return undefined;
  }
  const alphaCharCount = normalized.replace(/[^\p{L}]/gu, "").length;
  const nonSpaceCharCount = normalized.replace(/\s/g, "").length;
  if (
    alphaCharCount / Math.max(nonSpaceCharCount, 1) <
    POST_REFERENCES_UNNUMBERED_HEADING_MIN_ALPHA_CHAR_RATIO
  ) {
    return undefined;
  }
  if (meaningfulWordCount === 0) return undefined;

  return { level: POST_REFERENCES_UNNUMBERED_HEADING_LEVEL, text: normalized };
}

function isSemanticHeadingText(text: string): boolean {
  const normalized = normalizeSpacing(text);
  return (
    detectNumberedHeadingLevel(normalized) !== undefined ||
    detectNamedSectionHeadingLevel(normalized) !== undefined ||
    detectBackMatterHeadingLevel(normalized) !== undefined
  );
}

function isMetadataOrSemanticHeadingText(text: string): boolean {
  return containsDocumentMetadata(text) || isSemanticHeadingText(text);
}

function consumeWrappedNumberedHeadingContinuation(
  lines: TextLine[],
  headingStartIndex: number,
  headingLine: TextLine,
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
    if (
      isNumberedHeadingContinuationLine(
        candidate,
        previousPartLine,
        headingLine,
      )
    ) {
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
): boolean {
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return false;
  if (isMetadataOrSemanticHeadingText(normalized)) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;
  if (/[.!?]$/.test(normalized)) return false;
  if (normalized.split(/\s+/).length > MAX_NUMBERED_HEADING_CONTINUATION_WORDS)
    return false;
  if (line.estimatedWidth > headingLine.estimatedWidth) return false;
  if (
    Math.abs(line.fontSize - headingLine.fontSize) >
    NUMBERED_HEADING_CONTINUATION_MAX_FONT_DELTA
  ) {
    return false;
  }
  const maxVerticalGap = getFontScaledVerticalGapLimit(
    headingLine.fontSize,
    NUMBERED_HEADING_CONTINUATION_MAX_VERTICAL_GAP_RATIO,
  );
  return hasDescendingVerticalGapWithinLimit(
    previousPartLine,
    line,
    maxVerticalGap,
  );
}

function isAlignedWithNumberedHeadingColumn(
  line: TextLine,
  headingLine: TextLine,
): boolean {
  const centerOffset = Math.abs(
    getLineCenter(line) - getLineCenter(headingLine),
  );
  const leftOffset = Math.abs(line.x - headingLine.x);
  return (
    centerOffset <=
      headingLine.pageWidth *
        NUMBERED_HEADING_CONTINUATION_MAX_CENTER_OFFSET_RATIO ||
    leftOffset <=
      headingLine.pageWidth *
        NUMBERED_HEADING_CONTINUATION_MAX_LEFT_OFFSET_RATIO
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
    isTitleContinuationLine(
      lines[startIndex - 1],
      previousUpperLine,
      titleLine,
      "before",
    )
  ) {
    startIndex -= 1;
    parts.unshift(lines[startIndex].text);
    previousUpperLine = lines[startIndex];
  }

  let nextIndex = titleIndex + 1;
  let previousLowerLine = titleLine;
  while (
    nextIndex < lines.length &&
    isTitleContinuationLine(
      lines[nextIndex],
      previousLowerLine,
      titleLine,
      "after",
    )
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
  const yDelta = getTitleContinuationVerticalDelta(
    line,
    previousTitleLine,
    text,
    direction,
  );
  if (yDelta === undefined) return false;
  if (!isWithinTitleContinuationSpacing(line, titleLine, yDelta)) return false;
  return isTitleContinuationAligned(line, titleLine);
}

function isEligibleTitleContinuationText(text: string): boolean {
  if (text.length === 0) return false;
  if (isMetadataOrSemanticHeadingText(text)) return false;
  const words = splitWords(text);
  const hasEnoughWords =
    words.length >= TITLE_CONTINUATION_MIN_WORD_COUNT ||
    isLikelyShortTitleContinuation(words);
  if (!hasEnoughWords) return false;
  return true;
}

function getTitleContinuationVerticalDelta(
  line: TextLine,
  previousTitleLine: TextLine,
  text: string,
  direction: "before" | "after",
): number | undefined {
  if (direction === "after" && /[.!?:]$/.test(previousTitleLine.text.trim()))
    return undefined;
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
  return (
    Math.abs(line.fontSize - titleLine.fontSize) <=
    TITLE_CONTINUATION_MAX_FONT_DELTA
  );
}

function isTitleContinuationAligned(
  line: TextLine,
  titleLine: TextLine,
): boolean {
  const titleCenter = getLineCenter(titleLine);
  const lineCenter = getLineCenter(line);
  const maxCenterOffset =
    titleLine.pageWidth * TITLE_CONTINUATION_MAX_CENTER_OFFSET_RATIO;
  const maxLeftOffset =
    titleLine.pageWidth * TITLE_CONTINUATION_MAX_LEFT_OFFSET_RATIO;
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

function getFontScaledVerticalGapLimit(
  fontSize: number,
  ratio: number,
): number {
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

function isDisallowedPageWrapColumnTransition(
  previousLine: TextLine,
  line: TextLine,
): boolean {
  if (previousLine.column === undefined || line.column === undefined)
    return false;
  if (previousLine.column === "right" && line.column === "left") return false;
  return previousLine.column !== line.column;
}

function renderBulletList(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
): { htmlLines: string[]; nextIndex: number } | undefined {
  if (parseBulletListItemText(lines[startIndex].text) === undefined)
    return undefined;
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
    htmlLines: [
      "<ul>",
      ...listItems.map((item) => `<li>${escapeHtml(item)}</li>`),
      "</ul>",
    ],
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
  while (
    index < lines.length &&
    isBulletListContinuation(lines[index], itemStartLine, titleLine)
  ) {
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
  if (!BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(startNormalized))
    return undefined;

  const items: ReferenceListItem[] = [];
  let index = startIndex;
  let previousStartLine: TextLine | undefined;

  while (index < lines.length) {
    const normalized = normalizeSpacing(lines[index].text);
    if (!BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(normalized)) break;

    // Start a new reference entry — collect its text and continuation lines
    const parts = [normalized];
    const startLine = lines[index];
    let nextIndex = index + 1;

    while (nextIndex < lines.length) {
      const candidate = lines[nextIndex];
      const candidateNormalized = normalizeSpacing(candidate.text);
      if (candidateNormalized.length === 0) {
        nextIndex += 1;
        continue;
      }
      // Stop at the next reference entry
      if (BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(candidateNormalized))
        break;
      if (
        isAboveCurrentReferenceStart(candidate, startLine) &&
        tryBackfillPreviousReferenceTail(
          items[items.length - 1],
          previousStartLine,
          candidate,
          candidateNormalized,
        )
      ) {
        nextIndex += 1;
        continue;
      }
      // Stop at headings
      if (
        detectHeadingCandidate(
          candidate,
          bodyFontSize,
          hasDottedSubsectionHeadings,
        ) !== undefined
      )
        break;
      if (candidate === titleLine) break;
      // Skip cross-column lines (e.g., right column content interleaved with left column references)
      if (isCrossColumnPair(lines[index], candidate)) {
        nextIndex += 1;
        continue;
      }
      // Stop at footnote-only markers (e.g., page numbers)
      if (FOOTNOTE_NUMERIC_MARKER_ONLY_PATTERN.test(candidateNormalized)) break;
      // Font size must be similar to the entry start
      if (
        Math.abs(candidate.fontSize - startLine.fontSize) >
        REFERENCE_ENTRY_CONTINUATION_MAX_FONT_DELTA
      )
        break;
      appendBodyParagraphPart(parts, candidateNormalized);
      nextIndex += 1;
    }

    const itemText = normalizeSpacing(parts.join(" "));
    items.push({
      text: itemText,
      marker: parseReferenceListMarker(itemText),
      sourceOrder: items.length,
    });
    previousStartLine = startLine;
    index = nextIndex;
  }

  if (items.length < REFERENCE_LIST_MIN_ITEMS) return undefined;
  const orderedItems = reorderReferenceItemsByMarkerWhenInterleaved(items);

  return {
    htmlLines: [
      "<ol>",
      ...orderedItems.map(
        (item) => `<li>${normalizeReferenceListItemHtml(item.text)}</li>`,
      ),
      "</ol>",
    ],
    nextIndex: index,
  };
}

function isAboveCurrentReferenceStart(
  candidate: TextLine,
  startLine: TextLine,
): boolean {
  return (
    candidate.pageIndex === startLine.pageIndex &&
    candidate.y > startLine.y + Math.max(0.5, startLine.fontSize * 0.25)
  );
}

function tryBackfillPreviousReferenceTail(
  previousItem: ReferenceListItem | undefined,
  previousStartLine: TextLine | undefined,
  candidate: TextLine,
  candidateText: string,
): boolean {
  if (!previousItem || !previousStartLine) return false;
  if (isCrossColumnPair(previousStartLine, candidate)) return false;
  if (
    candidate.y >
    previousStartLine.y + Math.max(0.5, previousStartLine.fontSize * 0.25)
  ) {
    return false;
  }
  if (
    previousStartLine.y - candidate.y >
    Math.max(
      12,
      previousStartLine.fontSize * REFERENCE_ENTRY_CONTINUATION_MAX_VERTICAL_GAP_RATIO,
    )
  ) {
    return false;
  }
  if (
    Math.abs(candidate.fontSize - previousStartLine.fontSize) >
    REFERENCE_ENTRY_CONTINUATION_MAX_FONT_DELTA
  ) {
    return false;
  }

  previousItem.text = normalizeSpacing(`${previousItem.text} ${candidateText}`);
  return true;
}

function normalizeReferenceListItemHtml(text: string): string {
  return escapeHtml(normalizeReferenceListSoftHyphenArtifacts(text))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll(/[“”]/g, '"')
    .replaceAll(/<\s*\/\s*(em|span)\s*>/giu, "</$1>")
    .replaceAll(/<\s*em\s*>/giu, "<em>")
    .replaceAll(
      /<\s*span\s+class\s*=\s*(?:"([^"]+)"|'([^']+)')\s*>/giu,
      (_match, doubleQuotedClassName, singleQuotedClassName) => {
        const className = (
          doubleQuotedClassName ??
          singleQuotedClassName ??
          ""
        ).trim();
        return className.length > 0 ? `<span class="${className}">` : "<span>";
      },
    )
    .replaceAll(/<\s*span\s*>/giu, "<span>")
    .replaceAll(/<em>\s+/giu, "<em>")
    .replaceAll(/\s+<\/em>/giu, "</em>")
    .replaceAll(/\s+<\/span>/giu, "</span>");
}

function normalizeReferenceListSoftHyphenArtifacts(text: string): string {
  return text.replaceAll(
    REFERENCE_IN_WORD_HYPHEN_PATTERN,
    (match, leftRaw, rightRaw) => {
      const left = String(leftRaw);
      const right = String(rightRaw);
      if (!shouldDropReferenceInWordHyphen(left, right)) return match;
      return `${left}${right}`;
    },
  );
}

function shouldDropReferenceInWordHyphen(left: string, right: string): boolean {
  const rightLower = right.toLowerCase();
  if (right !== rightLower) return false;
  if (REFERENCE_IN_WORD_HYPHEN_RIGHT_STOP_WORDS.has(rightLower)) return false;

  const leftLower = left.toLowerCase();
  const leftIsLowerOrTitleCase = left === leftLower || isTitleCaseWord(left);
  if (
    leftIsLowerOrTitleCase &&
    HYPHEN_WRAP_SOFT_CONTINUATION_FRAGMENT_PATTERN.test(rightLower)
  ) {
    return true;
  }

  if (right.length > 3) return false;
  if (!REFERENCE_IN_WORD_HYPHEN_SHORT_RIGHT_VOWEL_PATTERN.test(right))
    return false;
  if (REFERENCE_IN_WORD_HYPHEN_SHORT_LEFT_PREFIXES.has(leftLower)) return false;
  if (left.length >= 5) return true;
  if (left.length === 2 && left === leftLower) return true;
  if (left.length >= 2 && left.length <= 3 && isTitleCaseWord(left))
    return true;
  return false;
}

function isTitleCaseWord(value: string): boolean {
  return /^[A-Z][a-z]+$/.test(value);
}

function parseReferenceListMarker(text: string): number | undefined {
  const match = /^[[](\d{1,4})[\]]/.exec(text);
  if (!match) return undefined;
  const marker = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(marker) ? marker : undefined;
}

function reorderReferenceItemsByMarkerWhenInterleaved(
  items: ReferenceListItem[],
): ReferenceListItem[] {
  if (items.some((item) => item.marker === undefined)) return items;
  const markers = items.map((item) => item.marker ?? 0);
  if (!hasNumericReferenceOrderInversion(markers)) return items;
  if (!hasLikelySequentialReferenceRange(markers)) return items;

  return [...items].sort(
    (left, right) =>
      (left.marker ?? 0) - (right.marker ?? 0) ||
      left.sourceOrder - right.sourceOrder,
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
  return (
    missingMarkerCount <= Math.max(3, Math.floor(uniqueMarkers.length * 0.35))
  );
}

function parseInlineAcknowledgementsHeading(
  text: string,
): { heading: string; body: string; level: number } | undefined {
  const normalized = normalizeSpacing(text);
  const match = INLINE_ACKNOWLEDGEMENTS_HEADING_PATTERN.exec(normalized);
  if (!match) return undefined;

  const headingText = normalizeSpacing(match[1]);
  const bodyText = match[2].trim();
  if (
    !hasInlineHeadingBodyText(bodyText, INLINE_ACKNOWLEDGEMENTS_MIN_BODY_LENGTH)
  )
    return undefined;
  return { heading: headingText, body: bodyText, level: 2 };
}

function parseInlineNamedSectionHeading(
  text: string,
): { heading: string; body: string; level: number } | undefined {
  const normalized = normalizeSpacing(text);
  const match = INLINE_NAMED_SECTION_HEADING_PATTERN.exec(normalized);
  if (!match) return undefined;

  const headingText = normalizeSpacing(match[1]);
  const separator = match[2] ?? "";
  if (
    headingText.length === 0 ||
    isStandaloneAcknowledgementsHeading(headingText)
  ) {
    return undefined;
  }
  const namedHeading = detectNamedSectionHeadingLevel(headingText);

  const bodyText = match[3].trim();
  if (
    !hasInlineHeadingBodyText(
      bodyText,
      INLINE_NAMED_SECTION_HEADING_MIN_BODY_LENGTH,
    )
  ) {
    return undefined;
  }
  if (namedHeading !== undefined) {
    return { heading: headingText, body: bodyText, level: namedHeading.level };
  }
  if (!separator.includes(":")) return undefined;

  const genericSubsectionLevel = detectInlineGenericSubsectionHeadingLevel(
    headingText,
  );
  if (genericSubsectionLevel === undefined) return undefined;
  return { heading: headingText, body: bodyText, level: genericSubsectionLevel };
}

function parseInlineHeadingParagraph(
  text: string,
): { heading: string; body: string; level: number } | undefined {
  return (
    parseInlineAcknowledgementsHeading(text) ??
    parseInlineNamedSectionHeading(text)
  );
}

function detectInlineGenericSubsectionHeadingLevel(
  headingText: string,
): number | undefined {
  const normalized = normalizeSpacing(headingText);
  if (!isInlineGenericSubsectionHeadingText(normalized)) return undefined;
  const words = splitWords(normalized);
  if (!hasInlineGenericSubsectionHeadingWordCount(words)) return undefined;
  if (!hasInlineGenericSubsectionHeadingWordCasing(words)) return undefined;

  const stats = countWordShapeStats(words);
  if (!hasInlineGenericSubsectionHeadingWordStats(stats)) return undefined;

  return 3;
}

function isInlineGenericSubsectionHeadingText(normalized: string): boolean {
  if (
    normalized.length < INLINE_GENERIC_SUBSECTION_HEADING_MIN_LENGTH ||
    normalized.length > INLINE_GENERIC_SUBSECTION_HEADING_MAX_LENGTH
  ) {
    return false;
  }
  if (containsDocumentMetadata(normalized)) return false;
  if (/\d/.test(normalized)) return false;
  if (
    INLINE_GENERIC_SUBSECTION_HEADING_DISALLOWED_PUNCTUATION_PATTERN.test(
      normalized,
    )
  ) {
    return false;
  }
  if (
    INLINE_GENERIC_SUBSECTION_HEADING_TERMINAL_PUNCTUATION_PATTERN.test(
      normalized,
    )
  ) {
    return false;
  }
  return /^\p{Lu}/u.test(normalized);
}

function hasInlineGenericSubsectionHeadingWordCount(words: string[]): boolean {
  return (
    words.length >= INLINE_GENERIC_SUBSECTION_HEADING_MIN_WORDS &&
    words.length <= INLINE_GENERIC_SUBSECTION_HEADING_MAX_WORDS
  );
}

function hasInlineGenericSubsectionHeadingWordCasing(words: string[]): boolean {
  for (const rawWord of words) {
    const word = stripWordBoundaryPunctuation(rawWord);
    const alphaOnly = word.replace(/[^\p{L}]/gu, "");
    if (alphaOnly.length === 0) continue;
    if (/^\p{Lu}/u.test(word)) continue;
    if (
      INLINE_GENERIC_SUBSECTION_HEADING_CONNECTOR_WORDS.has(
        alphaOnly.toLowerCase(),
      )
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function hasInlineGenericSubsectionHeadingWordStats(stats: {
  alphaWordCount: number;
  titleCaseWordCount: number;
  meaningfulWordCount: number;
}): boolean {
  if (
    stats.alphaWordCount < INLINE_GENERIC_SUBSECTION_HEADING_MIN_ALPHA_WORDS
  ) {
    return false;
  }
  if (
    stats.meaningfulWordCount <
    INLINE_GENERIC_SUBSECTION_HEADING_MIN_MEANINGFUL_WORDS
  ) {
    return false;
  }
  return (
    stats.titleCaseWordCount / stats.alphaWordCount >=
    INLINE_GENERIC_SUBSECTION_HEADING_MIN_TITLE_CASE_RATIO
  );
}

function isResearchInContextHeadingText(text: string): boolean {
  return (
    normalizeSpacing(text).toLowerCase() === RESEARCH_IN_CONTEXT_HEADING_TEXT
  );
}

function isLikelyResearchContextSubheadingText(text: string): boolean {
  const normalized = normalizeSpacing(text);
  if (normalized.length < 12 || normalized.length > 100) return false;
  if (RESEARCH_CONTEXT_SUBHEADING_DISALLOWED_CHARACTER_PATTERN.test(normalized))
    return false;
  if (RESEARCH_CONTEXT_SUBHEADING_TERMINAL_PUNCTUATION_PATTERN.test(normalized))
    return false;
  if (/\d/.test(normalized)) return false;

  const words = splitWords(normalized);
  if (
    words.length < RESEARCH_CONTEXT_SUBHEADING_MIN_WORDS ||
    words.length > RESEARCH_CONTEXT_SUBHEADING_MAX_WORDS
  ) {
    return false;
  }
  const firstWord = stripWordBoundaryPunctuation(words[0] ?? "");
  if (!firstWord || !/^\p{Lu}/u.test(firstWord)) return false;

  const { alphaWordCount, meaningfulWordCount } = countWordShapeStats(words);

  if (alphaWordCount < RESEARCH_CONTEXT_SUBHEADING_MIN_ALPHA_WORDS)
    return false;
  return meaningfulWordCount >= 2;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: subheading detection uses geometric and textual guards together.
function consumeResearchContextSubheading(
  lines: TextLine[],
  lineIndex: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  typicalWidth: number,
): { text: string; nextIndex: number } | undefined {
  const line = lines[lineIndex];
  if (!line) return undefined;
  const normalized = parseParagraphMergeCandidateText(line, {
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
  });
  if (normalized === undefined) return undefined;
  if (!isLikelyResearchContextSubheadingText(normalized)) return undefined;
  if (
    line.estimatedWidth >
    typicalWidth * RESEARCH_CONTEXT_SUBHEADING_MAX_WIDTH_RATIO
  ) {
    return undefined;
  }

  const previousLine = lines[lineIndex - 1];
  if (previousLine && previousLine.pageIndex === line.pageIndex) {
    const previousNormalized = normalizeSpacing(previousLine.text);
    const previousIsHeading =
      detectHeadingCandidate(
        previousLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      ) !== undefined ||
      parseInlineHeadingParagraph(previousNormalized) !== undefined;
    if (
      !previousIsHeading &&
      !RESEARCH_CONTEXT_SUBHEADING_PREVIOUS_END_PATTERN.test(previousNormalized)
    ) {
      return undefined;
    }
  }

  const nextLine = lines[lineIndex + 1];
  if (!nextLine || nextLine.pageIndex !== line.pageIndex) return undefined;
  if (isCrossColumnPair(line, nextLine)) return undefined;
  if (
    Math.abs(nextLine.fontSize - line.fontSize) >
    RESEARCH_CONTEXT_SUBHEADING_MAX_FONT_DELTA
  ) {
    return undefined;
  }
  const maxVerticalGap = getFontScaledVerticalGapLimit(
    Math.max(line.fontSize, nextLine.fontSize),
    RESEARCH_CONTEXT_SUBHEADING_MAX_VERTICAL_GAP_RATIO,
  );
  if (!hasDescendingVerticalGapWithinLimit(line, nextLine, maxVerticalGap))
    return undefined;
  if (
    Math.abs(nextLine.x - line.x) >
    line.pageWidth * RESEARCH_CONTEXT_SUBHEADING_MAX_LEFT_OFFSET_RATIO
  ) {
    return undefined;
  }

  const nextNormalized = parseParagraphMergeCandidateText(nextLine, {
    samePageAs: line,
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
  });
  if (nextNormalized === undefined) return undefined;
  if (
    nextLine.estimatedWidth <
    typicalWidth * RESEARCH_CONTEXT_SUBHEADING_MIN_NEXT_WIDTH_RATIO
  ) {
    return undefined;
  }
  if (splitWords(nextNormalized).length < RESEARCH_CONTEXT_SUBHEADING_MIN_NEXT_WORDS)
    return undefined;

  return { text: normalized, nextIndex: lineIndex + 1 };
}

function hasInlineHeadingBodyText(text: string, minLength: number): boolean {
  return text.length >= minLength && /[A-Za-z]/.test(text);
}

function isStandaloneAcknowledgementsHeading(text: string): boolean {
  return STANDALONE_ACKNOWLEDGEMENTS_HEADING_PATTERN.test(
    normalizeSpacing(text),
  );
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
      !isAcknowledgementsBodyContinuationLine(
        candidate,
        previousLine,
        previousText,
        headingLine,
      )
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
  if (!hasDescendingVerticalGapWithinLimit(previousLine, line, maxVerticalGap))
    return false;
  if (
    previousLine.estimatedWidth <
    previousLine.pageWidth * HYPHEN_WRAP_MIN_LINE_WIDTH_RATIO
  ) {
    return false;
  }
  if (
    line.estimatedWidth <
    line.pageWidth * HYPHEN_WRAP_MIN_CONTINUATION_WIDTH_RATIO
  ) {
    return false;
  }

  const centerOffset = Math.abs(
    getLineCenter(line) - getLineCenter(previousLine),
  );
  const leftOffset = Math.abs(line.x - previousLine.x);
  return (
    centerOffset <= line.pageWidth * HYPHEN_WRAP_MAX_CENTER_OFFSET_RATIO ||
    leftOffset <= line.pageWidth * HYPHEN_WRAP_MAX_LEFT_OFFSET_RATIO
  );
}

function mergeHyphenWrappedTexts(
  currentText: string,
  nextLineText: string,
): string {
  const trimmedLeft = currentText.trimEnd();
  const right = nextLineText.trimStart().replace(/^\s*-\s*/, "");
  if (shouldDropHyphenForSoftWrap(trimmedLeft, right)) {
    const joinedWithoutHyphen = trimmedLeft.replace(/\s*-\s*$/, "");
    return normalizeSpacing(`${joinedWithoutHyphen}${right}`);
  }
  const joinedWithHyphen = trimmedLeft.replace(/\s*-\s*$/, "-");
  return normalizeSpacing(`${joinedWithHyphen}${right}`);
}

function shouldDropHyphenForSoftWrap(
  leftText: string,
  rightText: string,
): boolean {
  const leftFragmentMatch = /([A-Za-z]+)\s*-\s*$/.exec(leftText);
  const rightFragmentMatch = /^([A-Za-z]+)/.exec(rightText);
  if (!leftFragmentMatch || !rightFragmentMatch) return false;

  const leftFragment = leftFragmentMatch[1] ?? "";
  const rightFragment = rightFragmentMatch[1] ?? "";
  if (leftFragment !== leftFragment.toLowerCase()) return false;
  if (rightFragment !== rightFragment.toLowerCase()) return false;
  if (
    leftFragment.length < 2 ||
    rightFragment.length < HYPHEN_WRAP_SOFT_CONTINUATION_MIN_FRAGMENT_LENGTH
  ) {
    return false;
  }
  if (rightFragment.length <= HYPHEN_WRAP_SOFT_SHORT_CONTINUATION_MAX_LENGTH)
    return (
      leftFragment.length >= HYPHEN_WRAP_SOFT_CONTINUATION_MIN_FRAGMENT_LENGTH
    );
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
  if (
    line.estimatedWidth >
    line.pageWidth * SAME_ROW_SENTENCE_SPLIT_MAX_START_WIDTH_RATIO
  ) {
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
    Math.max(startLine.fontSize, line.fontSize) *
    SAME_ROW_SENTENCE_SPLIT_MAX_VERTICAL_DELTA_FONT_RATIO;
  if (Math.abs(previousLine.y - line.y) > maxYDelta) return false;
  if (
    Math.abs(line.fontSize - startLine.fontSize) >
    SAME_ROW_SENTENCE_SPLIT_MAX_FONT_DELTA
  ) {
    return false;
  }

  // Check that the continuation starts near where the previous line ends.
  // Use the gap between the end of the previous line and the start of the
  // continuation, which is robust to multi-column layouts where page-width
  // relative x-delta checks are too restrictive.
  const previousLineEnd = previousLine.x + previousLine.estimatedWidth;
  const gapFromPreviousEnd = line.x - previousLineEnd;
  const maxGap =
    Math.max(startLine.fontSize, line.fontSize) *
    SAME_ROW_SENTENCE_SPLIT_MAX_GAP_FONT_RATIO;
  const maxOverlap =
    Math.max(startLine.fontSize, line.fontSize) *
    SAME_ROW_SENTENCE_SPLIT_MAX_OVERLAP_FONT_RATIO;
  if (gapFromPreviousEnd > maxGap || gapFromPreviousEnd < -maxOverlap)
    return false;
  // The continuation must be to the right of the previous line's start.
  if (line.x <= previousLine.x) return false;
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
  if (options.samePageAs && line.pageIndex !== options.samePageAs.pageIndex)
    return undefined;
  const { titleLine, bodyFontSize, hasDottedSubsectionHeadings, startPattern } =
    options;
  if (line === titleLine) return undefined;
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return undefined;
  if (startPattern !== undefined && !startPattern.test(normalized))
    return undefined;
  if (containsDocumentMetadata(normalized)) return undefined;
  if (parseBulletListItemText(normalized) !== undefined) return undefined;
  if (parseInlineAcknowledgementsHeading(normalized) !== undefined)
    return undefined;
  if (parseInlineNamedSectionHeading(normalized) !== undefined)
    return undefined;
  if (parseStandaloneUrlLine(normalized) !== undefined) return undefined;
  if (
    detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !==
    undefined
  ) {
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
  if (!isWithinAcknowledgementsBodyGeometry(line, headingLine))
    return undefined;
  return normalized;
}

function isWithinAcknowledgementsBodyGeometry(
  line: TextLine,
  headingLine: TextLine,
): boolean {
  if (
    Math.abs(line.fontSize - headingLine.fontSize) >
    ACKNOWLEDGEMENTS_MAX_FONT_DELTA
  ) {
    return false;
  }
  const verticalGap = headingLine.y - line.y;
  const maxVerticalGap = getFontScaledVerticalGapLimit(
    headingLine.fontSize,
    ACKNOWLEDGEMENTS_MAX_VERTICAL_GAP_RATIO,
  );
  if (verticalGap < 0 || verticalGap > maxVerticalGap) return false;
  return (
    line.x >=
    headingLine.x - line.pageWidth * ACKNOWLEDGEMENTS_MAX_LEFT_OFFSET_RATIO
  );
}

function isAcknowledgementsBodyLine(
  line: TextLine,
  headingLine: TextLine,
): boolean {
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
  if (!ACKNOWLEDGEMENTS_CONTINUATION_START_PATTERN.test(normalized))
    return false;
  if (
    Math.abs(line.fontSize - previousLine.fontSize) >
    ACKNOWLEDGEMENTS_MAX_FONT_DELTA
  ) {
    return false;
  }
  const maxVerticalGap = getFontScaledVerticalGapLimit(
    previousLine.fontSize,
    ACKNOWLEDGEMENTS_MAX_VERTICAL_GAP_RATIO,
  );
  if (!hasDescendingVerticalGapWithinLimit(previousLine, line, maxVerticalGap))
    return false;
  return (
    Math.abs(line.x - headingLine.x) <= maxLeftOffset ||
    Math.abs(line.x - previousLine.x) <= maxLeftOffset
  );
}

function renderStandaloneLinkParagraph(
  lines: TextLine[],
  startIndex: number,
): { html: string; nextIndex: number; consumedIndexes: number[] } | undefined {
  const firstLineMarker = parseStandaloneNumericFootnoteMarker(
    lines[startIndex].text,
  );
  const linkStartIndex = firstLineMarker ? startIndex + 1 : startIndex;
  const standaloneLink = consumeStandaloneUrl(
    lines,
    linkStartIndex,
    firstLineMarker ? lines[startIndex] : undefined,
  );
  if (standaloneLink === undefined) return undefined;

  const marker = firstLineMarker ?? standaloneLink.marker;

  return {
    html: renderStandaloneLinkHtml(standaloneLink, marker),
    nextIndex:
      standaloneLink.consumedIndexes.length > 0
        ? standaloneLink.consumedIndexes[
            standaloneLink.consumedIndexes.length - 1
          ] + 1
        : linkStartIndex + 1,
    consumedIndexes: firstLineMarker
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
):
  | {
      url: string;
      trailingPunctuation: string;
      consumedIndexes: number[];
      marker?: string;
    }
  | undefined {
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
  return { ...resolved, marker: baseUrl.marker };
}

function isSamePage(
  line: TextLine,
  referenceLine: TextLine | undefined,
): boolean {
  return (
    referenceLine === undefined || line.pageIndex === referenceLine.pageIndex
  );
}

type UrlContinuationResult = {
  url: string;
  trailingPunctuation: string;
  consumedIndexes: number[];
};

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

  for (
    let continuationIndex = urlStartIndex + 1;
    continuationIndex < maxScanIndex;
    continuationIndex += 1
  ) {
    const line = lines[continuationIndex];
    if (
      !line ||
      !isSamePage(line, expectedPageLine) ||
      !isSamePage(line, urlLine)
    )
      break;

    const result = tryMatchUrlContinuationLine(
      line,
      urlLine,
      baseUrl,
      maxVerticalGap,
      allowPathWithoutSlash,
      continuationIndex,
    );
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

  const continuation = parseUrlContinuationLine(line.text, {
    allowPathWithoutSlash,
  });
  if (continuation === undefined) return undefined;
  if (
    !continuation.hasSlash &&
    !isStandaloneUrlContinuationAligned(line, urlLine)
  )
    return undefined;

  const merged = `${baseUrl}${continuation.path}`;
  if (!isValidHttpUrl(merged)) return undefined;
  return {
    url: merged,
    trailingPunctuation: continuation.trailingPunctuation,
    consumedIndexes: [continuationIndex],
  };
}

function isStandaloneUrlContinuationAligned(
  line: TextLine,
  urlLine: TextLine,
): boolean {
  return (
    Math.abs(line.x - urlLine.x) <=
    line.pageWidth * STANDALONE_URL_CONTINUATION_MAX_LEFT_OFFSET_RATIO
  );
}

function parseStandaloneNumericFootnoteMarker(
  text: string,
): string | undefined {
  const normalized = normalizeSpacing(text);
  if (!FOOTNOTE_NUMERIC_MARKER_ONLY_PATTERN.test(normalized)) return undefined;
  return normalized;
}

function parseStandaloneUrlLine(
  text: string,
):
  | { url: string; trailingPunctuation: string; marker: string | undefined }
  | undefined {
  const normalized = normalizeTrailingPunctuationSpacing(
    normalizeSpacing(text),
  );
  const match = STANDALONE_URL_LINE_PATTERN.exec(normalized);
  if (!match) return undefined;
  const marker = match[1];
  const url = match[2];
  if (!isValidHttpUrl(url)) return undefined;
  return { url, trailingPunctuation: match[3] ?? "", marker };
}

function parseUrlContinuationLine(
  text: string,
  options?: { allowPathWithoutSlash?: boolean },
):
  | { path: string; trailingPunctuation: string; hasSlash: boolean }
  | undefined {
  const normalized = normalizeTrailingPunctuationSpacing(
    normalizeSpacing(text),
  );
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

  const maxScanIndex = Math.min(
    lines.length,
    startIndex + NUMBERED_CODE_BLOCK_MAX_LOOKAHEAD + 1,
  );
  for (
    let scanIndex = startIndex + 1;
    scanIndex < maxScanIndex;
    scanIndex += 1
  ) {
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
      if (
        !hasDescendingVerticalGapWithinLimit(
          previousSelectedLine,
          candidate.line,
          maxVerticalGap,
        )
      ) {
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
        candidate.parsedNumberedLine.lineNumber >
          expectedNumber + NUMBERED_CODE_BLOCK_MAX_NUMBER_GAP
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
  if (!STRONG_CODE_START_TEXT_PATTERN.test(parsedCodeLine.content))
    return false;
  if (!isLikelyCodeText(parsedCodeLine.content)) return false;
  if (line.fontSize > bodyFontSize * NUMBERED_CODE_BLOCK_MAX_FONT_RATIO)
    return false;
  if (
    detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !==
    undefined
  ) {
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
  if (line.fontSize > bodyFontSize * NUMBERED_CODE_BLOCK_MAX_FONT_RATIO)
    return false;
  if (
    Math.abs(line.fontSize - startLine.fontSize) >
    NUMBERED_CODE_BLOCK_MAX_FONT_DELTA
  )
    return false;
  if (!isAlignedWithNumberedCodeColumn(line, startLine)) return false;
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return false;
  if (containsDocumentMetadata(normalized)) return false;
  if (
    detectHeadingCandidate(line, bodyFontSize, hasDottedSubsectionHeadings) !==
    undefined
  ) {
    return false;
  }
  return true;
}

function isAlignedWithNumberedCodeColumn(
  line: TextLine,
  startLine: TextLine,
): boolean {
  if (line.x < startLine.x - 2) return false;
  return line.x <= startLine.x + NUMBERED_CODE_BLOCK_MAX_LEFT_OFFSET;
}

function isLikelyCodeContinuationText(text: string): boolean {
  if (isLikelyCodeText(text)) return true;
  if (text.length < 2) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (!/[(){}[\].,_]/.test(text)) return false;
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

const COLUMN_WIDTH_SIGNIFICANT_REDUCTION_RATIO = 0.9;

function getTypicalWidth(
  pageTypicalWidths: Map<string, number>,
  line: TextLine,
): number | undefined {
  const pageWidth = pageTypicalWidths.get(typicalWidthKey(line.pageIndex));
  // Use column-specific typical width only when it is significantly lower
  // than the page-wide width (indicating a genuine narrower column).
  // When both are similar, page-wide is more stable for merge decisions.
  if (line.column) {
    const colWidth = pageTypicalWidths.get(
      typicalWidthKey(line.pageIndex, line.column),
    );
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
  return widths[
    Math.floor(widths.length * BODY_PARAGRAPH_TYPICAL_WIDTH_PERCENTILE)
  ];
}

function appendToMapBucket<K>(
  map: Map<K, number[]>,
  key: K,
  value: number,
): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function computePageTypicalBodyWidths(
  lines: TextLine[],
  bodyFontSize: number,
): Map<string, number> {
  const pageWidths = new Map<number, number[]>();
  const colWidths = new Map<string, number[]>();
  for (const line of lines) {
    if (Math.abs(line.fontSize - bodyFontSize) > 1.0) continue;
    if (normalizeSpacing(line.text).length < 20) continue;
    appendToMapBucket(pageWidths, line.pageIndex, line.estimatedWidth);
    if (line.column) {
      appendToMapBucket(
        colWidths,
        typicalWidthKey(line.pageIndex, line.column),
        line.estimatedWidth,
      );
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
      leftWidths &&
      leftWidths.length >= MIN_COLUMN_BODY_LINES_FOR_COLUMN_WIDTH &&
      rightWidths &&
      rightWidths.length >= MIN_COLUMN_BODY_LINES_FOR_COLUMN_WIDTH
    ) {
      result.set(
        typicalWidthKey(pageIndex, "left"),
        widthPercentile(leftWidths),
      );
      result.set(
        typicalWidthKey(pageIndex, "right"),
        widthPercentile(rightWidths),
      );
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
    if (
      Math.abs(line.fontSize - referenceLine.fontSize) >
      LOCAL_FONT_SIZE_MAX_DELTA
    )
      continue;
    if (normalizeSpacing(line.text).length < 20) continue;
    widths.push(line.estimatedWidth);
  }
  if (widths.length < LOCAL_FONT_SIZE_TYPICAL_WIDTH_MIN_LINES) return undefined;
  widths.sort((a, b) => a - b);
  return widths[
    Math.floor(widths.length * BODY_PARAGRAPH_TYPICAL_WIDTH_PERCENTILE)
  ];
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
    if (Math.abs(line.x - referenceLine.x) > LOCAL_COLUMN_REGION_MAX_X_DELTA)
      continue;
    if (Math.abs(line.y - referenceLine.y) > maxYDelta) continue;
    widths.push(line.estimatedWidth);
  }
  if (widths.length < LOCAL_COLUMN_REGION_MIN_LINES) return undefined;
  widths.sort((a, b) => a - b);
  return widths[
    Math.floor(widths.length * BODY_PARAGRAPH_TYPICAL_WIDTH_PERCENTILE)
  ];
}

function consumeBodyParagraph(
  lines: TextLine[],
  startIndex: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
  isInResearchInContextSection: boolean,
  pageTypicalWidths: Map<string, number>,
  consumedBodyLineIndexes: Set<number>,
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
    pageTypicalWidths.has(
      typicalWidthKey(startLine.pageIndex, startLine.column),
    )
  ) {
    const localColTypical = computeLocalColumnRegionTypicalWidth(
      lines,
      startLine,
      bodyFontSize,
    );
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
  if (BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(startNormalized))
    return undefined;
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
    isInResearchInContextSection,
    typicalWidth,
    parts,
    consumedBodyLineIndexes,
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
  if (
    startLine.estimatedWidth >=
    typicalWidth * BODY_PARAGRAPH_FULL_WIDTH_RATIO
  )
    return true;
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
  if (
    startLine.estimatedWidth <
    typicalWidth * BODY_PARAGRAPH_INDENT_LEAD_MIN_WIDTH_RATIO
  ) {
    return false;
  }
  if (!BODY_PARAGRAPH_INDENT_LEAD_START_PATTERN.test(startNormalized))
    return false;
  if (
    splitWords(startNormalized).length <
    BODY_PARAGRAPH_INDENT_LEAD_MIN_WORD_COUNT
  ) {
    return false;
  }

  const previousLine = lines[startIndex - 1];
  if (!previousLine || previousLine.pageIndex !== startLine.pageIndex)
    return false;
  const previousText = normalizeSpacing(previousLine.text);
  if (!INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(previousText))
    return false;

  const continuation = lines[startIndex + 1];
  if (!continuation || continuation.pageIndex !== startLine.pageIndex)
    return false;
  if (isCrossColumnPair(startLine, continuation)) return false;

  const minIndent =
    startLine.pageWidth * BODY_PARAGRAPH_INDENT_LEAD_MIN_X_OFFSET_RATIO;
  const maxIndent =
    startLine.pageWidth * BODY_PARAGRAPH_INDENT_LEAD_MAX_X_OFFSET_RATIO;
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
  isInResearchInContextSection: boolean,
  typicalWidth: number,
  parts: string[],
  consumedBodyLineIndexes: Set<number>,
): number {
  let previousLine = startLine;
  let nextIndex = continuationStartIndex;
  let restartIndex: number | undefined;
  const consumedContinuationIndexes: number[] = [];

  while (nextIndex < lines.length) {
    if (consumedBodyLineIndexes.has(nextIndex)) {
      nextIndex += 1;
      continue;
    }
    const candidate = lines[nextIndex];
    if (!candidate) break;
    if (
      isInResearchInContextSection &&
      consumeResearchContextSubheading(
        lines,
        nextIndex,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
        typicalWidth,
      ) !== undefined
    ) {
      break;
    }
    if (
      shouldSkipDetachedNumericFootnoteMarkerContinuationLine(
        lines,
        nextIndex,
        previousLine,
        startLine,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      )
    ) {
      nextIndex += 1;
      continue;
    }
    const interposedPageWrapContinuation = findInterposedPageWrapContinuation(
      lines,
      nextIndex,
      previousLine,
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    );
    if (interposedPageWrapContinuation !== undefined) {
      restartIndex =
        restartIndex === undefined
          ? interposedPageWrapContinuation.restartIndex
          : Math.min(restartIndex, interposedPageWrapContinuation.restartIndex);
      nextIndex = interposedPageWrapContinuation.continuationIndex;
      continue;
    }

    const sameRowOperatorContinuation =
      consumeSameRowOperatorSplitBodyContinuation(
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
      if (restartIndex !== undefined)
        consumedContinuationIndexes.push(nextIndex);
      nextIndex = sameRowOperatorContinuation.nextIndex;
      continue;
    }

    const inlineMathBridge =
      findBodyParagraphContinuationAfterInlineMathArtifacts(
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
        startLine.estimatedWidth <
          typicalWidth * BODY_PARAGRAPH_FULL_WIDTH_RATIO &&
        startLine.estimatedWidth >=
          typicalWidth *
            BODY_PARAGRAPH_INLINE_MATH_ARTIFACT_LEAD_MIN_WIDTH_RATIO;
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
    if (
      !isBodyParagraphContinuationLine(
        candidate,
        previousLine,
        startLine,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      )
    ) {
      break;
    }

    appendBodyParagraphPart(parts, normalizeSpacing(candidate.text));
    if (restartIndex !== undefined) consumedContinuationIndexes.push(nextIndex);
    previousLine = candidate;
    nextIndex += 1;
    const isFullWidth =
      candidate.estimatedWidth >=
      typicalWidth * BODY_PARAGRAPH_FULL_WIDTH_RATIO;
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
      if (restartIndex !== undefined) {
        consumedContinuationIndexes.push(sameRowContinuation.nextIndex - 1);
      }
      previousLine = sameRowContinuation.line;
      nextIndex = sameRowContinuation.nextIndex;
      continue;
    }
    if (
      shouldContinuePastShortBodyLine(
        candidate,
        lines,
        nextIndex,
        startLine,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      )
    ) {
      continue;
    }
    break;
  }

  if (restartIndex !== undefined) {
    addConsumedIndexes(
      consumedBodyLineIndexes,
      consumedContinuationIndexes,
      restartIndex,
    );
    return restartIndex;
  }
  return nextIndex;
}

function findInterposedPageWrapContinuation(
  lines: TextLine[],
  continuationStartIndex: number,
  previousLine: TextLine,
  startLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): { restartIndex: number; continuationIndex: number } | undefined {
  const firstInterposedLine = lines[continuationStartIndex];
  if (!firstInterposedLine) return undefined;
  if (firstInterposedLine.pageIndex !== previousLine.pageIndex + 1)
    return undefined;

  const targetPageIndex = firstInterposedLine.pageIndex;
  const maxScanIndex = Math.min(
    lines.length,
    continuationStartIndex + BODY_PARAGRAPH_PAGE_WRAP_INTERPOSED_MAX_LOOKAHEAD,
  );
  for (
    let scanIndex = continuationStartIndex;
    scanIndex < maxScanIndex;
    scanIndex += 1
  ) {
    const candidate = lines[scanIndex];
    if (!candidate || candidate.pageIndex !== targetPageIndex) break;

    if (
      isRelaxedBodyParagraphPageWrapContinuationLine(
        candidate,
        previousLine,
        startLine,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      )
    ) {
      if (scanIndex === continuationStartIndex) return undefined;
      return {
        restartIndex: continuationStartIndex,
        continuationIndex: scanIndex,
      };
    }
    if (
      !isSkippableInterposedPageWrapLine(
        lines,
        scanIndex,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      )
    ) {
      break;
    }
  }
  return undefined;
}

function isSkippableInterposedPageWrapLine(
  lines: TextLine[],
  lineIndex: number,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  const line = lines[lineIndex];
  if (!line) return false;
  const normalized = normalizeSpacing(line.text);
  if (normalized.length === 0) return true;
  if (
    CAPTION_START_PATTERN.test(normalized) ||
    STANDALONE_CAPTION_LABEL_PATTERN.test(normalized)
  ) {
    return true;
  }
  return (
    shouldSkipStandaloneFigurePanelLabel(
      lines,
      lineIndex,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    ) ||
    shouldSkipStandaloneFigureDiagramArtifact(
      lines,
      lineIndex,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    )
  );
}

function isRelaxedBodyParagraphPageWrapContinuationLine(
  line: TextLine,
  previousLine: TextLine,
  startLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  if (
    isBodyParagraphPageWrapContinuationLine(
      line,
      previousLine,
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    )
  ) {
    return true;
  }
  if (line.pageIndex !== previousLine.pageIndex + 1) return false;
  if (isDisallowedPageWrapColumnTransition(previousLine, line)) return false;

  const previousText = normalizeSpacing(previousLine.text);
  if (INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(previousText))
    return false;

  const normalized = parseParagraphMergeCandidateText(line, {
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
    startPattern: BODY_PARAGRAPH_PAGE_WRAP_CONTINUATION_START_PATTERN,
  });
  if (normalized === undefined) return false;
  if (
    BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(normalized) &&
    !isCitationLeadingContinuationLine(normalized, previousLine)
  ) {
    return false;
  }
  if (STANDALONE_CAPTION_LABEL_PATTERN.test(normalized)) return false;
  if (
    Math.abs(line.fontSize - startLine.fontSize) > BODY_PARAGRAPH_MAX_FONT_DELTA
  )
    return false;

  const previousYRatio = previousLine.y / previousLine.pageHeight;
  if (previousYRatio > BODY_PARAGRAPH_PAGE_WRAP_PREVIOUS_BOTTOM_MAX_RATIO)
    return false;
  const nextYRatio = line.y / line.pageHeight;
  if (nextYRatio < BODY_PARAGRAPH_PAGE_WRAP_NEXT_TOP_MIN_RATIO * 0.8)
    return false;

  const centerOffset = Math.abs(
    getLineCenter(line) - getLineCenter(previousLine),
  );
  const leftOffset = Math.abs(line.x - previousLine.x);
  const isRightToLeftPageWrap =
    previousLine.column === "right" && line.column === "left";
  if (
    !isRightToLeftPageWrap &&
    centerOffset >
      line.pageWidth * BODY_PARAGRAPH_PAGE_WRAP_MAX_CENTER_OFFSET_RATIO &&
    leftOffset > line.pageWidth * BODY_PARAGRAPH_PAGE_WRAP_MAX_LEFT_OFFSET_RATIO
  ) {
    return false;
  }
  return true;
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
  if (
    INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(
      normalizeSpacing(currentLine.text),
    )
  ) {
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
  if (
    startLine.estimatedWidth <
    typicalWidth * BODY_PARAGRAPH_SHORT_LEAD_MIN_WIDTH_RATIO
  ) {
    return false;
  }
  if (INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(startNormalized))
    return false;
  if (
    splitWords(startNormalized).length <
    BODY_PARAGRAPH_SHORT_LEAD_MIN_WORD_COUNT
  )
    return false;

  const previousLine = lines[startIndex - 1];
  if (!previousLine || previousLine.pageIndex !== startLine.pageIndex)
    return false;
  const maxSameRowDelta = Math.max(
    startLine.fontSize *
      BODY_PARAGRAPH_SHORT_LEAD_SAME_ROW_MAX_VERTICAL_DELTA_FONT_RATIO,
    1.5,
  );
  if (Math.abs(previousLine.y - startLine.y) > maxSameRowDelta) return false;
  if (previousLine.x >= startLine.x) return false;

  const previousText = normalizeSpacing(previousLine.text);
  if (!INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(previousText))
    return false;

  const nextLine = lines[startIndex + 1];
  if (!nextLine || nextLine.pageIndex !== startLine.pageIndex) return false;
  if (nextLine.estimatedWidth < typicalWidth * BODY_PARAGRAPH_FULL_WIDTH_RATIO)
    return false;
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
  if (!BODY_PARAGRAPH_OPERATOR_TRAILING_PATTERN.test(previousText))
    return undefined;
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
  const minXDelta =
    continuation.pageWidth * BODY_PARAGRAPH_OPERATOR_SAME_ROW_MIN_X_DELTA_RATIO;
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
  if (INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(previousText))
    return undefined;

  let scanIndex = artifactStartIndex;
  const artifactTexts: string[] = [];
  const maxScanIndex = Math.min(
    lines.length,
    artifactStartIndex + INLINE_MATH_BRIDGE_MAX_LOOKAHEAD,
  );
  while (scanIndex < maxScanIndex) {
    const artifact = lines[scanIndex];
    const artifactBridge = analyzeInlineMathArtifactBridgeLine(
      artifact,
      previousLine,
    );
    if (!artifactBridge) return undefined;
    if (artifactBridge.artifactText !== undefined)
      artifactTexts.push(artifactBridge.artifactText);

    const continuationIndex = scanIndex + 1;
    const continuation = resolveInlineMathArtifactContinuationCandidate(
      lines,
      continuationIndex,
      previousLine,
    );
    if (!continuation) return undefined;

    if (
      isBodyParagraphContinuationLine(
        continuation.line,
        previousLine,
        startLine,
        titleLine,
        bodyFontSize,
        hasDottedSubsectionHeadings,
      )
    ) {
      return buildInlineMathArtifactBridgeResult(
        continuationIndex,
        artifactTexts,
        continuation.isCrossPage,
      );
    }
    if (continuation.isCrossPage) return undefined;
    scanIndex += 1;
  }

  return undefined;
}

function resolveInlineMathArtifactContinuationCandidate(
  lines: TextLine[],
  continuationIndex: number,
  previousLine: TextLine,
): { line: TextLine; isCrossPage: boolean } | undefined {
  const continuationLine = lines[continuationIndex];
  if (!continuationLine) return undefined;

  const isCrossPage = continuationLine.pageIndex !== previousLine.pageIndex;
  if (isCrossPage && continuationLine.pageIndex !== previousLine.pageIndex + 1)
    return undefined;
  return { line: continuationLine, isCrossPage };
}

function buildInlineMathArtifactBridgeResult(
  continuationIndex: number,
  artifactTexts: string[],
  isCrossPageContinuation: boolean,
): { continuationIndex: number; artifactTexts: string[] } {
  return {
    continuationIndex,
    artifactTexts: isCrossPageContinuation ? [] : artifactTexts,
  };
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
  if (
    line.fontSize >
    previousLine.fontSize * INLINE_MATH_BRIDGE_SUBSCRIPT_MAX_FONT_RATIO
  ) {
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
    nextLine && nextLine.pageIndex === line.pageIndex
      ? normalizeSpacing(nextLine.text)
      : "";
  return hasDetachedMathSubscriptContext(previousText, nextText);
}

function shouldSkipDetachedNumericFootnoteMarkerLine(
  lines: TextLine[],
  index: number,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  const line = lines[index];
  if (!line) return false;

  const normalized = parseParagraphMergeCandidateText(line, {
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
  });
  if (normalized === undefined) return false;
  if (!isDetachedNumericFootnoteMarker(line, normalized, bodyFontSize))
    return false;

  const previousLine = lines[index - 1];
  const nextLine = lines[index + 1];
  if (!previousLine || !nextLine) return false;
  if (
    previousLine.pageIndex !== line.pageIndex ||
    nextLine.pageIndex !== line.pageIndex
  )
    return false;
  if (
    !DETACHED_NUMERIC_FOOTNOTE_MARKER_NEIGHBOR_WORD_PATTERN.test(
      normalizeSpacing(previousLine.text),
    )
  ) {
    return false;
  }
  if (
    !DETACHED_NUMERIC_FOOTNOTE_MARKER_NEIGHBOR_WORD_PATTERN.test(
      normalizeSpacing(nextLine.text),
    )
  ) {
    return false;
  }

  const minBaselineYDelta =
    line.fontSize *
    DETACHED_NUMERIC_FOOTNOTE_MARKER_MIN_BASELINE_Y_DELTA_FONT_RATIO;
  if (line.y - nextLine.y < minBaselineYDelta) return false;

  return isDetachedNumericFootnoteMarkerNearNeighbors(
    line,
    previousLine,
    nextLine,
  );
}

function shouldSkipDetachedNumericFootnoteMarkerContinuationLine(
  lines: TextLine[],
  markerIndex: number,
  previousLine: TextLine,
  startLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  const markerLine = lines[markerIndex];
  if (!markerLine || markerLine.pageIndex !== previousLine.pageIndex)
    return false;

  const normalizedMarker = normalizeSpacing(markerLine.text);
  if (
    !isDetachedNumericFootnoteMarker(markerLine, normalizedMarker, bodyFontSize)
  )
    return false;

  const previousText = normalizeSpacing(previousLine.text);
  if (INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(previousText))
    return false;
  if (hasChemicalFormulaTail(previousText)) return false;

  const nextLine = lines[markerIndex + 1];
  if (!nextLine || nextLine.pageIndex !== markerLine.pageIndex) return false;
  const nextText = parseParagraphMergeCandidateText(nextLine, {
    samePageAs: previousLine,
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
    startPattern: BODY_PARAGRAPH_CONTINUATION_START_PATTERN,
  });
  if (nextText === undefined) return false;
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
    return false;
  }

  return isDetachedNumericFootnoteMarkerNearNeighbors(
    markerLine,
    previousLine,
    nextLine,
  );
}

function isDetachedNumericFootnoteMarker(
  line: TextLine,
  normalizedText: string,
  bodyFontSize: number,
): boolean {
  if (!DETACHED_NUMERIC_FOOTNOTE_MARKER_PATTERN.test(normalizedText))
    return false;
  if (
    line.estimatedWidth >
    line.pageWidth * DETACHED_NUMERIC_FOOTNOTE_MARKER_MAX_WIDTH_RATIO
  ) {
    return false;
  }
  return (
    line.fontSize <=
    bodyFontSize * DETACHED_NUMERIC_FOOTNOTE_MARKER_MAX_FONT_RATIO
  );
}

function isDetachedNumericFootnoteMarkerNearNeighbors(
  markerLine: TextLine,
  previousLine: TextLine,
  nextLine: TextLine,
): boolean {
  const markerLeft = markerLine.x;
  const markerRight = markerLine.x + markerLine.estimatedWidth;
  const previousRight = previousLine.x + previousLine.estimatedWidth;
  const maxGap =
    markerLine.fontSize *
    DETACHED_NUMERIC_FOOTNOTE_MARKER_MAX_NEIGHBOR_GAP_FONT_RATIO;
  const closeToPrevious = markerLeft - previousRight <= maxGap;
  const closeToNext = nextLine.x - markerRight <= maxGap;
  return closeToPrevious || closeToNext;
}

function hasChemicalFormulaTail(text: string): boolean {
  const normalized = normalizeSpacing(text);
  if (CHEMICAL_TRAILING_SYMBOL_AND_PATTERN.test(normalized)) return true;
  const tailMatch = CHEMICAL_TAIL_TOKEN_PATTERN.exec(normalized);
  if (!tailMatch) return false;
  const tailToken = tailMatch[1] ?? "";
  return CHEMICAL_SYMBOL_TOKEN_PATTERN.test(tailToken);
}

function hasDetachedMathSubscriptContext(
  previousText: string,
  nextText: string,
): boolean {
  if (DETACHED_MATH_SUBSCRIPT_TRAILING_VARIABLE_PATTERN.test(previousText))
    return true;
  if (DETACHED_MATH_SUBSCRIPT_ASSIGNMENT_CONTEXT_PATTERN.test(previousText))
    return true;
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
  if (!hasPositiveInlineMathBridgeVerticalGap(line, previousLine))
    return undefined;
  const bridgeKind = classifyInlineMathArtifactBridgeKind(
    parsed.tokens,
    line,
    previousLine,
  );
  if (!bridgeKind) return undefined;
  return {
    artifactText: toInlineMathArtifactBridgeText(
      bridgeKind,
      parsed.normalized,
      parsed.tokens,
    ),
  };
}

function hasPositiveInlineMathBridgeVerticalGap(
  line: TextLine,
  previousLine: TextLine,
): boolean {
  const verticalGap = previousLine.y - line.y;
  const maxVerticalGap = Math.max(
    previousLine.fontSize * INLINE_MATH_BRIDGE_MAX_VERTICAL_GAP_RATIO,
    3,
  );
  return verticalGap > 0 && verticalGap <= maxVerticalGap;
}

function parseInlineMathArtifactBridgeTextParts(
  line: TextLine,
): { normalized: string; tokens: string[] } | undefined {
  const normalized = normalizeSpacing(line.text);
  if (
    normalized.length === 0 ||
    normalized.length > INLINE_MATH_BRIDGE_MAX_TEXT_LENGTH
  )
    return undefined;
  if (!INLINE_MATH_BRIDGE_ALLOWED_CHARS_PATTERN.test(normalized))
    return undefined;

  const tokens = normalized.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0 || tokens.length > INLINE_MATH_BRIDGE_MAX_TOKEN_COUNT)
    return undefined;
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
  const isSparseDispersedMathArtifact = isSparseDispersedInlineMathArtifact(
    tokens,
    line,
    previousLine,
  );
  if (
    !isDetachedSingleTokenArtifact &&
    !isSparseDispersedMathArtifact &&
    line.estimatedWidth >
      previousLine.estimatedWidth * INLINE_MATH_BRIDGE_MAX_WIDTH_RATIO
  ) {
    return undefined;
  }
  if (isDetachedSingleTokenArtifact) return "detachedSingleToken";

  const hasNumericOrSymbol = tokens.some((token) =>
    isNumericOrSymbolInlineMathBridgeToken(token),
  );
  if (!hasNumericOrSymbol) {
    return isLowercaseSubscriptBridgeTokenLine(tokens, line, previousLine)
      ? "lowercaseSubscript"
      : undefined;
  }

  const hasValidNumericOrSymbolTokens = tokens.every(
    (token) =>
      isNumericOrSymbolInlineMathBridgeToken(token) ||
      INLINE_MATH_BRIDGE_VARIABLE_TOKEN_PATTERN.test(token),
  );
  return hasValidNumericOrSymbolTokens ? "numericOrSymbol" : undefined;
}

function isNumericOrSymbolInlineMathBridgeToken(token: string): boolean {
  return (
    INLINE_MATH_BRIDGE_NUMERIC_TOKEN_PATTERN.test(token) ||
    INLINE_MATH_BRIDGE_BRACKETED_NUMERIC_TOKEN_PATTERN.test(token) ||
    INLINE_MATH_BRIDGE_SYMBOL_TOKEN_PATTERN.test(token)
  );
}

function toInlineMathArtifactBridgeText(
  kind: InlineMathArtifactBridgeKind,
  normalized: string,
  tokens: string[],
): string | undefined {
  if (kind !== "lowercaseSubscript") return normalized;
  if (
    tokens.every((token) =>
      INLINE_MATH_BRIDGE_APPENDABLE_LOWERCASE_TOKEN_PATTERN.test(token),
    )
  ) {
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
  if (!token || !INLINE_MATH_BRIDGE_DETACHED_SINGLE_TOKEN_PATTERN.test(token))
    return false;
  if (
    line.fontSize >
    previousLine.fontSize *
      INLINE_MATH_BRIDGE_DETACHED_SINGLE_TOKEN_MAX_FONT_RATIO
  ) {
    return false;
  }
  return (
    line.estimatedWidth <=
    line.pageWidth * INLINE_MATH_BRIDGE_DETACHED_SINGLE_TOKEN_MAX_WIDTH_RATIO
  );
}

function isLowercaseSubscriptBridgeTokenLine(
  tokens: string[],
  line: TextLine,
  previousLine: TextLine,
): boolean {
  if (
    tokens.length === 0 ||
    tokens.length > INLINE_MATH_BRIDGE_SUBSCRIPT_MAX_TOKEN_COUNT
  ) {
    return false;
  }
  if (
    line.fontSize >
    previousLine.fontSize * INLINE_MATH_BRIDGE_SUBSCRIPT_MAX_FONT_RATIO
  ) {
    return false;
  }
  if (
    !tokens.some(
      (token) => token.length >= INLINE_MATH_BRIDGE_SUBSCRIPT_MIN_TOKEN_LENGTH,
    )
  ) {
    return false;
  }
  return tokens.every((token) =>
    INLINE_MATH_BRIDGE_LOWERCASE_SUBSCRIPT_TOKEN_PATTERN.test(token),
  );
}

function isSparseDispersedInlineMathArtifact(
  tokens: string[],
  line: TextLine,
  previousLine: TextLine,
): boolean {
  if (
    tokens.length === 0 ||
    tokens.length > INLINE_MATH_BRIDGE_SPARSE_DISPERSED_MAX_TOKEN_COUNT
  ) {
    return false;
  }
  if (
    line.fontSize >
    previousLine.fontSize * INLINE_MATH_BRIDGE_SPARSE_DISPERSED_MAX_FONT_RATIO
  ) {
    return false;
  }
  if (!tokens.some((token) => isNumericOrSymbolInlineMathBridgeToken(token)))
    return false;
  return tokens.every(
    (token) =>
      token.length <= INLINE_MATH_BRIDGE_SPARSE_DISPERSED_MAX_TOKEN_LENGTH &&
      (isNumericOrSymbolInlineMathBridgeToken(token) ||
        INLINE_MATH_BRIDGE_VARIABLE_TOKEN_PATTERN.test(token)),
  );
}

function isBodyParagraphContinuationLine(
  line: TextLine,
  previousLine: TextLine,
  startLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  const isPageWrap = line.pageIndex !== previousLine.pageIndex;
  if (isPageWrap) {
    return isBodyParagraphPageWrapContinuationLine(
      line,
      previousLine,
      startLine,
      titleLine,
      bodyFontSize,
      hasDottedSubsectionHeadings,
    );
  }

  // Prevent merging lines from different columns on multi-column pages.
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

  const previousNormalized = normalizeSpacing(previousLine.text);
  if (
    isLikelyAffiliationAddressToNewEntryBoundary(
      previousLine,
      previousNormalized,
      line,
      normalized,
    )
  ) {
    return false;
  }

  if (
    Math.abs(line.fontSize - startLine.fontSize) > BODY_PARAGRAPH_MAX_FONT_DELTA
  )
    return false;

  const isHyphenContinuation = isHyphenWrappedLineText(previousNormalized);
  const maxVerticalGapRatio = isHyphenContinuation
    ? HYPHEN_WRAP_MAX_VERTICAL_GAP_RATIO
    : BODY_PARAGRAPH_MAX_VERTICAL_GAP_RATIO;
  const maxVerticalGap = getFontScaledVerticalGapLimit(
    previousLine.fontSize,
    maxVerticalGapRatio,
  );
  if (!hasDescendingVerticalGapWithinLimit(previousLine, line, maxVerticalGap))
    return false;

  const maxCenterOffsetRatio = isHyphenContinuation
    ? HYPHEN_WRAP_MAX_CENTER_OFFSET_RATIO
    : BODY_PARAGRAPH_MAX_CENTER_OFFSET_RATIO;
  const maxLeftOffsetRatio = isHyphenContinuation
    ? HYPHEN_WRAP_MAX_LEFT_OFFSET_RATIO
    : BODY_PARAGRAPH_MAX_LEFT_OFFSET_RATIO;

  const centerOffset = Math.abs(
    getLineCenter(line) - getLineCenter(previousLine),
  );
  const leftOffset = Math.abs(line.x - previousLine.x);
  if (
    centerOffset > line.pageWidth * maxCenterOffsetRatio &&
    leftOffset > line.pageWidth * maxLeftOffsetRatio
  ) {
    return false;
  }

  return true;
}

function isBodyParagraphPageWrapContinuationLine(
  line: TextLine,
  previousLine: TextLine,
  startLine: TextLine,
  titleLine: TextLine | undefined,
  bodyFontSize: number,
  hasDottedSubsectionHeadings: boolean,
): boolean {
  if (line.pageIndex !== previousLine.pageIndex + 1) return false;
  if (isDisallowedPageWrapColumnTransition(previousLine, line)) return false;

  const previousText = normalizeSpacing(previousLine.text);
  if (INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(previousText))
    return false;

  const normalized = parseParagraphMergeCandidateText(line, {
    titleLine,
    bodyFontSize,
    hasDottedSubsectionHeadings,
    startPattern: BODY_PARAGRAPH_PAGE_WRAP_CONTINUATION_START_PATTERN,
  });
  if (normalized === undefined) return false;
  if (
    BODY_PARAGRAPH_REFERENCE_ENTRY_PATTERN.test(normalized) &&
    !isCitationLeadingContinuationLine(normalized, previousLine)
  ) {
    return false;
  }
  if (STANDALONE_CAPTION_LABEL_PATTERN.test(normalized)) return false;

  if (
    Math.abs(line.fontSize - startLine.fontSize) > BODY_PARAGRAPH_MAX_FONT_DELTA
  )
    return false;

  const previousYRatio = previousLine.y / previousLine.pageHeight;
  if (previousYRatio > BODY_PARAGRAPH_PAGE_WRAP_PREVIOUS_BOTTOM_MAX_RATIO)
    return false;
  const nextYRatio = line.y / line.pageHeight;
  if (nextYRatio < BODY_PARAGRAPH_PAGE_WRAP_NEXT_TOP_MIN_RATIO) return false;

  const centerOffset = Math.abs(
    getLineCenter(line) - getLineCenter(previousLine),
  );
  const leftOffset = Math.abs(line.x - previousLine.x);
  if (
    centerOffset >
      line.pageWidth * BODY_PARAGRAPH_PAGE_WRAP_MAX_CENTER_OFFSET_RATIO &&
    leftOffset > line.pageWidth * BODY_PARAGRAPH_PAGE_WRAP_MAX_LEFT_OFFSET_RATIO
  ) {
    return false;
  }

  return true;
}

function isCitationLeadingContinuationLine(
  normalized: string,
  previousLine: TextLine,
): boolean {
  if (!BODY_PARAGRAPH_CITATION_CONTINUATION_PATTERN.test(normalized))
    return false;
  const previousText = normalizeSpacing(previousLine.text);
  return !INLINE_MATH_BRIDGE_PREVIOUS_LINE_END_PATTERN.test(previousText);
}

function isLikelyAffiliationAddressToNewEntryBoundary(
  previousLine: TextLine,
  previousText: string,
  line: TextLine,
  currentText: string,
): boolean {
  if (!isLikelyAffiliationAddressLine(previousText)) return false;
  if (!isLikelyAffiliationEntryStart(line, currentText)) return false;
  const maxLeftOffset =
    line.pageWidth * AFFILIATION_ENTRY_MAX_LEFT_OFFSET_RATIO;
  if (Math.abs(line.x - previousLine.x) > maxLeftOffset) return false;
  const maxVerticalGap = getFontScaledVerticalGapLimit(
    Math.max(previousLine.fontSize, line.fontSize),
    AFFILIATION_ENTRY_MAX_VERTICAL_GAP_RATIO,
  );
  return hasDescendingVerticalGapWithinLimit(
    previousLine,
    line,
    maxVerticalGap,
  );
}

function isLikelyAffiliationAddressLine(text: string): boolean {
  const commaCount = text.match(/,/g)?.length ?? 0;
  if (commaCount < AFFILIATION_ADDRESS_LINE_MIN_COMMA_COUNT) return false;
  const startsWithStreetNumber =
    AFFILIATION_ADDRESS_LINE_START_PATTERN.test(text);
  const hasPostalCode = AFFILIATION_ADDRESS_LINE_POSTAL_CODE_PATTERN.test(text);
  const hasGeoKeyword = AFFILIATION_ADDRESS_LINE_GEO_KEYWORD_PATTERN.test(text);
  return (
    (hasPostalCode && (startsWithStreetNumber || hasGeoKeyword)) ||
    (startsWithStreetNumber && hasGeoKeyword)
  );
}

function isLikelyAffiliationEntryStart(line: TextLine, text: string): boolean {
  if (!AFFILIATION_ENTRY_START_PATTERN.test(text)) return false;
  if (line.estimatedWidth > line.pageWidth * AFFILIATION_ENTRY_MAX_WIDTH_RATIO)
    return false;
  return splitWords(text).length <= AFFILIATION_ENTRY_MAX_WORDS;
}
