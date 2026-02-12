import type { ExtractedFragment, TextLine } from "./pdf-types.ts";
import { parseLeadingNumericMarker } from "./footnote-normalize.ts";
import {
  isSuperscriptNumericMarkerFragment,
  isSuperscriptNumericMarkerText,
} from "./superscript-marker.ts";
import { normalizeSpacing } from "./text-lines.ts";

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

  return rewriteFragmentsWithFootnoteAnchors(
    fragments,
    normalizedTexts,
    footnoteMap,
    referenceFont,
  );
}

function getReferenceBodyFont(
  fragments: ExtractedFragment[],
  normalizedTexts: string[],
): number | undefined {
  const nonMarkerFonts: number[] = [];
  for (let index = 0; index < fragments.length; index += 1) {
    if (isSuperscriptNumericMarkerText(normalizedTexts[index] ?? "")) continue;
    nonMarkerFonts.push(fragments[index].fontSize);
  }
  return medianOrUndefined(nonMarkerFonts);
}

function rewriteFragmentsWithFootnoteAnchors(
  fragments: ExtractedFragment[],
  normalizedTexts: string[],
  footnoteMap: Set<number>,
  referenceFont: number,
): string | undefined {
  const rewrittenFragments: string[] = [];
  let hasMarker = false;

  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index];
    const markerNumber = getLinkedFootnoteMarkerNumber(
      fragments,
      normalizedTexts,
      footnoteMap,
      index,
      referenceFont,
    );
    if (markerNumber === undefined) {
      rewrittenFragments.push(fragment.text);
      continue;
    }

    rewrittenFragments.push(
      `<sup id="fnref${markerNumber}"><a href="#fn${markerNumber}" class="footnote-ref">${markerNumber}</a></sup>`,
    );
    hasMarker = true;
  }

  if (!hasMarker) return undefined;
  return normalizeSpacing(rewrittenFragments.join(" "));
}

function getLinkedFootnoteMarkerNumber(
  fragments: ExtractedFragment[],
  normalizedTexts: string[],
  footnoteMap: Set<number>,
  markerIndex: number,
  referenceFont: number,
): number | undefined {
  const markerText = normalizedTexts[markerIndex] ?? "";
  if (!isSuperscriptNumericMarkerText(markerText)) return undefined;

  const markerNumber = Number.parseInt(markerText, 10);
  if (!Number.isFinite(markerNumber) || !footnoteMap.has(markerNumber)) return undefined;
  if (
    !isSuperscriptNumericMarkerFragment(
      fragments,
      normalizedTexts,
      markerIndex,
      referenceFont,
      normalizeSpacing,
    )
  ) {
    return undefined;
  }

  return markerNumber;
}

function medianOrUndefined(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}
