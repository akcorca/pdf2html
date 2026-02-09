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
      "dispensing with recurrence and convolutions entirely.</p>",
    );
    expect(attentionHtml).not.toContain("<p>entirely.</p>");
    expect(attentionHtml).toContain(
      "<p>Experiments on two machine translation tasks show these models to",
    );
  });
});
