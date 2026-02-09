import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { convertPdfToHtml } from "./pdf-to-html.ts";

const outputDirPath = resolve("data/work/test");

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
});
