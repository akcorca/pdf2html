import type { ExtractedFragment } from "./pdf-types.ts";

const SUPERSCRIPT_NUMERIC_MARKER_PATTERN = /^[1-9]$/;
const SUPERSCRIPT_NUMERIC_MARKER_MAX_FONT_RATIO = 0.84;
const SUPERSCRIPT_NUMERIC_MARKER_MAX_WIDTH_FONT_RATIO = 0.95;
const SUPERSCRIPT_NUMERIC_MARKER_MAX_NEIGHBOR_GAP_FONT_RATIO = 8;
const SUPERSCRIPT_NUMERIC_MARKER_MIN_NEIGHBOR_WORD_LENGTH = 3;
const SUPERSCRIPT_NUMERIC_MARKER_MATH_CONTEXT_PATTERN = /[=+−*/^()[\]{}]/u;
const NUMBERED_CODE_LINE_CONTEXT_PATTERN =
  /[#=]|\b(?:def|class|return|import|from|const|let|var|function)\b/u;

export function isSuperscriptNumericMarkerText(text: string): boolean {
  return SUPERSCRIPT_NUMERIC_MARKER_PATTERN.test(text);
}

export function isSuperscriptNumericMarkerFragment(
  fragments: ExtractedFragment[],
  normalizedTexts: string[],
  markerIndex: number,
  referenceFont: number,
  normalizeSpacing: (text: string) => string,
): boolean {
  const marker = fragments[markerIndex];
  if (marker === undefined) return false;

  const normalized = normalizedTexts[markerIndex] ?? "";
  if (!isSuperscriptNumericMarkerText(normalized)) return false;
  if (isLikelyNumberedCodeLineMarker(fragments, normalizedTexts, markerIndex, normalizeSpacing)) {
    return false;
  }
  if (marker.fontSize > referenceFont * SUPERSCRIPT_NUMERIC_MARKER_MAX_FONT_RATIO) {
    return false;
  }
  const width = marker.width ?? 0;
  if (width > marker.fontSize * SUPERSCRIPT_NUMERIC_MARKER_MAX_WIDTH_FONT_RATIO) {
    return false;
  }
  return hasWordLikeNeighborNearMarker(fragments, normalizedTexts, markerIndex, marker);
}

function isLikelyNumberedCodeLineMarker(
  fragments: ExtractedFragment[],
  normalizedTexts: string[],
  markerIndex: number,
  normalizeSpacing: (text: string) => string,
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
