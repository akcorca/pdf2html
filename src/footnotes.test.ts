import { describe, it, expect, beforeAll } from "vitest";
import { pdfToHtml } from "./pdf-to-html.ts";
import { readFile } from "node:fs/promises";

function expectMatch(text: string, pattern: RegExp): RegExpMatchArray {
  const match = text.match(pattern);
  expect(match).not.toBeNull();
  if (!match) throw new Error(`Expected pattern ${pattern.toString()} to match`);
  return match;
}

describe("footnotes", () => {
  let attentionHtml: string;

  beforeAll(async () => {
    const pdfBuffer = await readFile("data/attention.pdf");
    attentionHtml = await pdfToHtml(new Uint8Array(pdfBuffer));
  });

  it("should wrap footnotes in a dedicated section", () => {
    const footnoteText = "Equal contribution. Listing order is random.";
    const footnoteBlock = expectMatch(attentionHtml, /<div class="footnotes">(.|\n)*<\/div>/);

    // Expect the footnote text to be inside the footnotes block
    expect(footnoteBlock[0]).toContain(footnoteText);

    // Expect the main body not to contain the footnote text in a top-level <p> tag
    const mainBody = attentionHtml.replace(footnoteBlock[0], "");
    expect(mainBody).not.toContain(`<p>${footnoteText}</p>`);
  });

  it("should merge multi-line footnotes into a single paragraph", () => {
    const footnoteText =
      "∗ Equal contribution. Listing order is random. Jakob proposed replacing RNNs with self-attention and started the effort to evaluate this idea. Ashish, with Illia, designed and implemented the first Transformer models and has been crucially involved in every aspect of this work. Noam proposed scaled dot-product attention, multi-head attention and the parameter-free position representation and became the other person involved in nearly every detail. Niki designed, implemented, tuned and evaluated countless model variants in our original codebase and tensor2tensor. Llion also experimented with novel model variants, was responsible for our initial codebase, and efficient inference and visualizations. Lukasz and Aidan spent countless long days designing various parts of and implementing tensor2tensor, replacing our earlier codebase, greatly improving results and massively accelerating our research.";

    const footnoteBlock = expectMatch(attentionHtml, /<div class="footnotes">(.|\n)*<\/div>/);

    const paragraphs = footnoteBlock[0].match(/<p>(.*?)<\/p>/gs);
    expect(paragraphs).not.toBeNull();
    if (!paragraphs) throw new Error("Expected at least one footnote paragraph");

    const firstFootnoteParagraph = paragraphs.find((p) =>
      p.includes("∗ Equal contribution.")
    );
    expect(firstFootnoteParagraph).toBeDefined();
    if (!firstFootnoteParagraph) {
      throw new Error("Expected contribution footnote paragraph to exist");
    }

    // Clean up the paragraph for comparison
    const cleanedParagraph = firstFootnoteParagraph
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
    const footnoteBlock = expectMatch(attentionHtml, /<div class="footnotes">(.|\n)*<\/div>/);

    expect(footnoteBlock[0]).toContain(footnoteText);
    const mainBody = attentionHtml.replace(footnoteBlock[0], "");
    expect(mainBody).not.toContain(footnoteText);
  });

  it("should keep numeric footnotes as separate paragraphs instead of merging them into prior unmarked footnotes", () => {
    const footnoteBlock = expectMatch(attentionHtml, /<div class="footnotes">(.|\n)*<\/div>/);
    const paragraphs = [...footnoteBlock[0].matchAll(/<p[^>]*>(.*?)<\/p>/gs)].map((match) => match[1]);
    const explanatoryFootnote = paragraphs.find((paragraph) =>
      paragraph.includes("To illustrate why the dot products get large")
    );

    expect(explanatoryFootnote).toBeDefined();
    if (!explanatoryFootnote) {
      throw new Error("Expected explanatory dot-product footnote paragraph to exist");
    }

    expect(explanatoryFootnote).not.toContain("5 We used values of 2.8");
    expect(footnoteBlock[0]).toContain(
      '<p id="fn5">5 We used values of 2.8, 3.7, 6.0 and 9.5 TFLOPS for K80, K40, M40 and P100, respectively.</p>',
    );
  });

  it("should merge detached tiny math-fragment footnote continuations into the preceding footnote paragraph", () => {
    const footnoteBlock = expectMatch(attentionHtml, /<div class="footnotes">(.|\n)*<\/div>/);
    const paragraphs = [...footnoteBlock[0].matchAll(/<p>(.*?)<\/p>/gs)].map((match) => match[1]);

    const proseParagraph = paragraphs.find((paragraph) =>
      paragraph.includes("To illustrate why the dot products get large")
    );
    expect(proseParagraph).toBeDefined();
    if (!proseParagraph) {
      throw new Error("Expected explanatory dot-product footnote paragraph to exist");
    }

    expect(proseParagraph).toContain("i =1 k");
    expect(paragraphs).not.toContain("i =1 k");
  });
});
