
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { convertPdfToHtml } from "./pdf-to-html.ts";

const outputDirPath = resolve("data/work/test");

describe("tft-reading-order", () => {
  let tftHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    await convertPdfToHtml({
      inputPdfPath: resolve("data/tft.pdf"),
      outputHtmlPath: join(outputDirPath, "tft-reading-order.html"),
    });
    tftHtml = await readFile(join(outputDirPath, "tft-reading-order.html"), "utf8");
  });

  it("merges right-column body text into paragraphs in tft.pdf", () => {
    // Right-column body text on page 1 should be merged into flowing paragraphs,
    // not kept as one-line-per-<p> tags.
    expect(tftHtml).not.toContain("<p>various semiconductors, sputter-deposited</p>");
    expect(tftHtml).not.toContain("<p>amorphous indium–gallium–zinc oxide</p>");
    expect(tftHtml).not.toContain("<p>displays and high current-driven organic</p>");
    // The merged paragraph should span from the first sentence fragment
    // to the final sentence in a single <p> block.
    expect(tftHtml).toMatch(
      /<p>various semiconductors, sputter-deposited[\s\S]*?conventional a-Si-based TFTs\.<\/p>/u,
    );
  });
});
