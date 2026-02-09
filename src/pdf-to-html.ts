import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ConvertPdfToHtmlInput, ConvertPdfToHtmlResult } from "./pdf-types.ts";
import { assertReadableFile, extractDocument } from "./pdf-extract.ts";
import { collectTextLines } from "./text-lines.ts";
import { filterPageArtifacts } from "./page-filter.ts";
import { renderHtml } from "./html-render.ts";
import { movePageFootnotesToDocumentEnd } from "./footnotes.ts";
import {
  computePageVerticalExtents,
  estimateBodyFontSize,
  estimateLineWidth,
  estimateTextWidth,
  getRelativeVerticalPosition,
  isNearPageEdge,
  isStandalonePageNumber,
  normalizeSpacing,
} from "./text-lines.ts";
import { findRepeatedEdgeTexts, findLikelyPageNumberLines } from "./page-filter.ts";
import { findTitleLine, scoreTitleCandidate } from "./title-detect.ts";
import {
  detectNamedSectionHeadingLevel,
  detectNumberedHeadingLevel,
  escapeHtml,
} from "./html-render.ts";

export async function convertPdfToHtml(
  input: ConvertPdfToHtmlInput,
): Promise<ConvertPdfToHtmlResult> {
  const resolvedInputPdfPath = resolve(input.inputPdfPath);
  const resolvedOutputHtmlPath = resolve(input.outputHtmlPath);
  await assertReadableFile(resolvedInputPdfPath);
  const extracted = await extractDocument(resolvedInputPdfPath);
  const lines = movePageFootnotesToDocumentEnd(filterPageArtifacts(collectTextLines(extracted)));
  const html = renderHtml(lines);
  await mkdir(dirname(resolvedOutputHtmlPath), { recursive: true });
  await writeFile(resolvedOutputHtmlPath, html, "utf8");
  return { outputHtmlPath: resolvedOutputHtmlPath };
}

export const pdfToHtmlInternals = {
  collectTextLines,
  renderHtml,
  filterPageArtifacts,
  movePageFootnotesToDocumentEnd,
  computePageVerticalExtents,
  findRepeatedEdgeTexts,
  isNearPageEdge,
  getRelativeVerticalPosition,
  isStandalonePageNumber,
  findLikelyPageNumberLines,
  findTitleLine,
  estimateBodyFontSize,
  scoreTitleCandidate,
  estimateLineWidth,
  estimateTextWidth,
  normalizeSpacing,
  escapeHtml,
  detectNumberedHeadingLevel,
  detectNamedSectionHeadingLevel,
};
