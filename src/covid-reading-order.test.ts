import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { convertPdfToHtml } from "./pdf-to-html.ts";

const outputDirPath = resolve("data/work/test");

describe("covid numbered heading order", () => {
  let covidHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    const outputPath = join(outputDirPath, "covid.html");
    await convertPdfToHtml({
      inputPdfPath: resolve("data/covid.pdf"),
      outputHtmlPath: outputPath,
    });
    covidHtml = await readFile(outputPath, "utf8");
  });

  it("does not place 2.2 subsection heading before its parent 2. section heading", () => {
    expect(covidHtml).toContain("<h2>2. Methods</h2>");
    expect(covidHtml).not.toMatch(/<h3>2\.2\. Death data<\/h3>[\s\S]*<h2>2\. Methods<\/h2>/);
  });
});
