import type { TextLine } from "./pdf-types.ts";

const REFERENCE_MARKER_PATTERN = /\[(\d{1,4})\]/gu;
const REFERENCE_ENTRY_START_PATTERN = /^\[\d{1,4}\]/u;
const REFERENCES_HEADING_PATTERN = /^references$/iu;
const REFERENCE_SECTION_MIN_START_RATIO = 0.35;
const REFERENCE_SECTION_MARKER_WINDOW = 40;
const REFERENCE_SECTION_MIN_MARKERS_IN_WINDOW = 3;

export function linkReferenceMarkers(lines: TextLine[]): TextLine[] {
  const referenceSectionStartIndex = findReferenceSectionStartIndex(lines);

  for (let index = 0; index < lines.length; index += 1) {
    if (
      referenceSectionStartIndex !== undefined &&
      index >= referenceSectionStartIndex
    ) {
      continue;
    }
    lines[index].text = lines[index].text.replace(
      REFERENCE_MARKER_PATTERN,
      '<a href="#ref-$1">[$1]</a>',
    );
  }
  return lines;
}

function findReferenceSectionStartIndex(lines: TextLine[]): number | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    const normalized = normalizeInlineSpacing(lines[index].text);
    if (REFERENCES_HEADING_PATTERN.test(normalized)) {
      return index + 1;
    }
  }

  const markerIndexes: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (REFERENCE_ENTRY_START_PATTERN.test(normalizeInlineSpacing(lines[index].text))) {
      markerIndexes.push(index);
    }
  }

  if (markerIndexes.length === 0) return undefined;
  const minimumStartIndex = Math.floor(lines.length * REFERENCE_SECTION_MIN_START_RATIO);
  for (let markerIndexIndex = 0; markerIndexIndex < markerIndexes.length; markerIndexIndex += 1) {
    const startIndex = markerIndexes[markerIndexIndex];
    if (startIndex < minimumStartIndex) continue;

    let markersInWindow = 1;
    for (
      let nextMarkerIndex = markerIndexIndex + 1;
      nextMarkerIndex < markerIndexes.length;
      nextMarkerIndex += 1
    ) {
      const candidateIndex = markerIndexes[nextMarkerIndex];
      if (candidateIndex - startIndex > REFERENCE_SECTION_MARKER_WINDOW) break;
      markersInWindow += 1;
    }

    if (markersInWindow >= REFERENCE_SECTION_MIN_MARKERS_IN_WINDOW) {
      return startIndex;
    }
  }

  return undefined;
}

function normalizeInlineSpacing(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}
