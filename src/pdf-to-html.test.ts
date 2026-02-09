import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { convertPdfToHtml, pdfToHtmlInternals } from "./pdf-to-html.ts";

const attentionPdfPath = resolve("data/attention.pdf");
const cleanPdfPath = resolve("data/clean.pdf");
const covidPdfPath = resolve("data/covid.pdf");
const outputDirPath = resolve("data/work/test");
const outputHtmlPath = join(outputDirPath, "attention.html");
const cleanOutputHtmlPath = join(outputDirPath, "clean.html");
const covidOutputHtmlPath = join(outputDirPath, "covid.html");

describe("convertPdfToHtml", () => {
  let html = "";
  let cleanHtml = "";
  let covidHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    await convertPdfToHtml({
      inputPdfPath: attentionPdfPath,
      outputHtmlPath,
    });
    await convertPdfToHtml({
      inputPdfPath: cleanPdfPath,
      outputHtmlPath: cleanOutputHtmlPath,
    });
    await convertPdfToHtml({
      inputPdfPath: covidPdfPath,
      outputHtmlPath: covidOutputHtmlPath,
    });
    html = await readFile(outputHtmlPath, "utf8");
    cleanHtml = await readFile(cleanOutputHtmlPath, "utf8");
    covidHtml = await readFile(covidOutputHtmlPath, "utf8");
  });

  it("extracts the paper title as an h1 heading", () => {
    expect(html).toContain("<h1>Attention Is All You Need</h1>");
  });

  it("does not use the arXiv side metadata as the document h1", () => {
    expect(html).not.toContain("<h1>arXiv:1706.03762v7 [cs.CL] 2 Aug 2023</h1>");
  });

  it("ignores extremely out-of-page text artifacts for clean.pdf", () => {
    expect(cleanHtml).not.toContain("Name Admission Date Address Abby Fri Jan 1st");
  });

  it("removes repeated running headers and standalone page number lines", () => {
    expect(covidHtml).not.toContain("<p>Thrombosis Research 202 (2021) 17–23</p>");
    expect(covidHtml).not.toMatch(/<p>\d{1,3}<\/p>/);
  });
});

describe("pdfToHtmlInternals", () => {
  it("finds the centered title candidate on the first page", () => {
    const titleLine = createLine({
      text: "Attention Is All You Need",
      x: 210,
      y: 630,
      fontSize: 20,
      estimatedWidth: 220,
    });
    const lines = [
      createLine({
        text: "Provided proper attribution is provided by Elsevier",
        x: 60,
        y: 700,
        fontSize: 14,
        estimatedWidth: 500,
      }),
      titleLine,
      createLine({
        text: "Abstract",
        x: 280,
        y: 390,
        fontSize: 12,
        estimatedWidth: 60,
      }),
    ];

    expect(pdfToHtmlInternals.findTitleLine(lines)).toBe(titleLine);
  });

  it("returns undefined when no line is a valid title candidate", () => {
    const lines = [
      createLine({
        text: "intro",
        y: 300,
        fontSize: 10,
      }),
    ];

    expect(pdfToHtmlInternals.findTitleLine(lines)).toBeUndefined();
  });

  it("estimates body font size from frequencies and has a fallback", () => {
    expect(pdfToHtmlInternals.estimateBodyFontSize([])).toBe(10);
    expect(
      pdfToHtmlInternals.estimateBodyFontSize([
        createLine({ fontSize: 10 }),
        createLine({ fontSize: 10 }),
        createLine({ fontSize: 11 }),
      ]),
    ).toBe(10);
  });

  it("scores title candidates based on size, center alignment and vertical position", () => {
    const score = pdfToHtmlInternals.scoreTitleCandidate(
      createLine({
        fontSize: 18,
        x: 200,
        y: 620,
        estimatedWidth: 220,
      }),
      10,
    );

    expect(score).toBeGreaterThan(5);
  });

  it("estimates line width from position span and text width", () => {
    expect(
      pdfToHtmlInternals.estimateLineWidth([
        { text: "a", x: 0, y: 10, fontSize: 10 },
        { text: "b", x: 100, y: 10, fontSize: 10 },
      ]),
    ).toBe(100);

    expect(
      pdfToHtmlInternals.estimateLineWidth([
        { text: "very-long-fragment", x: 0, y: 10, fontSize: 10 },
      ]),
    ).toBeGreaterThan(80);
  });

  it("normalizes spacing and escapes html characters", () => {
    expect(pdfToHtmlInternals.normalizeSpacing("a   b\n c")).toBe("a b c");
    expect(pdfToHtmlInternals.escapeHtml("<a&b>")).toBe("&lt;a&amp;b&gt;");
  });

  it("creates extraction errors for missing python and stderr output", () => {
    const missingPython = Object.assign(new Error("spawn python3 ENOENT"), {
      code: "ENOENT",
    });
    const withStderr = Object.assign(new Error("failed"), {
      stderr: "bad pdf",
    });

    expect(pdfToHtmlInternals.createExtractionError(missingPython).message).toBe(
      "python3 command not found.",
    );
    expect(pdfToHtmlInternals.createExtractionError(withStderr).message).toBe(
      "Failed to extract text from PDF: bad pdf",
    );
  });

  it("renders title as h1 and escapes body text", () => {
    const html = pdfToHtmlInternals.renderHtml([
      createLine({
        text: "Attention Is All You Need",
        x: 210,
        y: 630,
        fontSize: 17,
        estimatedWidth: 220,
      }),
      createLine({
        text: "a < b & c",
        x: 100,
        y: 500,
      }),
    ]);

    expect(html).toContain("<h1>Attention Is All You Need</h1>");
    expect(html).toContain("<p>a &lt; b &amp; c</p>");
  });

  it("filters repeated edge headers and standalone page numbers", () => {
    const filtered = pdfToHtmlInternals.filterPageArtifacts([
      createLine({ pageIndex: 0, y: 790, text: "Journal Header" }),
      createLine({ pageIndex: 0, y: 420, text: "Body paragraph one" }),
      createLine({ pageIndex: 0, y: 10, text: "1" }),
      createLine({ pageIndex: 1, y: 790, text: "Journal Header" }),
      createLine({ pageIndex: 1, y: 410, text: "Body paragraph two" }),
      createLine({ pageIndex: 1, y: 10, text: "2" }),
      createLine({ pageIndex: 2, y: 790, text: "Journal Header" }),
      createLine({ pageIndex: 2, y: 400, text: "Body paragraph three" }),
      createLine({ pageIndex: 2, y: 10, text: "3" }),
      createLine({ pageIndex: 3, y: 790, text: "Journal Header" }),
      createLine({ pageIndex: 3, y: 390, text: "Body paragraph four" }),
      createLine({ pageIndex: 3, y: 10, text: "4" }),
    ]);

    expect(filtered.map((line) => line.text)).toEqual([
      "Body paragraph one",
      "Body paragraph two",
      "Body paragraph three",
      "Body paragraph four",
    ]);
  });

  it("keeps repeated body text that is not near page edges", () => {
    const filtered = pdfToHtmlInternals.filterPageArtifacts([
      createLine({ pageIndex: 0, y: 760, text: "Header" }),
      createLine({ pageIndex: 0, y: 420, text: "Repeated body phrase" }),
      createLine({ pageIndex: 0, y: 20, text: "1" }),
      createLine({ pageIndex: 1, y: 760, text: "Header" }),
      createLine({ pageIndex: 1, y: 430, text: "Repeated body phrase" }),
      createLine({ pageIndex: 1, y: 20, text: "2" }),
    ]);

    expect(filtered.map((line) => line.text)).toContain("Repeated body phrase");
  });

  it("keeps sparse edge numbers when they do not form a page-number sequence", () => {
    const filtered = pdfToHtmlInternals.filterPageArtifacts([
      createLine({ pageIndex: 0, y: 760, text: "Header once" }),
      createLine({ pageIndex: 0, y: 420, text: "Body paragraph one" }),
      createLine({ pageIndex: 0, y: 20, text: "1" }),
      createLine({ pageIndex: 1, y: 750, text: "Header twice" }),
      createLine({ pageIndex: 1, y: 430, text: "Body paragraph two" }),
      createLine({ pageIndex: 1, y: 20, text: "2" }),
    ]);

    expect(filtered.map((line) => line.text)).toContain("1");
    expect(filtered.map((line) => line.text)).toContain("2");
  });
});

function createLine(overrides: Partial<{
  pageIndex: number;
  pageHeight: number;
  pageWidth: number;
  estimatedWidth: number;
  x: number;
  y: number;
  fontSize: number;
  text: string;
}> = {}) {
  return {
    pageIndex: 0,
    pageHeight: 792,
    pageWidth: 612,
    estimatedWidth: 100,
    x: 120,
    y: 500,
    fontSize: 10,
    text: "line",
    ...overrides,
  };
}
