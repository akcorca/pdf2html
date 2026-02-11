import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { convertPdfToHtml } from "./pdf-to-html.ts";

const outputDirPath = resolve("data/work/test");

describe("covid back-matter headings", () => {
  let covidHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    const outputPath = join(outputDirPath, "covid-backmatter-headings.html");
    await convertPdfToHtml({
      inputPdfPath: resolve("data/covid.pdf"),
      outputHtmlPath: outputPath,
    });
    covidHtml = await readFile(outputPath, "utf8");
  });

  it("promotes standalone back-matter section labels to semantic headings", () => {
    const ethicalApprovalHeading = "<h2>Ethical approval</h2>";
    const creditHeading = "<h2>CRediT authorship contribution statement</h2>";
    const competingInterestHeading = "<h2>Declaration of competing interest</h2>";
    const appendixHeading = "<h2>Appendix A. Supplementary data</h2>";

    expect(covidHtml).toContain(ethicalApprovalHeading);
    expect(covidHtml).toContain(creditHeading);
    expect(covidHtml).toContain(competingInterestHeading);
    expect(covidHtml).toContain(appendixHeading);

    expect(covidHtml).not.toContain("<p>Ethical approval</p>");
    expect(covidHtml).not.toContain("<p>CRediT authorship contribution statement</p>");
    expect(covidHtml).not.toContain("<p>Declaration of competing interest</p>");
    expect(covidHtml).not.toContain("<p>Appendix A. Supplementary data</p>");
  });
});
