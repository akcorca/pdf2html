import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { convertPdfToHtml } from "./pdf-to-html.ts";

const outputDirPath = resolve("data/work/test");

describe("covid publication metadata footnotes", () => {
  let covidHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    const outputPath = join(outputDirPath, "covid-publication-footnotes.html");
    await convertPdfToHtml({
      inputPdfPath: resolve("data/covid.pdf"),
      outputHtmlPath: outputPath,
    });
    covidHtml = await readFile(outputPath, "utf8");
  });

  it("moves first-page publication metadata out of the abstract flow and into document-end footnotes", () => {
    const footnoteBlockMatch = covidHtml.match(/<div class="footnotes">[\s\S]*?<\/div>/u);

    expect(footnoteBlockMatch).not.toBeNull();
    if (!footnoteBlockMatch) throw new Error("Expected footnotes block in converted covid HTML");

    const footnoteBlock = footnoteBlockMatch[0];
    expect(footnoteBlock).toContain("* Corresponding author at:");
    expect(footnoteBlock).toContain("E-mail address: s.aktaa@leeds.ac.uk");
    expect(footnoteBlock).toContain(
      "Received 20 December 2020; Received in revised form 6 February 2021; Accepted 1 March 2021",
    );
    expect(footnoteBlock).toContain("Available online 8 March 2021");
    expect(covidHtml.indexOf("</ol>")).toBeLessThan(covidHtml.indexOf('<div class="footnotes">'));

    const mainBodyWithoutFootnotes = covidHtml.replace(footnoteBlock, "");
    expect(mainBodyWithoutFootnotes).not.toContain("* Corresponding author at:");
    expect(mainBodyWithoutFootnotes).not.toContain("E-mail address: s.aktaa@leeds.ac.uk");
    expect(mainBodyWithoutFootnotes).not.toContain(
      "Received 20 December 2020; Received in revised form 6 February 2021; Accepted 1 March 2021",
    );
  });
});
