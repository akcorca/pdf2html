import type { ExtractedFragment, TextLine } from "./pdf-types.ts";
import { parseLeadingNumericMarker } from "./footnote-normalize.ts";
import { normalizeSpacing } from "./text-lines.ts";

const SUPERSCRIPT_NUMERIC_MARKER_PATTERN = /^[1-9]$/;
const SUPERSCRIPT_NUMERIC_MARKER_MAX_FONT_RATIO = 0.84;
const SUPERSCRIPT_NUMERIC_MARKER_MAX_WIDTH_FONT_RATIO = 0.95;
const SUPERSCRIPT_NUMERIC_MARKER_MAX_NEIGHBOR_GAP_FONT_RATIO = 8;
const SUPERSCRIPT_NUMERIC_MARKER_MIN_NEIGHBOR_WORD_LENGTH = 3;
const SUPERSCRIPT_NUMERIC_MARKER_MATH_CONTEXT_PATTERN = /[=+−*/^()[\]{}]/u;
const NUMBERED_CODE_LINE_CONTEXT_PATTERN =
  /[#=]|\b(?:def|class|return|import|from|const|let|var|function)\b/u;

export function linkFootnoteMarkers(bodyLines: TextLine[], footnoteLines: TextLine[]): TextLine[] {
  const footnoteMap = buildFootnoteMarkerMap(footnoteLines);
  if (footnoteMap.size === 0) return bodyLines;

  for (const line of bodyLines) {
    const linkedText = buildLinkedLineText(line, footnoteMap);
    if (linkedText !== undefined) {
      line.text = linkedText;
    }
  }

  return bodyLines;
}

function buildFootnoteMarkerMap(footnoteLines: TextLine[]): Set<number> {
  const footnoteMap = new Set<number>();
  for (const line of footnoteLines) {
    const marker = parseLeadingNumericMarker(line.text);
    if (marker !== undefined) {
      footnoteMap.add(marker);
    }
  }
  return footnoteMap;
}

function buildLinkedLineText(line: TextLine, footnoteMap: Set<number>): string | undefined {
  const fragments = line.fragments;
  if (fragments.length <= 1) return undefined;

  const normalizedTexts = fragments.map((fragment) => normalizeSpacing(fragment.text));
  const referenceFont = getReferenceBodyFont(fragments, normalizedTexts);
  if (referenceFont === undefined) return undefined;

  const rewritten = rewriteFragmentsWithFootnoteAnchors(
    fragments,
    normalizedTexts,
    footnoteMap,
    referenceFont,
  );
  if (!rewritten.hasMarker) return undefined;
  return normalizeSpacing(rewritten.fragments.join(" "));
}

function getReferenceBodyFont(
  fragments: ExtractedFragment[],
  normalizedTexts: string[],
): number | undefined {
  const nonMarkerFonts = fragments
    .filter((_, index) => !SUPERSCRIPT_NUMERIC_MARKER_PATTERN.test(normalizedTexts[index] ?? ""))
    .map((fragment) => fragment.fontSize);
  return medianOrUndefined(nonMarkerFonts);
}

function rewriteFragmentsWithFootnoteAnchors(
  fragments: ExtractedFragment[],
  normalizedTexts: string[],
  footnoteMap: Set<number>,
  referenceFont: number,
): { fragments: string[]; hasMarker: boolean } {
  const rewrittenFragments: string[] = [];
  let hasMarker = false;

  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index];
    const markerNumber = Number.parseInt(fragment.text.trim(), 10);
    const isMarker =
      !Number.isNaN(markerNumber) &&
      footnoteMap.has(markerNumber) &&
      isSuperscriptNumericMarkerFragment(fragments, normalizedTexts, index, fragment, referenceFont);

    if (!isMarker) {
      rewrittenFragments.push(fragment.text);
      continue;
    }

    rewrittenFragments.push(
      `<sup id="fnref${markerNumber}"><a href="#fn${markerNumber}" class="footnote-ref">${markerNumber}</a></sup>`,
    );
    hasMarker = true;
  }

  return { fragments: rewrittenFragments, hasMarker };
}

function isSuperscriptNumericMarkerFragment(
  fragments: ExtractedFragment[],
  normalizedTexts: string[],
  index: number,
  fragment: ExtractedFragment,
  referenceFont: number,
): boolean {
  const normalized = normalizedTexts[index] ?? "";
  if (!SUPERSCRIPT_NUMERIC_MARKER_PATTERN.test(normalized)) return false;
  if (isLikelyNumberedCodeLineMarker(fragments, normalizedTexts, index)) return false;
  if (fragment.fontSize > referenceFont * SUPERSCRIPT_NUMERIC_MARKER_MAX_FONT_RATIO) return false;
  const width = fragment.width ?? 0;
  if (width > fragment.fontSize * SUPERSCRIPT_NUMERIC_MARKER_MAX_WIDTH_FONT_RATIO) return false;
  return hasWordLikeNeighborNearMarker(fragments, normalizedTexts, index, fragment);
}

function isLikelyNumberedCodeLineMarker(
  fragments: ExtractedFragment[],
  normalizedTexts: string[],
  markerIndex: number,
): boolean {
  if (markerIndex !== 0) return false;
  if (fragments.length <= 1) return false;
  const followingText = normalizeSpacing(
    normalizedTexts.slice(markerIndex + 1, markerIndex + 5).join(" "),
  );
  if (followingText.length === 0) return false;
  return NUMBERED_CODE_LINE_CONTEXT_PATTERN.test(followingText);
}

function hasWordLikeNeighborNearMarker(
  fragments: ExtractedFragment[],
  normalizedTexts: string[],
  markerIndex: number,
  marker: ExtractedFragment,
): boolean {
  const previousQualified = isQualifiedWordLikeMarkerNeighbor(
    fragments,
    normalizedTexts,
    markerIndex,
    marker,
    -1,
  );
  const nextQualified = isQualifiedWordLikeMarkerNeighbor(
    fragments,
    normalizedTexts,
    markerIndex,
    marker,
    1,
  );
  const hasPrevious = markerIndex > 0;
  const hasNext = markerIndex + 1 < fragments.length;
  if (hasPrevious && hasNext) return previousQualified && nextQualified;
  return previousQualified || nextQualified;
}

function isQualifiedWordLikeMarkerNeighbor(
  fragments: ExtractedFragment[],
  normalizedTexts: string[],
  markerIndex: number,
  marker: ExtractedFragment,
  direction: -1 | 1,
): boolean {
  const neighborIndex = markerIndex + direction;
  const neighbor = fragments[neighborIndex];
  if (neighbor === undefined) return false;
  const maxGap = marker.fontSize * SUPERSCRIPT_NUMERIC_MARKER_MAX_NEIGHBOR_GAP_FONT_RATIO;
  const markerLeft = marker.x;
  const markerRight = marker.x + (marker.width ?? 0);
  const neighborLeft = neighbor.x;
  const neighborRight = neighbor.x + (neighbor.width ?? 0);
  const gap = direction < 0 ? markerLeft - neighborRight : neighborLeft - markerRight;
  if (gap > maxGap) return false;
  return isWordLikeNeighborText(normalizedTexts[neighborIndex] ?? "");
}

function isWordLikeNeighborText(text: string): boolean {
  if (SUPERSCRIPT_NUMERIC_MARKER_MATH_CONTEXT_PATTERN.test(text)) return false;
  const lowercaseRuns = text.match(/[a-z]{3,}/g) ?? [];
  return lowercaseRuns.some(
    (word) => word.length >= SUPERSCRIPT_NUMERIC_MARKER_MIN_NEIGHBOR_WORD_LENGTH,
  );
}

function medianOrUndefined(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}
