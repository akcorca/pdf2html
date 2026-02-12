
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
    // The merged paragraph should span from the left-column lead
    // through the right-column continuation in a single <p> block.
    expect(tftHtml).toMatch(
      /<p>Increasing demands for next-generation, large-area electronics[\s\S]*?various semiconductors, sputter-deposited[\s\S]*?conventional a-Si-based TFTs\.<\/p>/u,
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

  it("keeps Figure 3 caption text out of the preceding body paragraph", () => {
    expect(tftHtml).not.toContain(
      "the reduced bulk resistance of the PCBM and transfer characteristics of a-IGZO TFTs",
    );
    expect(tftHtml).toMatch(
      /<p>Figure 3\.[^<]*?transfer characteristics of a-IGZO TFTs with N-DMBI-doped PCBM IFL[^<]*?positive gate bias stress \( V = 25 V, V = 50 V\)\.<\/p>/u,
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

  it("skips detached figure-label artifacts between wrapped paragraph continuations", () => {
    expect(tftHtml).not.toContain("<p>I – V and output characteristics of a-IGZO</p>");
    expect(tftHtml).not.toContain("<p>DS G DS G for 3600 s exhibited");
    expect(tftHtml).toContain(
      "trodes kept under the PBS condition ( V = 25 V, V = 50 V) for 3600 s exhibited a more significant transfer-curve shift",
    );
  });

  it("keeps experimental section prose separate from right-column references", () => {
    expect(tftHtml).toContain("<h3>Device and Film Characterization</h3>");
    expect(tftHtml).toContain("<p>The current–voltage characteristics");
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

  it("converts subsection titles in 'Experimental Section' to h3 headings", () => {
    // "Device and Film Characterization" should be an <h3> heading,
    // not part of a <p> tag.
    expect(tftHtml).toContain("<h3>Device and Film Characterization</h3>");
    expect(tftHtml).not.toContain(
      "<p>Device and Film Characterization :",
    );
  });

  it("promotes inline experimental subsection labels to h3 headings", () => {
    expect(tftHtml).toContain(
      "<h3>Material Preparation and Device Fabrication</h3>",
    );
    expect(tftHtml).toContain("<p>A 0.2 m mixture of indium nitrate hydrate");
    expect(tftHtml).not.toContain(
      "<p>Material Preparation and Device Fabrication :",
    );
  });

  it("does not interleave author affiliations with main body text", () => {
    // Author affiliations in the left column should not be interleaved with
    // the main body text from the right column.
    expect(tftHtml).not.toMatch(
      /84 Heukseok-ro, Dongjak-Gu, Seoul 06974, Republic of Korea<\/p>\s*<p>various semiconductors, sputter-deposited/u,
    );

    // The main body text should start after all affiliation blocks.
    expect(tftHtml).toMatch(
      /45 Yongso-ro, Namgu Pusan 48513, Republic of Korea<\/p>\s*<p>Increasing demands for next-generation, large-area electronics/u,
    );
  });

  it("keeps first-page column continuation contiguous without affiliation block interleaving", () => {
    const leftTail =
      "electronics, and optoelectronics applications. Among the";
    const rightLead = "various semiconductors, sputter-deposited";

    const leftTailIndex = tftHtml.indexOf(leftTail);
    const rightLeadIndex = tftHtml.indexOf(rightLead);
    expect(leftTailIndex).toBeGreaterThanOrEqual(0);
    expect(rightLeadIndex).toBeGreaterThan(leftTailIndex);

    const between = tftHtml.slice(leftTailIndex, rightLeadIndex);
    expect(between).not.toContain("Department of Chemical and");
    expect(between).not.toContain(
      "Department of Electrical and Computer Engineering",
    );
  });

  it("splits merged reference items into distinct li tags", () => {
    // In tft.pdf, the line starting with "[2] a) M. G. Kim..." also contains "[13] a) D. Q. Zhang...".
    // This indicates that multiple references were merged into one line.
    // The ideal output should have separate `<li>` tags for `[2]` and `[13]`.
    const olMatch = /<ol>([\s\S]*)<\/ol>/.exec(tftHtml);
    expect(olMatch).toBeDefined();
    if (!olMatch) {
      throw new Error("Expected ordered reference list in generated HTML");
    }
    const olContent = olMatch[1];
    const listItems = [...olContent.matchAll(/<li>([\s\S]*?)<\/li>/g)];

    const mergedItem = listItems.find(([_, content]) =>
      content.includes("[2]") && content.includes("[13]")
    );

    expect(mergedItem, "References [2] and [13] should not be in the same <li> tag").toBeUndefined();

    const ref2Item = listItems.find(([_, content]) => content.trim().startsWith("[2]"));
    const ref13Item = listItems.find(([_, content]) => content.trim().startsWith("[13]"));

    expect(ref2Item, "Reference [2] should exist in its own <li> tag").toBeDefined();
    expect(ref13Item, "Reference [13] should exist in its own <li> tag").toBeDefined();
  });
});
