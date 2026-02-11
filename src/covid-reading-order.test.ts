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

  it("keeps the abstract Interpretation continuation before the Research in context heading", () => {
    const interpretationContinuation =
      "state associated with COVID-19 infection and potential impact of delays in seeking help.";
    const researchHeading = "<h2>Research in context</h2>";

    expect(covidHtml).toContain(interpretationContinuation);
    expect(covidHtml).toContain(researchHeading);
    expect(covidHtml.indexOf(interpretationContinuation)).toBeLessThan(
      covidHtml.indexOf(researchHeading),
    );
  });

  it("keeps the Abstract keyword label separate from the Background sentence", () => {
    const keywordsLine = "<p>Keywords:</p>";
    const backgroundLinePrefix =
      "<p>Background: Evidence supports an excess of deaths during the COVID-19 pandemic.";
    const mergedLinePrefix = "<p>Keywords: Background:";

    expect(covidHtml).toContain(keywordsLine);
    expect(covidHtml).toContain(backgroundLinePrefix);
    expect(covidHtml).not.toContain(mergedLinePrefix);
    expect(covidHtml.indexOf(keywordsLine)).toBeLessThan(covidHtml.indexOf(backgroundLinePrefix));
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

  it("keeps numbered references in ascending order across two-column transitions", () => {
    const reference24 = "<li>[24]";
    const reference30 = "<li>[30]";
    const reference31 = "<li>[31]";

    expect(covidHtml).toContain(reference24);
    expect(covidHtml).toContain(reference30);
    expect(covidHtml).toContain(reference31);
    expect(covidHtml.indexOf(reference24)).toBeLessThan(covidHtml.indexOf(reference31));
    expect(covidHtml.indexOf(reference30)).toBeLessThan(covidHtml.indexOf(reference31));
  });

  it("should correctly order keywords before the abstract body", () => {
    const keyword = "<p>Thrombo-embolic events</p>";
    const abstractBody = "mortality of thrombo-embolic events";
    expect(covidHtml.indexOf(keyword)).toBeLessThan(covidHtml.indexOf(abstractBody));
  });

  it("keeps the full keyword sidebar block before the abstract Background sentence", () => {
    const lastKeywordLine = "<p>Pulmonary embolism</p>";
    const mergedBackgroundSentence =
      "Background: Evidence supports an excess of deaths during the COVID-19 pandemic. We report the incidence and mortality of thrombo-embolic events (TE) during the COVID-19 pandemic.";

    expect(covidHtml).toContain(lastKeywordLine);
    expect(covidHtml).toContain(mergedBackgroundSentence);
    expect(covidHtml.indexOf(lastKeywordLine)).toBeLessThan(
      covidHtml.indexOf(mergedBackgroundSentence),
    );
  });

  it("promotes back-matter section labels to semantic headings", () => {
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

  it("merges appendix URL wraps into one linked paragraph", () => {
    const mergedAppendixUrlLine =
      '<p>Supplementary data to this article can be found online at <a href="https://doi.org/10.1016/j.thromres.2021.03.006">https://doi.org/10.1016/j.thromres.2021.03.006</a>.</p>';

    expect(covidHtml).toContain(mergedAppendixUrlLine);
    expect(covidHtml).not.toContain(
      "<p>Supplementary data to this article can be found online at https://doi.</p>",
    );
    expect(covidHtml).not.toContain("<p>org/10.1016/j.thromres.2021.03.006.</p>");
  });
});
