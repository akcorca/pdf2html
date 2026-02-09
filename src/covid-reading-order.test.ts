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

  it("keeps 2.2 subsection heading after 2.1 and renders it as semantic heading", () => {
    const methodsHeading = "<h2>2. Methods</h2>";
    const dataCollectionHeading = "<h3>2.1. Data collection</h3>";
    const deathDataHeading = "<h3>2.2. Death data</h3>";

    expect(covidHtml).toContain(methodsHeading);
    expect(covidHtml).toContain(dataCollectionHeading);
    expect(covidHtml).toContain(deathDataHeading);
    expect(covidHtml.indexOf(methodsHeading)).toBeLessThan(covidHtml.indexOf(dataCollectionHeading));
    expect(covidHtml.indexOf(dataCollectionHeading)).toBeLessThan(covidHtml.indexOf(deathDataHeading));
    expect(covidHtml).not.toContain("<p>2.2. Death data</p>");
  });
});
