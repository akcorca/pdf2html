import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ExtractedDocument, ExtractedFragment, ExtractedPage } from "./pdf-types.ts";

export async function assertReadableFile(filePath: string): Promise<void> {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new Error(`Cannot read input PDF: ${filePath}`);
  }
}

export async function extractDocument(inputPdfPath: string): Promise<ExtractedDocument> {
  const data = new Uint8Array(await readFile(inputPdfPath));
  const pdf = await getDocument({ data, useSystemFonts: true }).promise;
  const pages: ExtractedPage[] = [];

  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const fragments: ExtractedFragment[] = [];

    for (const item of textContent.items) {
      if (!("str" in item)) continue;
      const normalized = item.str.replace(/\s+/g, " ").trim();
      if (!normalized) continue;
      const tx = item.transform[4];
      const ty = item.transform[5];
      const fontSize = Math.sqrt(
        item.transform[2] * item.transform[2] + item.transform[3] * item.transform[3],
      );
      fragments.push({ text: normalized, x: tx, y: ty, fontSize, width: item.width });
    }

    pages.push({
      pageIndex: i,
      width: viewport.width,
      height: viewport.height,
      fragments,
    });
  }

  pdf.destroy();
  return { pages };
}
