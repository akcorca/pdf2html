import { describe, expect, it } from "vitest";
import { pdfToHtmlInternals } from "./pdf-to-html.ts";
import type { ExtractedFragment, TextLine } from "./pdf-types.ts";

describe("pdfToHtmlInternals", () => {
  it("finds the centered title candidate on the first page", () => {
    const titleLine = line({ text: "Attention Is All You Need", x: 210, y: 630, fontSize: 20, estimatedWidth: 220 });
    const lines = [
      line({ text: "Provided proper attribution is provided by Elsevier", x: 60, y: 700, fontSize: 14, estimatedWidth: 500 }),
      titleLine,
      line({ text: "Abstract", x: 280, y: 390, fontSize: 12, estimatedWidth: 60 }),
    ];
    expect(pdfToHtmlInternals.findTitleLine(lines)).toBe(titleLine);
  });

  it("returns undefined when no line is a valid title candidate", () => {
    expect(pdfToHtmlInternals.findTitleLine([line({ text: "intro", y: 300, fontSize: 10 })])).toBeUndefined();
  });

  it("finds a title when page coordinates are negative and size increase is moderate", () => {
    const titleLine = line({ text: "Should We Respect LLMs? A Cross-Lingual Study on", y: -18, x: 60, fontSize: 14.3, estimatedWidth: 360 });
    const lines = [
      line({ text: "1 and 2023 Vilkki", y: 0, x: 0, fontSize: 10.9, estimatedWidth: 130 }),
      titleLine,
      line({ text: "the Influence of Prompt Politeness on LLM Performance", y: -34, x: 51.5, fontSize: 14.3, estimatedWidth: 380 }),
      line({ text: "We investigate the impact of politeness levels in prompts", y: -180, x: 16, fontSize: 10.9, estimatedWidth: 520 }),
      line({ text: "1 Introduction", y: -444, x: 0, fontSize: 12, estimatedWidth: 100 }),
    ];
    expect(pdfToHtmlInternals.findTitleLine(lines)).toBe(titleLine);
  });

  it("does not treat dense same-font disclaimer blocks as titles", () => {
    const lines = [
      line({ text: "Since January 2020 Elsevier has created a COVID - 19 resource centre with", x: 74, y: 542, fontSize: 14, estimatedWidth: 518 }),
      line({ text: "free information in English and Mandarin on the novel coronavirus COVID -", x: 76, y: 518, fontSize: 14, estimatedWidth: 518 }),
      line({ text: "19. The COVID - 19 resource centre is hosted on Elsevier Connect, the", x: 89, y: 494, fontSize: 14, estimatedWidth: 482 }),
      line({ text: "company's public news and information website.", x: 156, y: 470, fontSize: 14, estimatedWidth: 329 }),
      line({ pageIndex: 1, text: "Body paragraph", fontSize: 9 }),
    ];
    expect(pdfToHtmlInternals.findTitleLine(lines)).toBeUndefined();
  });

  it("estimates body font size from frequencies and has a fallback", () => {
    expect(pdfToHtmlInternals.estimateBodyFontSize([])).toBe(10);
    expect(pdfToHtmlInternals.estimateBodyFontSize([
      line({ fontSize: 10 }), line({ fontSize: 10 }), line({ fontSize: 11 }),
    ])).toBe(10);
  });

  it("scores title candidates based on size, center alignment and vertical position", () => {
    const score = pdfToHtmlInternals.scoreTitleCandidate(
      line({ fontSize: 18, x: 200, y: 620, estimatedWidth: 220 }), 10,
    );
    expect(score).toBeGreaterThan(5);
  });

  it("estimates line width from position span and text width", () => {
    const frag = (text: string, x: number): ExtractedFragment => ({ text, x, y: 10, fontSize: 10 });
    expect(pdfToHtmlInternals.estimateLineWidth([frag("a", 0), frag("b", 100)])).toBe(100);
    expect(pdfToHtmlInternals.estimateLineWidth([frag("very-long-fragment", 0)])).toBeGreaterThan(80);
  });

  it("splits heading-prefixed rows even when a page is not globally multi-column", () => {
    const lines = pdfToHtmlInternals.collectTextLines({
      pages: [
        {
          pageIndex: 0,
          width: 600,
          height: 800,
          fragments: [
            frag({ text: "Regular body text near top", x: 40, y: 760 }),
            frag({ text: "1.", x: 40, y: 700 }),
            frag({ text: "Introduction", x: 52, y: 700 }),
            frag({ text: "right column carryover text", x: 320, y: 700 }),
            frag({ text: "Another body paragraph line", x: 40, y: 640 }),
          ],
        },
      ],
    });

    expect(lines.some((line) => line.text === "1. Introduction")).toBe(true);
    expect(lines.some((line) => line.text === "right column carryover text")).toBe(true);
    expect(
      lines.some((line) => line.text === "1. Introduction right column carryover text"),
    ).toBe(false);
  });

  it("normalizes spacing and escapes html characters", () => {
    expect(pdfToHtmlInternals.normalizeSpacing("a   b\n c")).toBe("a b c");
    expect(pdfToHtmlInternals.escapeHtml("<a&b>")).toBe("&lt;a&amp;b&gt;");
  });

  it("renders title as h1 and escapes body text", () => {
    const html = pdfToHtmlInternals.renderHtml([
      line({ text: "Attention Is All You Need", x: 210, y: 630, fontSize: 17, estimatedWidth: 220 }),
      line({ text: "a < b & c", x: 100, y: 500 }),
    ]);
    expect(html).toContain("<h1>Attention Is All You Need</h1>");
    expect(html).toContain("<p>a &lt; b &amp; c</p>");
  });

  it("detects heading levels for numbered section headings", () => {
    expect(pdfToHtmlInternals.detectNumberedHeadingLevel("1 Introduction")).toBe(2);
    expect(pdfToHtmlInternals.detectNumberedHeadingLevel("3.2 Attention")).toBe(3);
    expect(pdfToHtmlInternals.detectNumberedHeadingLevel("3.2.1 Scaled Dot-Product Attention")).toBe(4);
    expect(pdfToHtmlInternals.detectNumberedHeadingLevel("1 and 2023 Vilkki")).toBeUndefined();
    expect(pdfToHtmlInternals.detectNumberedHeadingLevel("35 Baekbeom-ro, Mapo-gu, Seoul 04107, Republic of Korea")).toBeUndefined();
    expect(pdfToHtmlInternals.detectNumberedHeadingLevel("2 V − 1 s − 1 and an")).toBeUndefined();
    expect(pdfToHtmlInternals.detectNumberedHeadingLevel("2015 See et al. 2017 2021 , Lin Liangetal. , 2022")).toBeUndefined();
    expect(pdfToHtmlInternals.detectNumberedHeadingLevel("7 Could you please (Task Description) ? Please (Answer Format) You do not have to (Answer Restriction) 5.97")).toBeUndefined();
  });

  it("detects heading levels for common unnumbered section headings", () => {
    expect(pdfToHtmlInternals.detectNamedSectionHeadingLevel("Abstract")).toBe(2);
    expect(pdfToHtmlInternals.detectNamedSectionHeadingLevel("References")).toBe(2);
    expect(pdfToHtmlInternals.detectNamedSectionHeadingLevel("Conclusion")).toBe(2);
    expect(pdfToHtmlInternals.detectNamedSectionHeadingLevel("In this work, we show")).toBeUndefined();
  });

  it("filters repeated edge headers and standalone page numbers", () => {
    const filtered = pdfToHtmlInternals.filterPageArtifacts([
      line({ pageIndex: 0, y: 790, text: "Journal Header" }),
      line({ pageIndex: 0, y: 420, text: "Body paragraph one" }),
      line({ pageIndex: 0, y: 10, text: "1" }),
      line({ pageIndex: 1, y: 790, text: "Journal Header" }),
      line({ pageIndex: 1, y: 410, text: "Body paragraph two" }),
      line({ pageIndex: 1, y: 10, text: "2" }),
      line({ pageIndex: 2, y: 790, text: "Journal Header" }),
      line({ pageIndex: 2, y: 400, text: "Body paragraph three" }),
      line({ pageIndex: 2, y: 10, text: "3" }),
      line({ pageIndex: 3, y: 790, text: "Journal Header" }),
      line({ pageIndex: 3, y: 390, text: "Body paragraph four" }),
      line({ pageIndex: 3, y: 10, text: "4" }),
    ]);
    expect(filtered.map((l) => l.text)).toEqual([
      "Body paragraph one", "Body paragraph two", "Body paragraph three", "Body paragraph four",
    ]);
  });

  it("keeps repeated body text that is not near page edges", () => {
    const filtered = pdfToHtmlInternals.filterPageArtifacts([
      line({ pageIndex: 0, y: 760, text: "Header" }),
      line({ pageIndex: 0, y: 420, text: "Repeated body phrase" }),
      line({ pageIndex: 0, y: 20, text: "1" }),
      line({ pageIndex: 1, y: 760, text: "Header" }),
      line({ pageIndex: 1, y: 430, text: "Repeated body phrase" }),
      line({ pageIndex: 1, y: 20, text: "2" }),
    ]);
    expect(filtered.map((l) => l.text)).toContain("Repeated body phrase");
  });

  it("filters repeated uppercase running labels even with mixed edge/non-edge placements", () => {
    const filtered = pdfToHtmlInternals.filterPageArtifacts([
      line({ pageIndex: 0, y: 780, text: "COMMUNICATION" }),
      line({ pageIndex: 0, y: 500, text: "COMMUNICATION" }),
      line({ pageIndex: 0, y: 420, text: "Body paragraph one" }),
      line({ pageIndex: 1, y: 780, text: "COMMUNICATION" }),
      line({ pageIndex: 1, y: 500, text: "COMMUNICATION" }),
      line({ pageIndex: 1, y: 420, text: "Body paragraph two" }),
      line({ pageIndex: 2, y: 780, text: "COMMUNICATION" }),
      line({ pageIndex: 2, y: 500, text: "COMMUNICATION" }),
      line({ pageIndex: 2, y: 420, text: "Body paragraph three" }),
      line({ pageIndex: 3, y: 780, text: "COMMUNICATION" }),
      line({ pageIndex: 3, y: 500, text: "COMMUNICATION" }),
      line({ pageIndex: 3, y: 420, text: "Body paragraph four" }),
    ]);
    expect(filtered.map((l) => l.text)).not.toContain("COMMUNICATION");
  });

  it("keeps sparse edge numbers when they do not form a page-number sequence", () => {
    const filtered = pdfToHtmlInternals.filterPageArtifacts([
      line({ pageIndex: 0, y: 760, text: "Header once" }),
      line({ pageIndex: 0, y: 420, text: "Body paragraph one" }),
      line({ pageIndex: 0, y: 20, text: "1" }),
      line({ pageIndex: 1, y: 750, text: "Header twice" }),
      line({ pageIndex: 1, y: 430, text: "Body paragraph two" }),
      line({ pageIndex: 1, y: 20, text: "2" }),
    ]);
    expect(filtered.map((l) => l.text)).toContain("1");
    expect(filtered.map((l) => l.text)).toContain("2");
  });
});

function line(overrides: Partial<TextLine> = {}): TextLine {
  return {
    pageIndex: 0, pageHeight: 792, pageWidth: 612,
    estimatedWidth: 100, x: 120, y: 500, fontSize: 10, text: "line",
    ...overrides,
  };
}

function frag(overrides: Partial<ExtractedFragment>): ExtractedFragment {
  return {
    text: "fragment",
    x: 0,
    y: 0,
    fontSize: 10,
    ...overrides,
  };
}
