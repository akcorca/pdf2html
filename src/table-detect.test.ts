
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { convertPdfToHtml } from "./pdf-to-html.ts";

const outputDirPath = resolve("data/work/test-debug/table-detect");

describe("table detection", () => {
  let respectHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    const pdf = { input: "data/respect.pdf", output: "respect.html" };
    await convertPdfToHtml({
      inputPdfPath: resolve(pdf.input),
      outputHtmlPath: join(outputDirPath, pdf.output),
    });
    respectHtml = await readFile(join(outputDirPath, "respect.html"), "utf8");
  });

  it("renders Table 1 in respect.pdf as a semantic table element", () => {
    expect(respectHtml).toContain("<table>");
    expect(respectHtml).toContain("<caption>Table 1: Scores on the three language understanding benchmarks.</caption>");
    expect(respectHtml).toMatch(/<th[^>]*>MMLU<\/th>/);
    expect(respectHtml).toMatch(/<th[^>]*>C-Eval<\/th>/);
    expect(respectHtml).toMatch(/<th[^>]*>JMMLU<\/th>/);
    expect(respectHtml).toMatch(/<td[^>]*>60.02<\/td>/);
    expect(respectHtml).toMatch(/<td[^>]*>75.82<\/td>/);
    expect(respectHtml).toMatch(/<td[^>]*>55.11<\/td>/);
  });
});
