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
      "<h1>CleanAgent: Automating Data Standardization with LLM-based</h1>",
    );
  });

  it("does not treat figure flow labels as numbered section headings in clean.pdf", () => {
    expect(cleanHtml).not.toContain("<h2>1 Historical 5 Historical</h2>");
  });

  it("strips arXiv submission-stamp prefixes from clean.pdf body lines", () => {
    expect(cleanHtml).not.toMatch(
      /arXiv:\d{4}\.\d{4,5}v\d+\s+\[[^\]]+\]\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/,
    );
    expect(cleanHtml).toContain("scientist inputs their requirement to standardize “Admission Date”");
  });

  it("removes repeated running headers and standalone page number lines", () => {
    expect(covidHtml).not.toContain("<p>Thrombosis Research 202 (2021) 17–23</p>");
    expect(covidHtml).not.toMatch(/<p>\d{1,3}<\/p>/);
  });

  it("strips repeated running header text when it is prefixed to body lines", () => {
    expect(covidHtml).not.toMatch(/<p>Thrombosis Research 202 \(2021\) 17–23\b/);
  });

  it("extracts covid paper title as an h1 heading even when page 1 is a cover/disclaimer page", () => {
    expect(covidHtml).toMatch(
      /<h1>(?:Incidence and mortality due to thromboembolic events during the|COVID-19 pandemic: Multi-sourced population-based health records)<\/h1>/,
    );
    expect(covidHtml).not.toContain("<h1>Thrombosis Research</h1>");
  });

  it("separates covid section-heading lines from opposite-column spill text", () => {
    expect(covidHtml).toContain("<p>1. Introduction</p>");
    expect(covidHtml).not.toContain(
      "<p>1. Introduction embolism [PE] and deep venous thrombosis [DVT]). Patients with acute</p>",
    );
  });

  it("extracts respect paper title as an h1 heading", () => {
    expect(respectHtml).toContain(
      "<h1>Should We Respect LLMs? A Cross-Lingual Study on</h1>",
    );
  });

  it("does not merge left and right column text into the same line for respect.pdf", () => {
    expect(respectHtml).not.toContain("does not nessandrespectmayhavedifferentdefinitionsand");
  });

  it("does not treat scored prompt-table rows as section headings in respect.pdf", () => {
    expect(respectHtml).not.toMatch(/<h[2-6]>\d+\s+[^<]*\s\d+\.\d{2}<\/h[2-6]>/);
  });

  it("extracts tft paper title as an h1 heading when font metadata is unreliable", () => {
    expect(tftHtml).toContain("<h1>Multifunctional Organic-Semiconductor Interfacial</h1>");
  });

  it("renders numbered section headings in attention.pdf as semantic headings", () => {
    expect(html).toContain("<h2>1 Introduction</h2>");
  });

  it("renders abstract heading in attention.pdf as semantic heading", () => {
    expect(html).toContain("<h2>Abstract</h2>");
  });

  it("renders bullet lists in attention.pdf using ul/li semantics", () => {
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>In \"encoder-decoder attention\" layers,");
    expect(html).not.toContain("<p>• In \"encoder-decoder attention\" layers,");
  });

  it("removes repeated running-label header lines from tft.pdf", () => {
    expect(tftHtml).not.toContain("<p>COMMUNICATION</p>");
  });

  it("removes standalone citation marker lines from tft.pdf", () => {
    expect(tftHtml).not.toMatch(
      /<p>(?:\[\d{1,3}(?:,\s*\d{1,3})*\])(?:\s+\[\d{1,3}(?:,\s*\d{1,3})*\])*<\/p>/,
    );
  });
});
