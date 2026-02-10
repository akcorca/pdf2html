import { describe, it, expect } from "vitest";
import { pdfToHtmlInternals } from "./pdf-to-html.ts";
import { extractDocument } from "./pdf-extract.ts";

describe("author block", () => {
  it("should parse authors into a structured block", async () => {
    const pdf = await extractDocument("data/attention.pdf");
    const lines = pdfToHtmlInternals.filterPageArtifacts(
      pdfToHtmlInternals.collectTextLines(pdf),
    );
    const html = pdfToHtmlInternals.renderHtml(lines, pdf);
    const normalize = (str: string) => str.replace(/\s+/g, " ").trim();
    const normalizedHtml = normalize(html);

    expect(normalizedHtml).toContain(normalize('<div class="authors">'));
    expect((html.match(/<div class="author">/g) ?? []).length).toBe(8);

    const expectedAuthors = [
      {
        name: "Ashish Vaswani",
        email: "avaswani@google.com",
        affiliation: "Google Brain",
      },
      {
        name: "Noam Shazeer",
        email: "noam@google.com",
        affiliation: "Google Brain",
      },
      {
        name: "Niki Parmar",
        email: "nikip@google.com",
        affiliation: "Google Research",
      },
      {
        name: "Jakob Uszkoreit",
        email: "usz@google.com",
        affiliation: "Google Research",
      },
      {
        name: "Llion Jones",
        email: "llion@google.com",
        affiliation: "Google Research",
      },
      {
        name: "Aidan N. Gomez",
        email: "aidan@cs.toronto.edu",
        affiliation: "University of Toronto",
      },
      {
        name: "Łukasz Kaiser",
        email: "lukaszkaiser@google.com",
        affiliation: "Google Brain",
      },
      {
        name: "Illia Polosukhin",
        email: "illia.polosukhin@gmail.com",
      },
    ];

    for (const author of expectedAuthors) {
      const pieces = [
        `<div class="name">${author.name}</div>`,
        author.affiliation ? `<div class="affiliation">${author.affiliation}</div>` : "",
        `<div class="email">${author.email}</div>`,
      ]
        .filter((part) => part.length > 0)
        .join(" ");
      expect(normalizedHtml).toContain(normalize(pieces));
    }
  });
});
