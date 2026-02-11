
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

  it("does not interleave figure caption text with body text", () => {
    // Figure 2 caption should be a contiguous block, not interleaved
    // with left-column body text like "ductor and metal electrodes was achieved"
    // or "via the simple solution processing of metal-".
    // The caption should contain "Figure 2." followed by its description text
    // without body-text fragments in between.
    expect(tftHtml).not.toMatch(
      /Figure 2\.[\s\S]*?ductor and metal electrodes was achieved[\s\S]*?transfer characteristics/u,
    );
    expect(tftHtml).not.toMatch(
      /oxide semicon-[\s\S]*?Figure 2\.[\s\S]*?ductor and metal electrodes/u,
    );

    // The figure caption should appear as a coherent block
    expect(tftHtml).toMatch(
      /Figure 2\.[\s\S]*?Variations of the I[\s\S]*?ambient and vacuum conditions\./u,
    );

    // Body text should flow without caption fragments interleaved
    expect(tftHtml).toMatch(
      /oxide semicon-ductor and metal electrodes was achieved via the simple solution processing/u,
    );
  });

  it("merges same-row right-column text fragments before hyphen-wrap continuation", () => {
    // On page 3 in tft.pdf, two right-column same-row fragments should be
    // merged first, then wrapped-word continuation should follow naturally.
    expect(tftHtml).toMatch(/300 nm SiO was used as the dielec-tric which is suitable/u);
    expect(tftHtml).toMatch(
      /Supporting Information\) and grazing-incidence X-ray diffraction \(GIXRD\)/u,
    );

    expect(tftHtml).not.toContain("<p>was used as the dielec-</p>");
    expect(tftHtml).not.toContain("<p>grazing-</p>");
  });

  it("keeps experimental section prose separate from right-column references", () => {
    expect(tftHtml).toContain(
      "Device and Film Characterization : The current–voltage characteristics",
    );
    expect(tftHtml).not.toContain(
      "Device and Film Characterization : The current–voltage characteristics h)",
    );
    expect(tftHtml).not.toContain(
      "using a Keithley 4200 SCS. The saturation mobilities ( μ ) and SS were [2] a)",
    );
    expect(tftHtml).not.toContain("mask. M. F. Toney");
  });

  it("does not merge affiliation address lines with the next author entry", () => {
    expect(tftHtml).not.toContain(
      "30 Pildong-ro 1-gil, Jung-gu, Seoul 04620, Republic of Korea Prof. S.Y. Seo",
    );
    expect(tftHtml).toMatch(
      /<p>30 Pildong-ro 1-gil, Jung-gu, Seoul 04620, Republic of Korea<\/p>\s*<p>Prof\. S\.Y\. Seo<\/p>\s*<p>Department of Chemistry<\/p>\s*<p>Pukyong National University<\/p>\s*<p>45 Yongso-ro, Namgu Pusan 48513, Republic of Korea<\/p>/u,
    );
  });
});
