import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { convertPdfToHtml } from "./pdf-to-html.ts";

const outputDirPath = resolve("data/work/test/clean-paragraph-merge");

describe("clean.pdf paragraph merging", () => {
  let cleanHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    const outputPath = join(outputDirPath, "clean.html");
    await convertPdfToHtml({
      inputPdfPath: resolve("data/clean.pdf"),
      outputHtmlPath: outputPath,
    });
    cleanHtml = await readFile(outputPath, "utf8");
  });

  it("merges broken paragraphs and removes hyphens", () => {
    const expectedParagraph =
      "<p>Data standardization, which is pivotal in the realm of data science, aims to transform heterogeneous data formats within a single column into a unified data format. This crucial data preprocessing step is essential for enabling effective data integration, data analysis, and decision-making.</p>";
    expect(cleanHtml).toContain(expectedParagraph);

    // Also check for the absence of the broken parts
    expect(cleanHtml).not.toContain(
      "<p>Data standardization, which is pivotal in the realm of data science,</p>",
    );
    expect(cleanHtml).not.toContain(
      "<p>aims to transform heterogeneous data formats within a single col-</p>",
    );
    expect(cleanHtml).not.toContain(
      "single col-umn into a unified data format. This crucial data preprocessing step",
    );
  });
});
