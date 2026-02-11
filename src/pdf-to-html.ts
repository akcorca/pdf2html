import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  ConvertPdfToHtmlInput,
  ConvertPdfToHtmlResult,
  ExtractedDocument,
} from "./pdf-types.ts";
import {
  assertReadableFile,
  extractDocument,
  extractDocumentFromBuffer,
} from "./pdf-extract.ts";
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
import { escapeHtml } from "./html-render.ts";
import { detectNamedSectionHeadingLevel, detectNumberedHeadingLevel } from "./heading-detect.ts";

export async function convertPdfToHtml(
  input: ConvertPdfToHtmlInput,
): Promise<ConvertPdfToHtmlResult> {
  const resolvedInputPdfPath = resolve(input.inputPdfPath);
  const resolvedOutputHtmlPath = resolve(input.outputHtmlPath);
  await assertReadableFile(resolvedInputPdfPath);
  const extracted = await extractDocument(resolvedInputPdfPath);
  const html = renderExtractedDocumentAsHtml(extracted);
  await mkdir(dirname(resolvedOutputHtmlPath), { recursive: true });
  await writeFile(resolvedOutputHtmlPath, html, "utf8");
  return { outputHtmlPath: resolvedOutputHtmlPath };
}

export async function pdfToHtml(pdfBuffer: Uint8Array): Promise<string> {
  const extracted = await extractDocumentFromBuffer(pdfBuffer);
  return renderExtractedDocumentAsHtml(extracted);
}

function renderExtractedDocumentAsHtml(extracted: ExtractedDocument): string {
  const filteredLines = filterPageArtifacts(collectTextLines(extracted));
  const { bodyLines, footnoteLines } = movePageFootnotesToDocumentEnd(filteredLines);
  return renderHtml(bodyLines, extracted, footnoteLines);
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
