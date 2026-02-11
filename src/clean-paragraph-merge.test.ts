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

  it("merges paragraph continuation lines that start with unicode math letters", () => {
    expect(cleanHtml).toContain(
      "to get the standardized table 𝑇 satisfying the data scientist’s requirements.",
    );
    expect(cleanHtml).not.toContain(
      "<p>𝑇 satisfying the data scientist’s requirements. In Figure 1, the data</p>",
    );
  });

  it("merges lowercase continuation lines that were split into adjacent paragraphs", () => {
    expect(cleanHtml).toContain(
      "In Figure 1, the data scientist inputs their requirement to standardize “Admission Date” with the “MM/DD/YYYY HH:MM:SS” format.",
    );
    expect(cleanHtml).not.toContain(
      "In Figure 1, the data</p>\n<p>scientist inputs their requirement to standardize “Admission Date”",
    );
  });

  it("drops figure-internal flow labels that leak into body paragraphs", () => {
    expect(cleanHtml).toContain("<p>Figure 2: The Workflow of CleanAgent.</p>");
    expect(cleanHtml).not.toContain("<p>+ User’s Requirements Table 𝑻</p>");
    expect(cleanHtml).not.toContain("<p>3 Historical</p>");
    expect(cleanHtml).not.toContain("<p>standardize input table 𝑻</p>");
    expect(cleanHtml).not.toContain("<p>5</p>");
    expect(cleanHtml).not.toContain("<p>6</p>");
  });

  it("merges paragraphs split across columns", () => {
    const expected =
      "<p>Currently, we have 142 standardization functions in Dataprep.Clean , each handles one data type. These functions serve to demonstrate the value of a more declarative approach, illustrating that building declarative data standardization tools for LLMs is not only feasible but essential, motivating the community to develop even more advanced tools.</p>";
    expect(cleanHtml).toContain(expected);

    // Check that the broken parts are not present
    expect(cleanHtml).not.toContain(
      "illustrating that building</p>",
    );
    expect(cleanHtml).not.toContain(
      "<p>declarative data standardization tools for LLMs is not only feasible",
    );
  });
});
