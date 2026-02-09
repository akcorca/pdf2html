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

  it("keeps body paragraph flow when inline formula indices are detached into tiny lines", () => {
    expect(attentionHtml).toContain(
      "This inherently sequential nature precludes parallelization within training examples, which becomes critical at longer",
    );
    expect(attentionHtml).not.toContain("<p>t t − 1</p>");
  });

  it("merges citation-led continuation lines into the preceding paragraph", () => {
    expect(attentionHtml).toContain(
      "At each step the model is auto-regressive [10], consuming the previously generated symbols as additional input",
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

  it("removes soft-wrap hyphen artifacts for common -tion/-sion continuations", () => {
    expect(attentionHtml).toContain(
      "sequence modeling and transduction models in various tasks, allowing modeling of dependencies",
    );
    expect(attentionHtml).toContain(
      "to the recurrent and convolutional layers commonly used for mapping one variable-length",
    );
    expect(attentionHtml).not.toContain("sequence modeling and transduc-tion models");
    expect(attentionHtml).not.toContain("the recurrent and convolu-tional layers");
  });
});
