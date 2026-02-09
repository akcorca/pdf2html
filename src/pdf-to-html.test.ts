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

  it("removes repeated running headers and standalone page number lines", () => {
    expect(covidHtml).not.toContain("<p>Thrombosis Research 202 (2021) 17–23</p>");
    expect(covidHtml).not.toMatch(/<p>\d{1,3}<\/p>/);
  });

  it("strips repeated running header text when it is prefixed to body lines", () => {
    expect(covidHtml).not.toMatch(/<p>Thrombosis Research 202 \(2021\) 17–23\b/);
  });

  it("extracts respect paper title as an h1 heading", () => {
    expect(respectHtml).toContain(
      "<h1>Should We Respect LLMs? A Cross-Lingual Study on</h1>",
    );
  });

  it("does not merge left and right column text into the same line for respect.pdf", () => {
    expect(respectHtml).not.toContain("does not nessandrespectmayhavedifferentdefinitionsand");
  });

  it("extracts tft paper title as an h1 heading when font metadata is unreliable", () => {
    expect(tftHtml).toContain("<h1>Multifunctional Organic-Semiconductor Interfacial</h1>");
  });

  it("renders numbered section headings in attention.pdf as semantic headings", () => {
    expect(html).toContain("<h2>1 Introduction</h2>");
  });

  it("removes repeated running-label header lines from tft.pdf", () => {
    expect(tftHtml).not.toContain("<p>COMMUNICATION</p>");
  });
});
