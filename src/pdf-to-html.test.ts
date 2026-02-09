import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { convertPdfToHtml } from "./pdf-to-html.ts";

const outputDirPath = resolve("data/work/test");

describe("convertPdfToHtml", () => {
  let html = "";
  let cleanHtml = "";
  let covidHtml = "";
  let respectHtml = "";
  let tftHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    const pdfs = [
      { input: "data/attention.pdf", output: "attention.html" },
      { input: "data/clean.pdf", output: "clean.html" },
      { input: "data/covid.pdf", output: "covid.html" },
      { input: "data/respect.pdf", output: "respect.html" },
      { input: "data/tft.pdf", output: "tft.html" },
    ];
    for (const pdf of pdfs) {
      await convertPdfToHtml({
        inputPdfPath: resolve(pdf.input),
        outputHtmlPath: join(outputDirPath, pdf.output),
      });
    }
    html = await readFile(join(outputDirPath, "attention.html"), "utf8");
    cleanHtml = await readFile(join(outputDirPath, "clean.html"), "utf8");
    covidHtml = await readFile(join(outputDirPath, "covid.html"), "utf8");
    respectHtml = await readFile(join(outputDirPath, "respect.html"), "utf8");
    tftHtml = await readFile(join(outputDirPath, "tft.html"), "utf8");
  });

  it("extracts the paper title as an h1 heading", () => {
    expect(html).toContain("<h1>Attention Is All You Need</h1>");
  });

  it("does not use the arXiv side metadata as the document h1", () => {
    expect(html).not.toContain("<h1>arXiv:1706.03762v7 [cs.CL] 2 Aug 2023</h1>");
  });

  it("removes the arXiv side metadata line from the document body", () => {
    expect(html).not.toContain("<p>arXiv:1706.03762v7 [cs.CL] 2 Aug 2023</p>");
  });

  it("ignores extremely out-of-page text artifacts for clean.pdf", () => {
    expect(cleanHtml).not.toContain("Name Admission Date Address Abby Fri Jan 1st");
  });

  it("extracts clean paper title as an h1 heading", () => {
    expect(cleanHtml).toContain(
      "<h1>CleanAgent: Automating Data Standardization with LLM-based Agents</h1>",
    );
  });

  it("merges single-word wrapped clean paper title continuation into h1", () => {
    expect(cleanHtml).toContain(
      "<h1>CleanAgent: Automating Data Standardization with LLM-based Agents</h1>",
    );
    expect(cleanHtml).not.toContain("<p>Agents</p>");
  });

  it("does not treat figure flow labels as numbered section headings in clean.pdf", () => {
    expect(cleanHtml).not.toContain("<h2>1 Historical 5 Historical</h2>");
  });

  it("does not treat tiny flowchart step labels as numbered section headings in clean.pdf", () => {
    expect(cleanHtml).not.toContain("<h2>3 Historical</h2>");
    expect(cleanHtml).toContain("<p>3 Historical</p>");
  });

  it("merges wrapped numbered section headings in clean.pdf into a single semantic heading", () => {
    expect(cleanHtml).toContain("<h2>2 TYPE-SPECIFIC STANDARDIZATION API DESIGN</h2>");
    expect(cleanHtml).not.toContain("<h2>2 TYPE-SPECIFIC STANDARDIZATION API</h2>");
    expect(cleanHtml).not.toContain("<p>DESIGN</p>");
  });

  it("strips arXiv submission-stamp prefixes from clean.pdf body lines", () => {
    expect(cleanHtml).not.toMatch(
      /arXiv:\d{4}\.\d{4,5}v\d+\s+\[[^\]]+\]\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/,
    );
    expect(cleanHtml).toContain("scientist inputs their requirement to standardize “Admission Date”");
  });

  it("removes dense inline figure-label text from clean.pdf abstract area", () => {
    expect(cleanHtml).not.toContain("<p>I want the output format of the date</p>");
    expect(cleanHtml).not.toContain("<p>Input Table 𝑻</p>");
  });

  it("removes repeated running headers and standalone page number lines", () => {
    expect(covidHtml).not.toContain("<p>Thrombosis Research 202 (2021) 17–23</p>");
    expect(covidHtml).not.toMatch(/<p>\d{1,3}<\/p>/);
  });

  it("strips repeated running header text when it is prefixed to body lines", () => {
    expect(covidHtml).not.toMatch(/<p>Thrombosis Research 202 \(2021\) 17–23\b/);
  });

  it("removes repeated author running labels from covid.pdf", () => {
    expect(covidHtml).not.toContain("<p>S. Aktaa et al.</p>");
  });

  it("extracts covid paper title as an h1 heading even when page 1 is a cover/disclaimer page", () => {
    expect(covidHtml).toMatch(/<h1>[^<]*COVID-19 pandemic[^<]*<\/h1>/);
    expect(covidHtml).not.toContain("<h1>Thrombosis Research</h1>");
  });

  it("merges wrapped covid paper title lines around the detected title line into one h1", () => {
    expect(covidHtml).toContain(
      "<h1>Incidence and mortality due to thromboembolic events during the COVID-19 pandemic: Multi-sourced population-based health records cohort study</h1>",
    );
    expect(covidHtml).not.toContain(
      "<p>Incidence and mortality due to thromboembolic events during the</p>",
    );
    expect(covidHtml).not.toContain("<p>cohort study</p>");
  });

  it("renders dotted covid numbered section headings as semantic headings", () => {
    expect(covidHtml).toContain("<h2>1. Introduction</h2>");
    expect(covidHtml).toContain("<h3>2.1. Data collection</h3>");
    expect(covidHtml).not.toContain(
      "<h2>1. Introduction embolism [PE] and deep venous thrombosis [DVT]). Patients with acute</h2>",
    );
  });

  it("removes top-matter alphabetic affiliation markers from covid.pdf", () => {
    expect(covidHtml).not.toContain("<p>a , b , c , * a , d a , b , c e</p>");
    expect(covidHtml).not.toContain("<p>f f , g e , h a , b , c</p>");
  });

  it("merges wrapped respect paper title lines into a single h1 heading", () => {
    expect(respectHtml).toContain(
      "<h1>Should We Respect LLMs? A Cross-Lingual Study on the Influence of Prompt Politeness on LLM Performance</h1>",
    );
    expect(respectHtml).not.toContain(
      "<p>the Influence of Prompt Politeness on LLM Performance</p>",
    );
  });

  it("does not merge left and right column text into the same line for respect.pdf", () => {
    expect(respectHtml).not.toContain("does not nessandrespectmayhavedifferentdefinitionsand");
  });

  it("does not treat scored prompt-table rows as section headings in respect.pdf", () => {
    expect(respectHtml).not.toMatch(/<h[2-6]>\d+\s+[^<]*\s\d+\.\d{2}<\/h[2-6]>/);
  });

  it("removes standalone affiliation index marker lines in respect.pdf title block", () => {
    expect(respectHtml).not.toContain("<p>1 1 1 1 , 2 , 3 2 , 3</p>");
    expect(respectHtml).not.toContain("<p>1 2 3</p>");
  });

  it("preserves left-to-right reading order for two-column section headings in respect.pdf", () => {
    const sectionHeading = "<h2>5 Results</h2>";
    const rightColumnSubheading = "<h4>5.1.2 Chinese</h4>";
    expect(respectHtml).toContain(sectionHeading);
    expect(respectHtml).toContain(rightColumnSubheading);
    expect(respectHtml.indexOf(sectionHeading)).toBeLessThan(
      respectHtml.indexOf(rightColumnSubheading),
    );
  });

  it("moves numeric footnote URLs in respect.pdf to the end of the document", () => {
    const referencesHeading = "<h2>References</h2>";
    const footnoteUrl = "https://openai.com/product";
    expect(respectHtml).toContain(referencesHeading);
    expect(respectHtml).toContain(footnoteUrl);
    expect(respectHtml.indexOf(footnoteUrl)).toBeGreaterThan(respectHtml.indexOf(referencesHeading));
  });

  it("renders comma-containing numbered headings as semantic headings in respect.pdf", () => {
    expect(respectHtml).toContain("<h3>4.1 Languages, LLMs, and Prompt</h3>");
    expect(respectHtml).not.toContain("<p>4.1 Languages, LLMs, and Prompt</p>");
  });

  it("merges wrapped tft paper title lines into a single h1 heading", () => {
    expect(tftHtml).toContain(
      "<h1>Multifunctional Organic-Semiconductor Interfacial Layers for Solution-Processed Oxide-Semiconductor Thin-Film Transistor</h1>",
    );
    expect(tftHtml).not.toContain("<p>Layers for Solution-Processed Oxide-Semiconductor</p>");
    expect(tftHtml).not.toContain("<p>Thin-Film Transistor</p>");
  });

  it("renders Experimental Section in tft.pdf as a semantic heading", () => {
    expect(tftHtml).toContain("<h2>Experimental Section</h2>");
    expect(tftHtml).not.toContain("<p>Experimental Section</p>");
  });

  it("renders numbered section headings in attention.pdf as semantic headings", () => {
    expect(html).toContain("<h2>1 Introduction</h2>");
  });

  it("renders abstract heading in attention.pdf as semantic heading", () => {
    expect(html).toContain("<h2>Abstract</h2>");
  });

  it("splits inline acknowledgements heading in attention.pdf into a semantic heading", () => {
    expect(html).toContain("<h2>Acknowledgements</h2>");
    expect(html).toContain(
      "<p>We are grateful to Nal Kalchbrenner and Stephan Gouws for their fruitful</p>",
    );
    expect(html).not.toContain(
      "<p>Acknowledgements We are grateful to Nal Kalchbrenner and Stephan Gouws for their fruitful</p>",
    );
  });

  it("moves first-page footnotes in attention.pdf to the end of the document", () => {
    const footnoteText = "Equal contribution. Listing order is random.";
    const referencesHeading = "<h2>References</h2>";
    expect(html).toContain(footnoteText);
    expect(html).toContain(referencesHeading);
    expect(html.indexOf(footnoteText)).toBeGreaterThan(html.indexOf(referencesHeading));
  });

  it("removes standalone symbolic affiliation marker lines in attention.pdf title block", () => {
    expect(html).not.toContain("<p>∗ ∗ ∗ ∗</p>");
    expect(html).not.toContain("<p>∗ ∗ † ∗</p>");
    expect(html).not.toContain("<p>∗ ‡</p>");
  });

  it("removes first-page conference venue footer lines from attention.pdf", () => {
    expect(html).not.toContain(
      "<p>31st Conference on Neural Information Processing Systems (NIPS 2017), Long Beach, CA, USA.</p>",
    );
  });

  it("renders bullet lists in attention.pdf using ul/li semantics", () => {
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>In \"encoder-decoder attention\" layers,");
    expect(html).not.toContain("<p>• In \"encoder-decoder attention\" layers,");
  });

  it("renders wrapped repository URLs in attention.pdf as a single hyperlink", () => {
    expect(html).toContain(
      '<a href="https://github.com/tensorflow/tensor2tensor">https://github.com/tensorflow/tensor2tensor</a>',
    );
    expect(html).not.toContain("<p>https://github.com/</p>");
    expect(html).not.toContain("<p>tensorflow/tensor2tensor .</p>");
  });

  it("removes repeated running-label header lines from tft.pdf", () => {
    expect(tftHtml).not.toContain("<p>COMMUNICATION</p>");
  });

  it("removes publisher page-counter footer lines from tft.pdf", () => {
    expect(tftHtml).not.toMatch(/<p>[^<]*\(\d+\s+of\s+\d+\)[^<]*<\/p>/);
  });

  it("removes standalone citation marker lines from tft.pdf", () => {
    expect(tftHtml).not.toMatch(
      /<p>(?:\[\d{1,3}(?:,\s*\d{1,3})*\])(?:\s+\[\d{1,3}(?:,\s*\d{1,3})*\])*<\/p>/,
    );
  });

  it("does not merge left and right column body text into one line for tft.pdf", () => {
    expect(tftHtml).not.toContain(
      "<p>opment of new semiconductors and innovative processing must be overcome for further applications in low-cost, large-</p>",
    );
  });

  it("keeps left-column abstract text before right-column abstract text in tft.pdf", () => {
    const leftColumnLine = "<p>The stabilization and control of the electrical properties in solution-processed</p>";
    const rightColumnLine = "<p>various semiconductors, sputter-deposited</p>";
    expect(tftHtml).toContain(leftColumnLine);
    expect(tftHtml).toContain(rightColumnLine);
    expect(tftHtml.indexOf(leftColumnLine)).toBeLessThan(tftHtml.indexOf(rightColumnLine));
  });
});
