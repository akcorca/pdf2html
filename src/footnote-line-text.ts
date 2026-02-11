import type { TextLine } from "./pdf-types.ts";
import { normalizeSpacing } from "./text-lines.ts";

const FOOTNOTE_BLOCK_MAX_VERTICAL_RATIO = 0.42;
const FOOTNOTE_TEXT_MAX_FONT_RATIO = 0.98;
const FOOTNOTE_MIN_TEXT_LENGTH = 8;
const FOOTNOTE_MAX_VERTICAL_GAP = 20;

export function isDescendingNearbyFootnoteLine(line: TextLine, previousLine: TextLine): boolean {
  if (line.pageIndex !== previousLine.pageIndex) return false;
  if (line.y >= previousLine.y) return false;
  return previousLine.y - line.y <= FOOTNOTE_MAX_VERTICAL_GAP;
}

export function getFootnoteBlockText(line: TextLine, bodyFontSize: number): string | undefined {
  if (line.y > line.pageHeight * FOOTNOTE_BLOCK_MAX_VERTICAL_RATIO) return undefined;
  if (line.fontSize > bodyFontSize * FOOTNOTE_TEXT_MAX_FONT_RATIO) return undefined;

  const text = normalizeSpacing(line.text);
  if (text.length === 0) return undefined;
  return text;
}

export function getFootnoteContentText(line: TextLine, bodyFontSize: number): string | undefined {
  const text = getFootnoteBlockText(line, bodyFontSize);
  if (!text || text.length < FOOTNOTE_MIN_TEXT_LENGTH) return undefined;
  if (!/[A-Za-z]/.test(text)) return undefined;
  return text;
}
