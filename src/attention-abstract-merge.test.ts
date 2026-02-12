import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { convertPdfToHtml } from "./pdf-to-html.ts";

const outputDirPath = resolve("data/work/test/attention-abstract-merge");

describe("attention abstract same-row merge", () => {
  let attentionHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    const outputPath = join(outputDirPath, "attention.html");
    await convertPdfToHtml({
      inputPdfPath: resolve("data/attention.pdf"),
      outputHtmlPath: outputPath,
    });
    attentionHtml = await readFile(outputPath, "utf8");
  });

  it("merges abstract sentences into body paragraphs", () => {
    expect(attentionHtml).toContain(
      "dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks",
    );
    expect(attentionHtml).not.toContain("<p>entirely.</p>");
    expect(attentionHtml).toContain(
      "Experiments on two machine translation tasks show these models to be superior in quality",
    );
    expect(attentionHtml).not.toContain(
      "<p>Experiments on two machine translation tasks show these models to</p>",
    );
  });

  it("merges the two paragraphs of the abstract into one", () => {
    expect(attentionHtml).toContain(
      "a small fraction of the training costs of the best models from the literature. We show that the Transformer generalizes well to other tasks by applying it successfully to English constituency parsing both with large and limited training data.",
    );
    expect(attentionHtml).not.toContain(
      "a small fraction of the training costs of the best models from the literature.</p>",
    );
  });

  it("keeps body paragraph flow when inline formula indices are detached into tiny lines", () => {
    expect(attentionHtml).toContain(
      "This inherently sequential nature precludes parallelization within training examples, which becomes critical at longer",
    );
    expect(attentionHtml).not.toContain("<p>t t − 1</p>");
  });

  it("merges optimizer paragraph lines split by detached tiny math-marker artifacts", () => {
    expect(attentionHtml).toContain(
      "We varied the learning rate over the course of training, according to the formula:",
    );
    expect(attentionHtml).not.toContain(
      "<p>We used the Adam optimizer [ 20 ] with β = 0 . 9 , β = 0 . 98 and ϵ = 10 . We varied the learning</p>",
    );
    expect(attentionHtml).not.toContain(
      "<p>rate over the course of training, according to the formula:</p>",
    );
  });

  it("merges citation-led continuation lines into the preceding paragraph", () => {
    expect(attentionHtml).toContain(
      'At each step the model is auto-regressive <a href="#ref-10">[10]</a>, consuming the previously generated symbols as additional input',
    );
    expect(attentionHtml).not.toContain(
      "<p>Most competitive neural sequence transduction models have an encoder-decoder structure [ 5 , 2 , 35 ]. Here, the encoder maps an input sequence of symbol representations ( x 1 , ..., x n ) to a sequence of continuous representations z = ( z , ..., z ) . Given z , the decoder then generates an output sequence ( y 1 , ..., y m ) of symbols one element at a time. At each step the model is auto-regressive</p>",
    );
    expect(attentionHtml).not.toContain(
      "<p>[10], consuming the previously generated symbols as additional input when generating the next.</p>",
    );
  });

  it("bridges detached inline math-subscript tokens between body lines", () => {
    expect(attentionHtml).toContain(
      "with d = 1024 on the Wall Street Journal (WSJ) portion of the Penn Treebank [ 25 ], about 40K training sentences.",
    );
    expect(attentionHtml).not.toMatch(
      /portion of the<\/p>\s*<p>model<\/p>\s*<p>Penn Treebank \[ 25 \], about 40K training sentences\./,
    );
  });

  it("merges short wrapped lead lines in the conclusion into one paragraph", () => {
    expect(attentionHtml).toContain(
      "On both WMT 2014 English-to-German and WMT 2014 English-to-French translation tasks, we achieve a new state of the art.",
    );
    expect(attentionHtml).not.toContain(
      "<p>On both WMT 2014 English-to-German and WMT 2014</p>",
    );
  });

  it("keeps trailing repository links inline with the sentence that introduces them", () => {
    expect(attentionHtml).toContain(
      'available at <a href="https://github.com/tensorflow/tensor2tensor">https://github.com/tensorflow/tensor2tensor</a>.',
    );
    expect(attentionHtml).not.toMatch(
      /available at<\/p>\s*<p><a href="https:\/\/github\.com\/tensorflow\/tensor2tensor">/u,
    );
  });

  it("merges same-row wide-gap continuation lines in section 6.3 into one paragraph", () => {
    expect(attentionHtml).toMatch(
      /increased the maximum output length to input length \+\s+300 \. We used a beam size of 21[^<]*for both WSJ only and the semi-supervised setting\./,
    );
    expect(attentionHtml).not.toContain(
      "<p>increased the maximum output length to input length +</p>",
    );
    expect(attentionHtml).not.toContain("<p>300 . We used a beam size of 21");
    expect(attentionHtml).not.toContain(
      "<p>for both WSJ only and the semi-supervised setting.</p>",
    );
  });

  it("merges same-row citation-fragment splits in conclusion paragraphs", () => {
    expect(attentionHtml).toContain(
      'In contrast to RNN sequence-to-sequence models [ 37 ], the Transformer outperforms the Berkeley-Parser <a href="#ref-29">[29]</a> even when training only on the WSJ training set of 40K sentences.',
    );
    expect(attentionHtml).not.toContain(
      "<p>In contrast to RNN sequence-to-sequence models [</p>",
    );
    expect(attentionHtml).not.toContain(
      "<p>37 ], the Transformer outperforms the Berkeley-</p>",
    );
  });

  it("keeps paragraph flow when a table block is interposed between wrapped sentence fragments", () => {
    expect(attentionHtml).toContain(
      "measuring the change in performance on English-to-German translation on the development set, newstest2013.",
    );
    expect(attentionHtml).not.toMatch(
      /translation on the<\/p>\s*<table>[\s\S]*?<\/table>\s*<p>development set, newstest2013\./u,
    );
  });

  it("removes soft-wrap hyphen artifacts for common -tion/-sion continuations", () => {
    expect(attentionHtml).toContain(
      "sequence modeling and transduction models in various tasks, allowing modeling of dependencies",
    );
    expect(attentionHtml).toContain(
      "to the recurrent and convolutional layers commonly used for mapping one variable-length",
    );
    expect(attentionHtml).not.toContain(
      "sequence modeling and transduc-tion models",
    );
    expect(attentionHtml).not.toContain(
      "the recurrent and convolu-tional layers",
    );
  });

  it("bridges detached single-token math superscripts inside body paragraphs", () => {
    expect(attentionHtml).toContain(
      "commonly used for mapping one variable-length sequence of symbol representations d ( x , ..., x ) to another sequence of equal length",
    );
    expect(attentionHtml).not.toMatch(
      /representations<\/p>\s*<p>d<\/p>\s*<p>\( x , \.\.\., x \) to another sequence of equal length/,
    );
  });

  it("keeps paragraph continuity across page boundaries when the next line is a lowercase continuation", () => {
    expect(attentionHtml).toContain(
      "computational complexity, self-attention layers are faster than recurrent layers when the sequence length n is smaller than the representation dimensionality d",
    );
    expect(attentionHtml).not.toMatch(
      /when the sequence<\/p>\s*<p>length n is smaller than the representation dimensionality d/u,
    );
  });

  it("keeps page-wrap paragraph continuity when a detached tiny math token is interposed", () => {
    expect(attentionHtml).toContain(
      "queries, keys and values we then perform the attention function in parallel, yielding d -dimensional output values. These are concatenated",
    );
    expect(attentionHtml).not.toMatch(
      /yielding d -dimensional<\/p>\s*<p>output values\. These are concatenated/u,
    );
  });

  it("drops dense figure-embedded word-label artifacts in the appendix while keeping figure captions", () => {
    expect(attentionHtml).toContain(
      "Figure 3: An example of the attention mechanism",
    );
    expect(attentionHtml).toContain(
      "Figure 4: Two attention heads, also in layer 5 of 6",
    );
    expect(attentionHtml).toContain(
      "Figure 5: Many of the attention heads exhibit behaviour that seems related to the structure of the",
    );

    expect(attentionHtml).not.toContain("<p>majority process</p>");
    expect(attentionHtml).not.toContain("<p>perfect opinion</p>");
    expect(attentionHtml).not.toContain("<p>application</p>");
    expect(attentionHtml).not.toContain("<p>Input-Input Layer5 what</p>");
  });

  it("drops standalone figure panel labels that duplicate nearby caption text", () => {
    expect(attentionHtml).toContain(
      "Figure 2: (left) Scaled Dot-Product Attention. (right) Multi-Head Attention consists of several attention layers running in parallel.",
    );
    expect(attentionHtml).not.toContain(
      "<p>Scaled Dot-Product Attention Multi-Head Attention</p>",
    );
  });

  it("renders post-reference appendix section titles as headings", () => {
    expect(attentionHtml).toContain("<h2>Attention Visualizations</h2>");
    expect(attentionHtml).not.toContain("<p>Attention Visualizations</p>");
  });

  it("moves unmarked bottom footnote prose out of section body and into footnotes", () => {
    const footnoteText = "To illustrate why the dot products get large";
    const footnoteBlock = attentionHtml.match(
      /<div class="footnotes">(.|\n)*<\/div>/,
    );

    expect(footnoteBlock).not.toBeNull();
    if (!footnoteBlock) throw new Error("Expected footnotes block to exist");
    expect(footnoteBlock[0]).toContain(footnoteText);

    const mainBody = attentionHtml.replace(footnoteBlock[0], "");
    expect(mainBody).not.toContain(footnoteText);
  });
});
