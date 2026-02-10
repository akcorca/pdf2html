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

  it("keeps Methods subsections in numeric order (2.1 -> 2.2 -> 2.3)", () => {
    const dataCollectionHeading = "<h3>2.1. Data collection</h3>";
    const deathDataHeading = "<h3>2.2. Death data</h3>";
    const statisticalHeading = "<h3>2.3. Statistical analyses</h3>";

    expect(covidHtml).toContain(dataCollectionHeading);
    expect(covidHtml).toContain(deathDataHeading);
    expect(covidHtml).toContain(statisticalHeading);
    expect(covidHtml.indexOf(dataCollectionHeading)).toBeLessThan(
      covidHtml.indexOf(deathDataHeading),
    );
    expect(covidHtml.indexOf(deathDataHeading)).toBeLessThan(
      covidHtml.indexOf(statisticalHeading),
    );
  });

  it("keeps left-column 2.1 body continuation before the right-column 2.2 heading", () => {
    const dataCollectionHeading = "<h3>2.1. Data collection</h3>";
    const leftBodyText = "re-hospitalisations due to TE during the study period were excluded";
    const deathDataHeading = "<h3>2.2. Death data</h3>";

    expect(covidHtml).toContain(dataCollectionHeading);
    expect(covidHtml).toContain(leftBodyText);
    expect(covidHtml).toContain(deathDataHeading);
    expect(covidHtml.indexOf(dataCollectionHeading)).toBeLessThan(
      covidHtml.indexOf(leftBodyText),
    );
    expect(covidHtml.indexOf(leftBodyText)).toBeLessThan(
      covidHtml.indexOf(deathDataHeading),
    );
  });

  it("renders inline research-in-context labels as semantic headings with body text", () => {
    const inlineMergedLine = "<p>Research in context: Evidence before this study</p>";
    const heading = "<h2>Research in context</h2>";
    const body = "<p>Evidence before this study</p>";

    expect(covidHtml).not.toContain(inlineMergedLine);
    expect(covidHtml).toContain(heading);
    expect(covidHtml).toContain(body);
    expect(covidHtml.indexOf(heading)).toBeLessThan(covidHtml.indexOf(body));
  });

  it("does not merge opposite-column lines into a single paragraph around the introduction transition", () => {
    expect(covidHtml).not.toContain("major cardio - on acute CV events");
  });

  it("reads left column of Introduction fully before right column", () => {
    // Left column starts: "Thrombo-embolism has been described as one of the major cardio-vascular..."
    // Left column ends near: "...the pandemic may also have had unintended consequences..."
    // Right column starts: "embolism [PE] and deep venous thrombosis [DVT])."
    const leftColumnIntroText = "contributing to worse outcomes";
    const rightColumnStartText = "embolism [PE] and deep venous thrombosis";

    expect(covidHtml).toContain(leftColumnIntroText);
    expect(covidHtml).toContain(rightColumnStartText);
    expect(covidHtml.indexOf(leftColumnIntroText)).toBeLessThan(
      covidHtml.indexOf(rightColumnStartText),
    );
  });

  it("does not interleave left and right column lines in Introduction section", () => {
    // These are left-column lines that should NOT be interrupted by right-column content
    // "vascular (CV) complications" is left column, "on acute CV events" is right column
    // In correct reading order, left-column "vascular" should come well before right-column "on acute CV events"
    const leftLine = "vascular (CV) complications";
    const rightLine = "on acute CV events";

    expect(covidHtml).toContain(leftLine);
    expect(covidHtml).toContain(rightLine);
    expect(covidHtml.indexOf(leftLine)).toBeLessThan(
      covidHtml.indexOf(rightLine),
    );
  });

  it("keeps the 2.3 left-column narrative contiguous before right-column statistical detail starts", () => {
    const leftNarrativeFragment =
      "patterns of change in admissions with different phenotypes of TE, as well as the causes and place of TE-related deaths antecedent, compared with during the";
    const rightColumnParagraphStart =
      "<p>Baseline characteristics were described using numbers and percent-ages for categorical data.";

    expect(covidHtml).toContain(leftNarrativeFragment);
    expect(covidHtml).toContain(rightColumnParagraphStart);
    expect(covidHtml.indexOf(leftNarrativeFragment)).toBeLessThan(
      covidHtml.indexOf(rightColumnParagraphStart),
    );
  });
});
