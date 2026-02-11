// biome-ignore lint/nursery/noExcessiveLinesPerFile: fixture-based end-to-end assertions are intentionally centralized.
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

  it("preserves first-page author names in clean.pdf authors block", () => {
    expect(cleanHtml).toContain("Danrui Qi, Zhengjie Miao, Jiannan Wang");
  });

  it("removes repeated running-header author lines from clean.pdf body", () => {
    expect(cleanHtml).not.toContain(
      "<p>Danrui Qi, Zhengjie Miao, Jiannan Wang</p>",
    );
  });

  it("removes repeated running-header title lines from clean.pdf body", () => {
    expect(cleanHtml).not.toContain(
      "<p>CleanAgent: Automating Data Standardization with LLM-based Agents</p>",
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

  it("does not treat tiny flowchart step labels as semantic content in clean.pdf", () => {
    expect(cleanHtml).not.toContain("<h2>3 Historical</h2>");
    expect(cleanHtml).not.toContain("<p>3 Historical</p>");
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

  it("removes wrapped first-page figure caption lines from clean.pdf abstract area", () => {
    expect(cleanHtml).not.toContain(
      "<p>Figure 1: An example of automatic data standardization pro-</p>",
    );
    expect(cleanHtml).not.toContain("<p>cess with CleanAgent.</p>");
  });

  it("removes standalone symbol-only artifact lines from clean.pdf", () => {
    expect(cleanHtml).not.toContain("<p>!</p>");
    expect(cleanHtml).not.toContain("<p>)</p>");
  });

  it("merges hyphen-wrapped abstract lines in clean.pdf even in narrow two-column text blocks", () => {
    expect(cleanHtml).not.toContain(
      "<p>While tools like Pandas offer robust functionalities, their complex-</p>",
    );
    expect(cleanHtml).toContain(
      "While tools like Pandas offer robust functionalities, their complexity and the manual effort required for customizing code to diverse",
    );
  });

  it("merges unfinished left-column paragraph text before a right-column heading in clean.pdf", () => {
    const mergedParagraphPattern =
      /<p>To overcome these limitations, our key idea is to introduce a Python library involving declarative and unified APIs specifically designed for standardizing different column types\. This idea lowers the burden of the LLM, as it now only needs to convert natural lan-?guage \(NL\) instructions into succinct, declarative API calls instead of lengthy, procedural code\. Such an approach simplifies the LLM’s code generation process for data standardization, requiring just a few lines of code\.<\/p>/;
    const section2 = "<h2>2 TYPE-SPECIFIC STANDARDIZATION API DESIGN</h2>";
    expect(cleanHtml).toMatch(mergedParagraphPattern);
    expect(cleanHtml).toContain(section2);
    const mergedParagraphMatch = cleanHtml.match(mergedParagraphPattern);
    expect(mergedParagraphMatch).toBeTruthy();
    const mergedParagraphText = mergedParagraphMatch?.[0] ?? "";
    expect(cleanHtml.indexOf(mergedParagraphText)).toBeLessThan(cleanHtml.indexOf(section2));
  });

  it("keeps clean.pdf numbered section headings in left-to-right column reading order", () => {
    const section3 = "<h2>3 CLEANAGENT WORKFLOW</h2>";
    const section4 = "<h2>4 EXPERIMENTS</h2>";
    expect(cleanHtml).toContain(section3);
    expect(cleanHtml).toContain(section4);
    expect(cleanHtml.indexOf(section3)).toBeLessThan(cleanHtml.indexOf(section4));
  });

  it("keeps trailing left-column sentence before the next numbered section heading in clean.pdf", () => {
    const trailingSentence = "advanced tools.";
    const section3 = "<h2>3 CLEANAGENT WORKFLOW</h2>";
    expect(cleanHtml).toContain(trailingSentence);
    expect(cleanHtml).toContain(section3);
    expect(cleanHtml.indexOf(trailingSentence)).toBeLessThan(cleanHtml.indexOf(section3));
  });

  it("keeps clean.pdf first-page right-column example content after the left-column section heading", () => {
    const section1 = "<h2>1 INTRODUCTION</h2>";
    const example2 = "Example 2. Still considering the data standardization task in";
    expect(cleanHtml).toContain(section1);
    expect(cleanHtml).toContain(example2);
    expect(cleanHtml.indexOf(section1)).toBeLessThan(cleanHtml.indexOf(example2));
  });

  it("keeps left-column sentence continuation before switching to the right-column paragraph in clean.pdf", () => {
    const leftColumnContinuation = "different date formats. The goal of data standardization is to unify";
    const rightColumnParagraphStart = "If the input table 𝑇 has other column types such as email and";
    expect(cleanHtml).toContain(leftColumnContinuation);
    expect(cleanHtml).toContain(rightColumnParagraphStart);
    expect(cleanHtml.indexOf(leftColumnContinuation)).toBeLessThan(
      cleanHtml.indexOf(rightColumnParagraphStart),
    );
  });

  it("renders numbered code examples in clean.pdf as semantic pre/code blocks", () => {
    expect(cleanHtml).toMatch(
      /<pre><code>1 def standardize_address \( addr \):[\s\S]*9 return f"\{ street \}, \{ state \}, \{ zipcode \}"<\/code><\/pre>/,
    );
    expect(cleanHtml).not.toContain("<p>1 def standardize_address ( addr ):</p>");
    expect(cleanHtml).not.toContain("<p>2 # Extract street number and street name</p>");
  });

  it("keeps wrapped code continuation lines inside numbered code blocks in clean.pdf", () => {
    expect(cleanHtml).not.toContain("<p>squeeze ()</p>");
    const squeezeCount = (cleanHtml.match(/squeeze \(\)/g) ?? []).length;
    expect(squeezeCount).toBeGreaterThanOrEqual(2);
  });

  it("merges left-column body paragraphs in clean.pdf Introduction instead of emitting single-line p tags", () => {
    // Left-column body paragraphs should be merged into coherent paragraphs,
    // not emitted as individual single-line <p> tags due to column interleaving
    expect(cleanHtml).toContain(
      "Previously, data scientists heavily relied on libraries such as Pandas [ 3 ] for data standardization tasks. Even though Pandas is a powerful tool, achieving data standardization often requires writing hundreds or thousands of lines of code.",
    );
    expect(cleanHtml).not.toContain(
      "<p>Previously, data scientists heavily relied on libraries such as</p>",
    );
  });

  it("does not interleave left and right column text in same paragraph for clean.pdf section 2 intro", () => {
    // Left-column text "The pursuit of simplicity, however, introduces two primary chal-
    // lenges." and right-column text "In this section, we first describe the common steps
    // of data stan-dardization." must NOT be merged into the same <p> tag.
    // They belong to different columns and should appear as separate paragraphs.
    expect(cleanHtml).not.toMatch(
      /chal-\s*lenges[^<]*In this section, we first describe/,
    );
    expect(cleanHtml).not.toMatch(
      /In this section[^<]*chal-\s*lenges/,
    );
    // The left-column paragraph about challenges should be a coherent paragraph
    expect(cleanHtml).toContain(
      "The pursuit of simplicity, however, introduces two primary chal-lenges.",
    );
    // The right-column paragraph should be a separate coherent paragraph
    expect(cleanHtml).toContain(
      "In this section, we first describe the common steps of data stan-dardization.",
    );
  });

  it("merges right-column body continuation near columnSplitX boundary in clean.pdf", () => {
    // The line "volves multi-turn dialogues" at x=317.731 is right-column text
    // that must not be misclassified as left-column (document splitX = 317.955).
    expect(cleanHtml).toContain(
      "method still necessitates detailed prompt crafting and often in-volves multi-turn dialogues",
    );
    // It must NOT merge with left-column text across the column boundary.
    expect(cleanHtml).not.toMatch(
      /in the cells of the .Admission Date.[^<]*volves multi-turn dialogues/,
    );
  });

  it("collapses duplicate sentence-prefix artifacts in clean.pdf lines", () => {
    expect(cleanHtml).not.toContain("Implementation. Implementation. CleanAgent");
    expect(cleanHtml).toContain("Implementation. CleanAgent is implemented");
  });

  it("does not split inline-formatted text within the same column into separate paragraphs in clean.pdf", () => {
    // "Common Steps of Data Standardization." (bold heading) followed by "Inspired by the steps of"
    // on the same line in the right column should not be split into separate paragraphs.
    expect(cleanHtml).toContain(
      "Common Steps of Data Standardization. Inspired by the steps of",
    );
    expect(cleanHtml).not.toContain("<p>Inspired by the steps of</p>");

    // "datetime column type" (italic) following "We take the" on the same line in the right column
    expect(cleanHtml).toContain(
      "We take the datetime column type",
    );
    expect(cleanHtml).not.toContain("<p>datetime column type</p>");

    // "datetime column" (italic) following "instance of the" should stay merged
    expect(cleanHtml).toContain(
      "instance of the datetime column, this",
    );
    expect(cleanHtml).not.toContain("<p>datetime column, this</p>");
  });

  it("merges same-row trailing entity fragments into one paragraph in clean.pdf section 5 intro", () => {
    expect(cleanHtml).toContain(
      "We developed a web-based user interface for CleanAgent , allowing users to simply upload their tables without performing any",
    );
    expect(cleanHtml).not.toContain("<p>We developed a web-based user interface for</p>");
    expect(cleanHtml).not.toContain("<p>CleanAgent , allow-</p>");
  });

  it("keeps clean.pdf Example 3 paragraph intact without right-column heading splice", () => {
    expect(cleanHtml).toMatch(/then returns\s+the standardized table 𝑇 \./);
    expect(cleanHtml).not.toContain(
      "<p>′ The Design of Unified APIs. The goal of our API design is to</p>",
    );
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

  it("drops pre-title cover-page disclaimer text from covid.pdf", () => {
    expect(covidHtml).not.toContain(
      "<p>Since January 2020 Elsevier has created a COVID - 19 resource centre with</p>",
    );
    expect(covidHtml).not.toContain("<p>Contents lists available at ScienceDirect</p>");
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

  it("merges spaced hyphen-wrapped covid abstract lines into a single paragraph", () => {
    expect(covidHtml).not.toMatch(/adjusted rela -<\/p>\s*<p>tive risk \[ARR\] 1\.43/);
    expect(covidHtml).toContain(
      "pandemic from 1090 to 1590",
    );
    expect(covidHtml).toContain(
      "adjusted rela-tive risk [ARR] 1.43",
    );
  });

  it("removes top-matter alphabetic affiliation markers from covid.pdf", () => {
    expect(covidHtml).not.toContain("<p>a , b , c , * a , d a , b , c e</p>");
    expect(covidHtml).not.toContain("<p>f f , g e , h a , b , c</p>");
  });

  it("renders data sharing statement in covid.pdf as a semantic section heading", () => {
    expect(covidHtml).toContain("<h2>Data sharing statement</h2>");
    expect(covidHtml).not.toContain("<p>Data sharing statement</p>");
  });

  it("does not interleave left and right column text at bottom of pages in covid.pdf", () => {
    // On page 3 (0-indexed 2), the left column ends with "2.1. Data collection"
    // section content and the right column has "2.3. Statistical analyses" content.
    // Lines near the page bottom (relativeY < 0.1) must still respect column-major
    // ordering and not be interleaved by Y-position.
    // Left column has: "re-hospitalisations due to TE during the study period were excluded."
    // followed by "Admissions with TE were classified as arterial"
    // Right column has: "represents the number of people with a direct TE-related death"
    // These must not appear interleaved.
    const rehosp = covidHtml.indexOf("re-hospitalisations due to TE during the study period were excluded");
    const admissions = covidHtml.indexOf("Admissions with TE were classified as arterial");
    const represents = covidHtml.indexOf("represents the number of people with a direct TE-related death");
    expect(rehosp).toBeGreaterThan(-1);
    expect(admissions).toBeGreaterThan(-1);
    expect(represents).toBeGreaterThan(-1);
    // Left column lines should be consecutive (not separated by right column content)
    expect(admissions).toBeGreaterThan(rehosp);
    expect(admissions).toBeLessThan(represents);
  });

  it("does not merge left-column back-matter with right-column references on covid.pdf page 7", () => {
    // Page 7 has short back-matter sections (Funding, Ethical approval, etc.) in
    // the left column and numbered references in the right column. These must not
    // be merged into a single text line even though they share the same Y position.
    // "Funding" must not be followed by "[6] G. Piazza..." in the same paragraph.
    expect(covidHtml).not.toMatch(/Funding.*\[6\]/);
    // "CRediT authorship contribution statement" must not contain reference text
    expect(covidHtml).not.toMatch(/CRediT authorship contribution statement.*1054/);
    // The supplementary data line must not include reference text from the right column
    expect(covidHtml).not.toMatch(/found online at.*admissions with heart failure/);
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

  it("removes inline first-page figure captions from respect.pdf abstract flow", () => {
    expect(respectHtml).not.toContain("<p>Figure 1: Illustration of our motivation.</p>");
  });

  it("does not treat scored prompt-table rows as section headings in respect.pdf", () => {
    expect(respectHtml).not.toMatch(/<h[2-6]>\d+\s+[^<]*\s\d+\.\d{2}<\/h[2-6]>/);
  });

  it("removes standalone affiliation index marker lines in respect.pdf title block", () => {
    expect(respectHtml).not.toContain("<p>1 1 1 1 , 2 , 3 2 , 3</p>");
    expect(respectHtml).not.toContain("<p>1 2 3</p>");
  });

  it("preserves section headings for two-column layout in respect.pdf", () => {
    expect(respectHtml).toContain("<h2>5 Results</h2>");
    expect(respectHtml).toContain("<h3>5.1 Summarization</h3>");
    expect(respectHtml).toContain("<h4>5.1.1 English</h4>");
    // 5.1.2 is on a non-column-major page and may not be detected as a heading
    expect(respectHtml).toContain("5.1.2 Chinese");
    expect(respectHtml).toContain("<h4>5.1.3 Japanese</h4>");
  });

  it("renders common back-matter section labels as semantic headings in respect.pdf", () => {
    expect(respectHtml).toContain("<h2>Limitations</h2>");
    expect(respectHtml).toContain("<h2>Ethics Statement</h2>");
    expect(respectHtml).not.toContain("<p>Limitations</p>");
    expect(respectHtml).not.toContain("<p>Ethics Statement</p>");
  });

  it("keeps numbered subsection headings in logical order for respect.pdf", () => {
    const section41 = "<h3>4.1 Languages, LLMs, and Prompt Politeness</h3>";
    const section42 = "<h3>4.2 Tasks</h3>";
    const section511 = "<h4>5.1.1 English</h4>";
    const section53 = "<h3>5.3 Stereotypical Bias Detection</h3>";
    const section532 = "<h4>5.3.2 Chinese</h4>";
    expect(respectHtml).toContain(section41);
    expect(respectHtml).toContain(section42);
    expect(respectHtml).toContain(section511);
    expect(respectHtml).toContain(section53);
    expect(respectHtml).toContain(section532);
    expect(respectHtml.indexOf(section41)).toBeLessThan(respectHtml.indexOf(section42));
    expect(respectHtml.indexOf(section53)).toBeLessThan(respectHtml.indexOf(section532));
  });

  it("keeps 5.3 subsection headings in numeric order for respect.pdf", () => {
    const section531 = "<h4>5.3.1 English</h4>";
    const section532 = "<h4>5.3.2 Chinese</h4>";
    expect(respectHtml).toContain(section531);
    expect(respectHtml).toContain(section532);
    expect(respectHtml.indexOf(section531)).toBeLessThan(respectHtml.indexOf(section532));
  });

  it("does not merge left-column text with right-column continuation in respect.pdf", () => {
    expect(respectHtml).not.toContain("JMMLU To evaluate LLMs’ multitask lan- rent socio-cultural situation.");
    expect(respectHtml).toContain("JMMLU To evaluate LLMs’ multitask lan-");
    expect(respectHtml).toContain("rent socio-cultural situation.");
  });

  it("keeps 1 Introduction heading before its right-column continuation in respect.pdf", () => {
    const introductionHeading = "<h2>1 Introduction</h2>";
    const rightColumnText = "to a deterioration in model performance, including";

    expect(respectHtml).toContain(introductionHeading);
    expect(respectHtml).toContain(rightColumnText);
    expect(respectHtml.indexOf(introductionHeading)).toBeLessThan(
      respectHtml.indexOf(rightColumnText),
    );
  });

  it("keeps 1 Introduction heading before the first left-column introduction lead in respect.pdf", () => {
    const introductionHeading = "<h2>1 Introduction</h2>";
    const leftColumnLead =
      "In natural language processing, large language models (LLMs), such as OpenAI’s ChatGPT and";

    expect(respectHtml).toContain(introductionHeading);
    expect(respectHtml).toContain(leftColumnLead);
    expect(respectHtml.indexOf(introductionHeading)).toBeLessThan(
      respectHtml.indexOf(leftColumnLead),
    );
  });

  it("keeps left-column introduction body before right-column continuation in respect.pdf", () => {
    const leftColumnBodyStart = "In natural language processing, large language";
    const rightColumnText = "to a deterioration in model performance, including";

    expect(respectHtml).toContain(leftColumnBodyStart);
    expect(respectHtml).toContain(rightColumnText);
    expect(respectHtml.indexOf(leftColumnBodyStart)).toBeLessThan(
      respectHtml.indexOf(rightColumnText),
    );
  });

  it("does not interleave near-boundary right-column lines into left-column body in respect.pdf page 2", () => {
    // "with language (Cao et al., 2023)." is a right-column line on page 2 (x ≈ 305.7)
    // that sits just below the column split X boundary. It belongs to section 2.2
    // and must appear after the left-column section 2.1 body about Japanese "Keigo".
    const leftColumnBody = "system called \u201CKeigo\u201D";
    const rightColumnMisclassified = "with language (Cao et al., 2023).";
    expect(respectHtml).toContain(leftColumnBody);
    expect(respectHtml).toContain(rightColumnMisclassified);
    expect(respectHtml.indexOf(leftColumnBody)).toBeLessThan(
      respectHtml.indexOf(rightColumnMisclassified),
    );
  });

  it("keeps 2.1 body text before the right-column 2.2 heading in respect.pdf", () => {
    const section21 = "<h3>2.1 Politeness and Respect</h3>";
    const section21BodyText = "Humans are highly sensitive to politeness and re-";
    const section22 = "<h3>2.2 LLMs and Prompt Engineering</h3>";

    expect(respectHtml).toContain(section21);
    expect(respectHtml).toContain(section21BodyText);
    expect(respectHtml).toContain(section22);
    expect(respectHtml.indexOf(section21)).toBeLessThan(respectHtml.indexOf(section21BodyText));
    expect(respectHtml.indexOf(section21BodyText)).toBeLessThan(respectHtml.indexOf(section22));
  });

  it("moves numeric footnote URLs in respect.pdf to the end of the document", () => {
    const referencesHeading = "<h2>References</h2>";
    const footnoteUrl = "https://openai.com/product";
    expect(respectHtml).toContain(referencesHeading);
    expect(respectHtml).toContain(footnoteUrl);
    expect(respectHtml.indexOf(footnoteUrl)).toBeGreaterThan(respectHtml.indexOf(referencesHeading));
  });

  it("keeps numeric footnote markers attached to URL footnotes in respect.pdf", () => {
    expect(respectHtml).toContain(
      '<p id="fn1">1 <a href="https://openai.com/product">https://openai.com/product</a></p>',
    );
    expect(respectHtml).toContain(
      '<p id="fn2">2 <a href="https://huggingface.co/meta-llama/Llama-2-70b-chat">https://huggingface.co/meta-llama/Llama-2-70b-chat</a></p>',
    );
  });

  it("merges hyphen-wrapped standalone URLs into one hyperlink in respect.pdf", () => {
    expect(respectHtml).toContain(
      '<a href="https://huggingface.co/tokyotech-llm/Swallow-70b-instruct-hf">https://huggingface.co/tokyotech-llm/Swallow-70b-instruct-hf</a>',
    );
    expect(respectHtml).not.toContain(
      '<a href="https://huggingface.co/tokyotech-llm/Swallow-70b-">https://huggingface.co/tokyotech-llm/Swallow-70b-</a>',
    );
    expect(respectHtml).not.toContain("<p>instruct-hf</p>");
  });

  it("renders comma-containing numbered headings as semantic headings in respect.pdf", () => {
    expect(respectHtml).toContain("<h3>4.1 Languages, LLMs, and Prompt Politeness</h3>");
    expect(respectHtml).not.toContain("<p>4.1 Languages, LLMs, and Prompt</p>");
    expect(respectHtml).not.toContain("<p>Politeness</p>");
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

  it("renders Supporting Information in tft.pdf as a semantic heading", () => {
    expect(tftHtml).toContain("<h2>Supporting Information</h2>");
    expect(tftHtml).not.toContain("<p>Supporting Information</p>");
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
      "<p>We are grateful to Nal Kalchbrenner and Stephan Gouws for their fruitful comments, corrections and inspiration.</p>",
    );
    expect(html).not.toContain("<p>comments, corrections and inspiration.</p>");
    expect(html).not.toContain(
      "<p>Acknowledgements We are grateful to Nal Kalchbrenner and Stephan Gouws for their fruitful</p>",
    );
  });

  it("merges hyphen-wrapped paragraph lines in attention.pdf into one paragraph block", () => {
    expect(html).not.toContain(
      "<p>Attention mechanisms have become an integral part of compelling sequence modeling and transduc-</p>",
    );
    expect(html).toContain(
      "Attention mechanisms have become an integral part of compelling sequence modeling and transduction models in various tasks, allowing modeling of dependencies without regard to their distance in",
    );
    expect(html).not.toContain("sequence modeling and transduc-tion models");
  });

  it("removes soft-wrap hyphen artifacts in attention.pdf body paragraphs", () => {
    expect(html).toContain("model performs surprisingly well");
    expect(html).not.toContain("model performs sur-prisingly well");

    expect(html).toContain("learned linear transformation and softmax function");
    expect(html).not.toContain("learned linear transfor-mation and softmax function");
  });

  it("bridges detached math-fragment lines inside attention.pdf prose paragraphs", () => {
    expect(html).toContain(
      "We compute the dot products of the query with all keys, divide each by d k , and apply a softmax function to obtain the weights on the values.",
    );
    expect(html).not.toContain("<p>k v</p>");
    expect(html).not.toContain("<p>√</p>");
  });

  it("does not render detached lowercase math-subscripts as standalone paragraphs in attention.pdf", () => {
    expect(html).not.toContain("<p>model</p>");
    expect(html).not.toContain("<p>drop</p>");
  });

  it("merges display math equation fragments into single paragraphs in attention.pdf", () => {
    // Equation (1): Attention(Q,K,V) = softmax(QK^T / sqrt(d_k))V
    // The superscript T, numerator QK, denominator d, subscript k should not be standalone <p> tags
    expect(html).not.toContain("<p>T</p>");
    expect(html).not.toContain("<p>QK</p>");
    // Equation subscript/superscript fragments from MultiHead formula
    expect(html).not.toContain("<p>O</p>");
    expect(html).not.toContain("<p>i i i i</p>");
    expect(html).not.toContain("<p>Q</p>");
    // FFN equation subscripts
    expect(html).not.toContain("<p>1 1 2 2</p>");
    expect(html).not.toContain("<p>f f</p>");
    // Positional encoding subscripts
    expect(html).not.toContain("<p>( pos, 2 i )</p>");
    expect(html).not.toContain("<p>( pos, 2 i +1)</p>");
    // Optimizer formula fragments
    expect(html).not.toContain("<p>− 9</p>");
    expect(html).not.toContain("<p>1 2</p>");
    expect(html).not.toContain("<p>− 0 . 5 − 0 . 5 − 1 . 5</p>");
  });

  it("reconstructs Scaled Dot-Product Attention formula from attention.pdf", () => {
    // The current output is a mangled version of the formula:
    // "T QK Attention( Q, K, V ) = softmax( √ ) V (1) d k"
    const expectedFormula = "Attention( Q, K, V ) = softmax( QKT / √ dk ) V (1)";

    // The goal is to have a readable plain-text representation.
    expect(html).toContain(expectedFormula);
  });

  it("moves first-page footnotes in attention.pdf to the end of the document", () => {
    const footnoteText = "Equal contribution. Listing order is random.";
    const referencesHeading = "<h2>References</h2>";
    expect(html).toContain(footnoteText);
    expect(html).toContain(referencesHeading);
    expect(html.indexOf(footnoteText)).toBeGreaterThan(html.indexOf(referencesHeading));
  });

  it("attaches standalone attention footnote markers to the following footnote text", () => {
    expect(html).toContain(
      "<p>∗ Equal contribution. Listing order is random. Jakob proposed replacing RNNs with self-attention",
    );
    expect(html).toContain("<p>† Work performed while at Google Brain.</p>");
    expect(html).toContain("<p>‡ Work performed while at Google Research.</p>");
    expect(html).not.toContain("<p>∗</p>");
    expect(html).not.toContain("<p>†</p>");
    expect(html).not.toContain("<p>‡</p>");
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

  it("keeps trailing citation fragments inside attention.pdf bullet list items", () => {
    expect(html).toContain("sequence-to-sequence models such as [38, 2, 9].</li>");
  });

  it("renders wrapped repository URLs in attention.pdf as a single hyperlink", () => {
    expect(html).toContain(
      '<a href="https://github.com/tensorflow/tensor2tensor">https://github.com/tensorflow/tensor2tensor</a>',
    );
    expect(html).not.toContain("<p>https://github.com/</p>");
    expect(html).not.toContain("<p>tensorflow/tensor2tensor .</p>");
  });

  it("merges multi-line reference entries into single paragraphs in attention.pdf", () => {
    // [4] should be merged into one <p> instead of two separate <p> tags
    expect(html).toContain(
      "Jianpeng Cheng, Li Dong, and Mirella Lapata. Long short-term memory-networks for machine reading.",
    );
    // [5] continuation line should be merged with the entry start
    expect(html).toContain(
      "Kyunghyun Cho, Bart van Merrienboer, Caglar Gulcehre, Fethi Bougares, Holger Schwenk, and Yoshua Bengio.",
    );
    // Continuation lines should not appear as standalone <p> tags
    expect(html).not.toContain(
      "<p>reading. arXiv preprint arXiv:1601.06733 , 2016.</p>",
    );
    expect(html).not.toContain(
      "<p>and Yoshua Bengio. Learning phrase representations using rnn encoder-decoder for statistical machine translation. CoRR , abs/1406.1078, 2014.</p>",
    );
  });

  it("removes soft-wrap hyphen artifacts inside attention.pdf reference list items", () => {
    expect(html).toContain("Convolutional sequence to sequence learning.");
    expect(html).toContain("Deep residual learning for image recognition.");
    expect(html).toContain("and Koray Kavukcuoglu.");
    expect(html).toContain("and Ruslan Salakhutdinov.");

    expect(html).not.toContain("Convolu-tional sequence to sequence learning.");
    expect(html).not.toContain("for im-age recognition.");
    expect(html).not.toContain("and Ko-ray Kavukcuoglu.");
    expect(html).not.toContain("and Ruslan Salakhutdi-nov.");
  });

  it("removes attention-visualization special-token artifact lines in attention.pdf", () => {
    expect(html).not.toContain("&lt;EOS&gt;");
    expect(html).not.toContain("&lt;pad&gt;");
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

  it("removes standalone DOI metadata lines from tft.pdf", () => {
    expect(tftHtml).not.toContain("<p>DOI: 10.1002/adma.201607055</p>");
  });

  it("removes first-page author contact email lines from tft.pdf", () => {
    expect(tftHtml).not.toContain("<p>E-mail: myunggil@cau.ac.kr</p>");
    expect(tftHtml).not.toContain("<p>E-mail: choongik@sogang.ac.kr</p>");
  });

  it("removes publisher-imprint footer lines from tft.pdf", () => {
    expect(tftHtml).not.toMatch(
      /<p>[^<]*(?:\b(?:19|20)\d{2}\b)[^<]*\b(?:GmbH|KGaA)\b[^<]*<\/p>/,
    );
  });

  it("removes standalone plus-symbol artifact lines from tft.pdf", () => {
    expect(tftHtml).not.toContain("<p>++</p>");
    expect(tftHtml).not.toContain("<p>+</p>");
  });

  it("does not merge left and right column body text into one line for tft.pdf", () => {
    expect(tftHtml).not.toContain(
      "<p>opment of new semiconductors and innovative processing must be overcome for further applications in low-cost, large-</p>",
    );
  });

  it("separates cross-column mixed rows in tft.pdf into distinct paragraphs", () => {
    // Left and right column text from the same row must not be merged into a single element.
    expect(tftHtml).not.toContain(
      "prohibits the implementa- TFT circuit, various metals",
    );
    // Both texts should be present somewhere in the output.
    expect(tftHtml).toContain("prohibits the implementation");
    expect(tftHtml).toContain("TFT circuit, various metals (Al, Cu, Ag, Au, and Mo)");
  });

  it("keeps left-column abstract text before right-column abstract text in tft.pdf", () => {
    const leftColumnText = "The stabilization and control of the electrical properties in solution-processed";
    const rightColumnText = "various semiconductors, sputter-deposited";
    expect(tftHtml).toContain(leftColumnText);
    expect(tftHtml).toContain(rightColumnText);
    expect(tftHtml.indexOf(leftColumnText)).toBeLessThan(tftHtml.indexOf(rightColumnText));
  });

  it("merges attention abstract into body paragraphs instead of single-line p tags", () => {
    expect(html).toContain(
      "<p>The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder.",
    );
    expect(html).toContain(
      "dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks",
    );
    expect(html).not.toContain(
      "<p>Experiments on two machine translation tasks show these models to</p>",
    );
  });

  it("stops body paragraph merge at section headings in attention.pdf", () => {
    expect(html).toContain("<h2>1 Introduction</h2>");
    expect(html).not.toMatch(/entirely\.<\/p>\s*<p>[^<]*<h2>1 Introduction/);
  });

  it("does not merge across columns in respect.pdf body paragraphs", () => {
    expect(respectHtml).not.toContain("does not nessandrespectmayhavedifferentdefinitionsand");
  });

  it("merges respect.pdf abstract lines into body paragraphs instead of single-line p tags", () => {
    expect(respectHtml).not.toContain("<p>els in prompts on the performance of large</p>");
    expect(respectHtml).toContain(
      "We investigate the impact of politeness levels in prompts on the performance of large language models (LLMs).",
    );
  });

  it("does not interleave left and right column body text on page 1 of respect.pdf", () => {
    const leftColEnd = "factors: the politeness of the prompt.";
    const rightColStart = "hypothesize that the best level of politeness for per-";
    expect(respectHtml).toContain(leftColEnd);
    expect(respectHtml).toContain(rightColStart);
    expect(respectHtml.indexOf(leftColEnd)).toBeLessThan(
      respectHtml.indexOf(rightColStart),
    );
  });

  it("keeps left-column tail and right-column continuation in order in respect.pdf introduction", () => {
    const leftColumnTail = "is basic etiquette, which is reflected";
    const rightColumnTop = "in our language and behavior. However, polite-";
    const rightColumnContinuation =
      "ness and respect may have different definitions and manifestations in different cultures and languages.";
    expect(respectHtml).toContain(leftColumnTail);
    expect(respectHtml).toContain(rightColumnTop);
    expect(respectHtml).toContain(rightColumnContinuation);
    expect(respectHtml.indexOf(leftColumnTail)).toBeLessThan(respectHtml.indexOf(rightColumnTop));
    expect(respectHtml.indexOf(rightColumnTop)).toBeLessThan(
      respectHtml.indexOf(rightColumnContinuation),
    );
  });

  it("merges body paragraph lines in tft.pdf left-column abstract into one p tag", () => {
    expect(tftHtml).toContain(
      "<p>The stabilization and control of the electrical properties in solution-processed",
    );
    expect(tftHtml).toContain(
      "low-cost, high-performance oxide semiconductor-based circuits. [4]</p>",
    );
  });

  it("keeps the full left-column abstract block before the right-column summary in tft.pdf", () => {
    const leftColumnTailText =
      "low-cost, high-performance oxide semiconductor-based circuits. [4]</p>";
    expect(tftHtml).toContain(leftColumnTailText);
    expect(tftHtml).toContain("various semiconductors, sputter-deposited");
    expect(tftHtml.indexOf(leftColumnTailText)).toBeLessThan(tftHtml.indexOf("various semiconductors, sputter-deposited"));
  });

  it("merges right-column body text into paragraphs in tft.pdf", () => {
    // Right-column body text on page 1 should be merged into flowing paragraphs,
    // not kept as one-line-per-<p> tags.
    expect(tftHtml).not.toContain("<p>various semiconductors, sputter-deposited</p>");
    expect(tftHtml).not.toContain("<p>amorphous indium–gallium–zinc oxide</p>");
    expect(tftHtml).not.toContain("<p>displays and high current-driven organic</p>");
    // The merged paragraph should contain contiguous text from the right column
    expect(tftHtml).toContain(
      "various semiconductors, sputter-deposited amorphous indium–gallium–zinc oxide",
    );
  });

  it("merges figure-adjacent narrow-column body paragraphs in tft.pdf", () => {
    expect(tftHtml).toContain(
      "In addition to the passivation of oxide semiconductors, OSC IFLs can be applied to control the electrical properties of AOSs.",
    );
    expect(tftHtml).toContain(
      "Recent reports on the charge-transfer doping and the band alignment between a crys-talline oxide semiconductor and organic materials provide avenues for controlling the electrical properties of AOSs without electrical-performance degradation.",
    );
    expect(tftHtml).not.toContain("<p>In addition to the passivation of oxide</p>");
    expect(tftHtml).not.toContain("<p>semiconductors, OSC IFLs can be applied</p>");
    expect(tftHtml).not.toContain("<p>Recent reports on the charge-transfer doping</p>");
  });

  it("renders reference entries as an ordered list in attention.pdf", () => {
    // References should be wrapped in <ol> with <li> items, not <p> tags
    expect(html).toContain("<ol>");
    expect(html).toContain("</ol>");
    // Individual reference entries should be <li>, not <p>
    expect(html).toMatch(/<li>.*Jimmy Lei Ba.*Layer normalization/);
    expect(html).toMatch(/<li>.*Dzmitry Bahdanau.*Neural machine translation/);
    // Reference entries should NOT be rendered as <p> tags
    expect(html).not.toMatch(/<p>\[1\].*Jimmy Lei Ba/);
    expect(html).not.toMatch(/<p>\[2\].*Dzmitry Bahdanau/);
  });

  it("renders reference entries as an ordered list in clean.pdf", () => {
    expect(cleanHtml).toContain("<ol>");
    expect(cleanHtml).toContain("</ol>");
    expect(cleanHtml).toMatch(/<li>.*\[1\]/);
  });

  it("renders reference entries as an ordered list in covid.pdf", () => {
    expect(covidHtml).toContain("<ol>");
    expect(covidHtml).toContain("</ol>");
    expect(covidHtml).toMatch(/<li>.*\[1\]/);
  });

  it("unescapes HTML entities in reference blocks for covid.pdf", () => {
    const expectedHtml = '<span class="subtitle"><em>JACC</em> State-of-the-Art Review</span>';
    const unexpectedHtml =
      "&lt; span class = “ subtitle ” &gt;&lt; em &gt; JACC &lt; /em &gt; State-of-the-Art Review &lt; / span &gt;";
    expect(covidHtml).toContain(expectedHtml);
    expect(covidHtml).not.toContain(unexpectedHtml);
  });

  it("identifies and cleans the abstract heading in covid.pdf", () => {
    expect(covidHtml).not.toContain("<p>A R T I C L E I N F O A B S T R A C T</p>");
    expect(covidHtml).toContain("<h2>Abstract</h2>");
  });

  it("renders Table 1 in attention.pdf as a semantic table element", () => {
    expect(html).toContain("<table>");
    expect(html).toContain("</table>");
    // Table 1 header row
    expect(html).toMatch(/<th[^>]*>.*Layer Type/);
    // Table 1 data rows
    expect(html).toMatch(/<td[^>]*>.*Self-Attention/);
    expect(html).toMatch(/<td[^>]*>.*Recurrent/);
    expect(html).toMatch(/<td[^>]*>.*Convolutional/);
  });

  it("renders Table 2 in attention.pdf as a semantic table element", () => {
    // Table 2: BLEU scores comparison — "BLEU" and "Training Cost" in header
    expect(html).toMatch(/<th[^>]*>.*BLEU/);
    expect(html).toMatch(/<td[^>]*>.*Transformer \(big\)/);
  });

  it("renders table captions in attention.pdf as caption elements", () => {
    expect(html).toMatch(/<caption>.*Table 1:/);
    expect(html).toMatch(/<caption>.*Table 2:/);
  });

  it("keeps clean.pdf Table 1 isolated from right-column prose", () => {
    const tableBlock = cleanHtml.match(/<table>[\s\S]*?<\/table>/)?.[0];
    expect(tableBlock).toBeDefined();
    if (!tableBlock) return;

    expect(tableBlock).toContain(
      "<caption>Table 1: Data standardization performance by comparing different systems.</caption>",
    );
    expect(tableBlock).not.toContain("message of successful execution, CleanAgent will report that");
    expect(tableBlock).not.toContain("users can click the “Show Cleaned Table” button to check whether");
  });

  it("merges same-row sentence fragments into body paragraphs in respect.pdf", () => {
    // On page 1, "factors: the politeness of the prompt. In human" is a single
    // visual line split into two text items by the PDF extractor. The second
    // fragment "In human" must not appear as a standalone <p>.
    expect(respectHtml).not.toContain("<p>In human</p>");
    expect(respectHtml).not.toContain("<p>We observed</p>");
    expect(respectHtml).not.toContain("<p>However, polite-</p>");
    // These fragments should be merged into the surrounding paragraph text
    expect(respectHtml).toContain("prompt. In human");
    expect(respectHtml).toContain("tasks. We observed");
  });

  it("drops detached superscript numeric markers from respect.pdf body paragraphs", () => {
    expect(respectHtml).toMatch(
      /In addition, we also(?:\s*<sup id="fnref\d+"><a href="#fn\d+" class="footnote-ref">\d+<\/a><\/sup>)?\s*hypothesize that the best level of politeness/u,
    );
    expect(respectHtml).not.toContain("In addition, we also 1 hypothesize");
    expect(respectHtml).not.toContain("LLMs, and 4 prompts");
    expect(respectHtml).not.toContain("for each 2 language");
    expect(respectHtml).not.toContain("Llama2- 3 70B");
    expect(respectHtml).not.toContain("for 4 Chinese");
    expect(respectHtml).toContain("Llama-2-70b-chat (hereafter Llama2- 70B) for English");
  });

  it("merges multi-line figure captions into a single paragraph", () => {
    // Figure 3 caption spans 4 lines in the PDF (page 13)
    expect(html).toContain(
      "Figure 3: An example of the attention mechanism following long-distance dependencies in the encoder self-attention in layer 5 of 6.",
    );
    // Figure 4 caption spans 3 lines in the PDF (page 14)
    expect(html).toContain(
      "Figure 4: Two attention heads, also in layer 5 of 6, apparently involved in anaphora resolution.",
    );
    // Figure 5 caption spans 2 lines in the PDF (page 15)
    expect(html).toContain(
      "Figure 5: Many of the attention heads exhibit behaviour that seems related to the structure of the sentence.",
    );
  });
});
