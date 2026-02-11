import { describe, it, expect, beforeAll } from "vitest";
import { pdfToHtml } from "./pdf-to-html.ts";
import { readFile } from "fs/promises";

describe("footnotes", () => {
  let attentionHtml: string;

  beforeAll(async () => {
    const pdfBuffer = await readFile("data/attention.pdf");
    attentionHtml = await pdfToHtml(new Uint8Array(pdfBuffer));
  });

  it("should wrap footnotes in a dedicated section", () => {
    const footnoteText = "Equal contribution. Listing order is random.";
    const footnoteBlock = attentionHtml.match(/<div class="footnotes">(.|\n)*<\/div>/);

    // Expect the footnotes block to exist
    expect(footnoteBlock).not.toBeNull();

    // Expect the footnote text to be inside the footnotes block
    expect(footnoteBlock![0]).toContain(footnoteText);

    // Expect the main body not to contain the footnote text in a top-level <p> tag
    const mainBody = attentionHtml.replace(footnoteBlock![0], "");
    expect(mainBody).not.toContain(`<p>${footnoteText}</p>`);
  });

  it("should merge multi-line footnotes into a single paragraph", () => {
    const footnoteText =
      "∗ Equal contribution. Listing order is random. Jakob proposed replacing RNNs with self-attention and started the effort to evaluate this idea. Ashish, with Illia, designed and implemented the first Transformer models and has been crucially involved in every aspect of this work. Noam proposed scaled dot-product attention, multi-head attention and the parameter-free position representation and became the other person involved in nearly every detail. Niki designed, implemented, tuned and evaluated countless model variants in our original codebase and tensor2tensor. Llion also experimented with novel model variants, was responsible for our initial codebase, and efficient inference and visualizations. Lukasz and Aidan spent countless long days designing various parts of and implementing tensor2tensor, replacing our earlier codebase, greatly improving results and massively accelerating our research.";

    const footnoteBlock = attentionHtml.match(
      /<div class="footnotes">(.|\n)*<\/div>/
    );
    expect(footnoteBlock).not.toBeNull();

    const paragraphs = footnoteBlock![0].match(/<p>(.*?)<\/p>/gs);
    expect(paragraphs).not.toBeNull();

    const firstFootnoteParagraph = paragraphs!.find((p) =>
      p.includes("∗ Equal contribution.")
    );
    expect(firstFootnoteParagraph).toBeDefined();

    // Clean up the paragraph for comparison
    const cleanedParagraph = firstFootnoteParagraph!
      .replace(/<p>|<\/p>|\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Clean up the expected text for comparison
    const cleanedExpectedText = footnoteText
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    expect(cleanedParagraph).toBe(cleanedExpectedText);
  });

  it("should move unmarked bottom-of-page footnote prose out of the main body", () => {
    const footnoteText = "To illustrate why the dot products get large";
    const footnoteBlock = attentionHtml.match(/<div class=\"footnotes\">(.|\n)*<\/div>/);
    expect(footnoteBlock).not.toBeNull();

    expect(footnoteBlock![0]).toContain(footnoteText);
    const mainBody = attentionHtml.replace(footnoteBlock![0], "");
    expect(mainBody).not.toContain(footnoteText);
  });
});
