import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { convertPdfToHtml } from "./pdf-to-html.ts";

const outputDirPath = resolve("data/work/test");

describe("respect-footnotes", () => {
  let respectHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    await convertPdfToHtml({
      inputPdfPath: resolve("data/respect.pdf"),
      outputHtmlPath: join(outputDirPath, "respect-footnotes.html"),
    });
    respectHtml = await readFile(join(outputDirPath, "respect-footnotes.html"), "utf8");
  });

  it("links footnote markers in the text to the footnote section", () => {
    expect(respectHtml).toMatch(
      /<sup id="fnref\d+"><a href="#fn\d+" class="footnote-ref">\d+<\/a><\/sup>/,
    );
  });
});
