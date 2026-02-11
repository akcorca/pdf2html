import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { convertPdfToHtml } from "./pdf-to-html.ts";

const outputDirPath = resolve("data/work/test");

describe("respect.pdf paragraph merging", () => {
  let respectHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    const outputPath = join(outputDirPath, "respect.html");
    await convertPdfToHtml({
      inputPdfPath: resolve("data/respect.pdf"),
      outputHtmlPath: outputPath,
    });
    respectHtml = await readFile(outputPath, "utf8");
  });

  it("merges same-row split sentence fragments before lowercase continuation lines", () => {
    expect(respectHtml).toContain(
      "Our contributions are two-fold as follows: LLMs reflect human desire We observed that impolite prompts often result in poor performance",
    );
    expect(respectHtml).not.toContain(
      "<p>Our contributions are two-fold as follows: LLMs reflect human desire</p>",
    );
    expect(respectHtml).not.toContain("<p>We observed that</p>");
  });

  it("merges paragraph continuations when the previous line ends with an inline footnote marker", () => {
    expect(respectHtml).toContain(
      '<p>We use the following languages, LLMs, and <sup id="fnref4"><a href="#fn4" class="footnote-ref">4</a></sup> prompts for our experiments.</p>',
    );
    expect(respectHtml).not.toContain(
      '<p>We use the following languages, LLMs, and <sup id="fnref4"><a href="#fn4" class="footnote-ref">4</a></sup></p>\n<p>prompts for our experiments.</p>',
    );
  });
});
