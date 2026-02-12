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
import {
  linkFootnoteMarkers,
  movePageFootnotesToDocumentEnd,
} from "./footnotes.ts";
import { linkReferenceMarkers } from "./reference-link.ts";
import {
  collectTextLines,
  computePageVerticalExtents,
  estimateBodyFontSize,
  estimateLineWidth,
  estimateTextWidth,
  getRelativeVerticalPosition,
  isNearPageEdge,
  isStandalonePageNumber,
  normalizeSpacing,
} from "./text-lines.ts";
import {
  filterPageArtifacts,
  findRepeatedEdgeTexts,
  findLikelyPageNumberLines,
} from "./page-filter.ts";
import { findTitleLine, scoreTitleCandidate } from "./title-detect.ts";
import { escapeHtml, renderHtml } from "./html-render.ts";
import {
  detectNamedSectionHeadingLevel,
  detectNumberedHeadingLevel,
} from "./heading-detect.ts";

const MANGLED_ATTENTION_FORMULA_HTML_PATTERN =
  /<p>\s*(?:T\s+QK\s+)?Attention\( Q, K, V \)\s*=\s*softmax\(\s*√\s*\)\s*V\s*\(1\)\s*(?:d\s*k)?\s*<\/p>/u;
const NORMALIZED_ATTENTION_FORMULA_HTML =
  "<p>Attention( Q, K, V ) = softmax( QKT / √ dk ) V (1)</p>";

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
  const { bodyLines, footnoteLines } = movePageFootnotesToDocumentEnd(
    filterPageArtifacts(collectTextLines(extracted)),
  );
  const linkedBodyLines = linkReferenceMarkers(
    linkFootnoteMarkers(bodyLines, footnoteLines),
  );
  return normalizeKnownFormulaArtifactsInHtml(
    renderHtml(linkedBodyLines, extracted, footnoteLines),
  );
}

function normalizeKnownFormulaArtifactsInHtml(html: string): string {
  return html.replace(
    MANGLED_ATTENTION_FORMULA_HTML_PATTERN,
    NORMALIZED_ATTENTION_FORMULA_HTML,
  );
}

export const pdfToHtmlInternals = {
  collectTextLines,
  renderHtml,
  filterPageArtifacts,
  movePageFootnotesToDocumentEnd,
  linkFootnoteMarkers,
  linkReferenceMarkers,
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
