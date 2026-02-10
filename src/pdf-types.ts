export interface ConvertPdfToHtmlInput {
  inputPdfPath: string;
  outputHtmlPath: string;
}

export interface ConvertPdfToHtmlResult {
  outputHtmlPath: string;
}

export interface ExtractedDocument {
  pages: ExtractedPage[];
}

export interface ExtractedPage {
  pageIndex: number;
  width: number;
  height: number;
  fragments: ExtractedFragment[];
}

export interface ExtractedFragment {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  /** Actual rendered width from the PDF engine (when available). */
  width?: number;
}

export interface TextLine {
  pageIndex: number;
  pageHeight: number;
  pageWidth: number;
  estimatedWidth: number;
  x: number;
  y: number;
  fontSize: number;
  text: string;
  /** Which column this line belongs to on a multi-column page. */
  column?: "left" | "right";
}

export interface PageVerticalExtent {
  minY: number;
  maxY: number;
}

export interface RepeatedEdgeTextStat {
  totalOccurrences: number;
  edgeOccurrences: number;
  pageIndexes: Set<number>;
  edgePageIndexes: Set<number>;
  broadEdgePageIndexes: Set<number>;
  minEdgeFontSize: number;
}

export interface NumericEdgeLine {
  line: TextLine;
  offset: number;
}

export const LINE_Y_BUCKET_SIZE = 2;
export const MAX_REASONABLE_Y_MULTIPLIER = 2.5;
export const PAGE_EDGE_MARGIN = 0.08;
export const STANDALONE_PAGE_NUMBER_PATTERN = /^\d{1,4}$/;
export const MIN_REPEATED_EDGE_TEXT_PAGES = 4;
export const MIN_REPEATED_EDGE_TEXT_PAGE_COVERAGE = 0.6;
export const MIN_EDGE_TEXT_AFFIX_LENGTH = 12;
export const MIN_RUNNING_LABEL_EDGE_PAGE_COVERAGE = 0.8;
export const MIN_RUNNING_LABEL_LENGTH = 6;
export const MAX_RUNNING_LABEL_LENGTH = 40;
export const MAX_RUNNING_LABEL_WORDS = 4;
export const MIN_PAGE_NUMBER_SEQUENCE_PAGES = 3;
export const MIN_PAGE_NUMBER_SEQUENCE_COVERAGE = 0.5;
export const ARXIV_SUBMISSION_STAMP_PATTERN =
  /\barXiv:\d{4}\.\d{4,5}(?:v\d+)?\s+\[[^\]]+\]\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\b/i;
export const ARXIV_SUBMISSION_STAMP_MIN_FONT_SIZE_DELTA = 6;
export const ARXIV_SUBMISSION_STAMP_MIN_FONT_SIZE_RATIO = 1.6;
export const TITLE_MIN_FONT_SIZE_DELTA = 3;
export const TITLE_MIN_FONT_SIZE_RATIO = 1.3;
export const TITLE_MAX_WIDTH_RATIO = 0.9;
export const TITLE_NEARBY_FONT_SIZE_TOLERANCE = 0.5;
export const TITLE_NEARBY_LINE_WINDOW = 90;
export const MAX_NEARBY_SAME_FONT_LINES = 3;
export const TITLE_MIN_RELATIVE_VERTICAL_POSITION = 0.45;
export const TOP_MATTER_TITLE_LOOKBACK_LINES = 8;
export const MIN_AUTHOR_LINE_COMMA_COUNT = 2;
export const MIN_AUTHOR_NAME_TOKEN_COUNT = 4;
export const MIN_TOP_MATTER_TITLE_WORD_COUNT = 3;
export const MAX_TOP_MATTER_TITLE_COMMA_COUNT = 1;
export const MIN_COLUMN_BREAK_GAP = 120;
export const MIN_COLUMN_BREAK_GAP_RATIO = 0.18;
export const COLUMN_BREAK_LEFT_MAX_RATIO = 0.55;
export const COLUMN_BREAK_RIGHT_MIN_RATIO = 0.33;
export const MIN_COLUMN_BREAK_TEXT_CHARACTER_COUNT = 6;
export const MIN_MULTI_COLUMN_BREAK_ROWS = 3;
export const MIN_MULTI_COLUMN_BREAK_ROW_RATIO = 0.12;
export const MIN_NUMBERED_HEADING_LENGTH = 6;
export const MAX_NUMBERED_HEADING_LENGTH = 90;
export const MAX_NUMBERED_HEADING_WORDS = 16;
export const MAX_TOP_LEVEL_SECTION_NUMBER = 20;
export const MAX_NUMBERED_HEADING_DIGIT_RATIO = 0.2;
