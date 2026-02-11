import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ExtractedDocument, ExtractedFragment, ExtractedPage } from "./pdf-types.ts";
export { assertReadableFile } from "./file-access.ts";

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
}

export async function extractDocument(inputPdfPath: string): Promise<ExtractedDocument> {
  const data = new Uint8Array(await readFile(inputPdfPath));
  return extractDocumentFromBuffer(data);
}

export async function extractDocumentFromBuffer(data: Uint8Array): Promise<ExtractedDocument> {
  const pdf = await getDocument({ data, useSystemFonts: true }).promise;
  const pages: ExtractedPage[] = [];

  try {
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      pages.push({
        pageIndex: i,
        width: viewport.width,
        height: viewport.height,
        fragments: collectPageFragments(textContent.items),
      });
    }
    return { pages };
  } finally {
    await pdf.destroy();
  }
}

function collectPageFragments(items: unknown[]): ExtractedFragment[] {
  const fragments: ExtractedFragment[] = [];

  for (const item of items) {
    if (!isPdfTextItem(item)) continue;
    const fragment = toExtractedFragment(item);
    if (fragment) fragments.push(fragment);
  }

  return fragments;
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof item.str === "string" &&
    "transform" in item &&
    Array.isArray(item.transform) &&
    "width" in item &&
    typeof item.width === "number"
  );
}

function toExtractedFragment(item: PdfTextItem): ExtractedFragment | undefined {
  const text = normalizePdfText(item.str);
  if (!text) return undefined;
  return {
    text,
    x: item.transform[4],
    y: item.transform[5],
    fontSize: Math.hypot(item.transform[2], item.transform[3]),
    width: item.width,
  };
}

function normalizePdfText(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}
