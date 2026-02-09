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
      "While tools like Pandas offer robust functionalities, their complex-ity and the manual effort required for customizing code to diverse",
    );
  });

  it("keeps unfinished left-column paragraph text before a right-column heading in clean.pdf", () => {
    const mergedParagraph =
      "<p>code generation process for data standardization, requiring just a few lines of code.</p>";
    const section2 = "<h2>2 TYPE-SPECIFIC STANDARDIZATION API DESIGN</h2>";
    expect(cleanHtml).toContain(mergedParagraph);
    expect(cleanHtml).toContain(section2);
    expect(cleanHtml.indexOf(mergedParagraph)).toBeLessThan(cleanHtml.indexOf(section2));
  });

  it("keeps clean.pdf numbered section headings in left-to-right column reading order", () => {
    const section3 = "<h2>3 CLEANAGENT WORKFLOW</h2>";
    const section4 = "<h2>4 EXPERIMENTS</h2>";
    expect(cleanHtml).toContain(section3);
    expect(cleanHtml).toContain(section4);
    expect(cleanHtml.indexOf(section3)).toBeLessThan(cleanHtml.indexOf(section4));
  });

  it("keeps trailing left-column sentence before the next numbered section heading in clean.pdf", () => {
    const trailingSentence = "develop even more advanced tools.";
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

  it("renders numbered code examples in clean.pdf as semantic pre/code blocks", () => {
    expect(cleanHtml).toMatch(
      /<pre><code>1 def standardize_address \( addr \):[\s\S]*9 return f\"\{ street \}, \{ state \}, \{ zipcode \}\"<\/code><\/pre>/,
    );
    expect(cleanHtml).not.toContain("<p>1 def standardize_address ( addr ):</p>");
  });

  it("collapses duplicate sentence-prefix artifacts in clean.pdf lines", () => {
    expect(cleanHtml).not.toContain("<p>Implementation. Implementation. CleanAgent is implemented</p>");
    expect(cleanHtml).toContain("<p>Implementation. CleanAgent is implemented</p>");
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

  it("preserves left-to-right reading order for two-column section headings in respect.pdf", () => {
    const sectionHeading = "<h2>5 Results</h2>";
    const rightColumnSubheading = "<h4>5.1.2 Chinese</h4>";
    expect(respectHtml).toContain(sectionHeading);
    expect(respectHtml).toContain(rightColumnSubheading);
    expect(respectHtml.indexOf(sectionHeading)).toBeLessThan(
      respectHtml.indexOf(rightColumnSubheading),
    );
  });

  it("keeps numbered subsection headings in logical order for respect.pdf", () => {
    const section41 = "<h3>4.1 Languages, LLMs, and Prompt</h3>";
    const section42 = "<h3>4.2 Tasks</h3>";
    const section511 = "<h4>5.1.1 English</h4>";
    const section512 = "<h4>5.1.2 Chinese</h4>";
    const section53 = "<h3>5.3 Stereotypical Bias Detection</h3>";
    const section532 = "<h4>5.3.2 Chinese</h4>";
    expect(respectHtml).toContain(section41);
    expect(respectHtml).toContain(section42);
    expect(respectHtml).toContain(section511);
    expect(respectHtml).toContain(section512);
    expect(respectHtml).toContain(section53);
    expect(respectHtml).toContain(section532);
    expect(respectHtml.indexOf(section41)).toBeLessThan(respectHtml.indexOf(section42));
    expect(respectHtml.indexOf(section511)).toBeLessThan(respectHtml.indexOf(section512));
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
    const rightColumnContinuationStart = "<p>to a deterioration in model performance, including";

    expect(respectHtml).toContain(introductionHeading);
    expect(respectHtml).toContain(rightColumnContinuationStart);
    expect(respectHtml.indexOf(introductionHeading)).toBeLessThan(
      respectHtml.indexOf(rightColumnContinuationStart),
    );
  });

  it("keeps left-column introduction body before right-column continuation in respect.pdf", () => {
    const leftColumnBodyStart = "In natural language processing, large language";
    const rightColumnContinuationStart = "to a deterioration in model performance, including";

    expect(respectHtml).toContain(leftColumnBodyStart);
    expect(respectHtml).toContain(rightColumnContinuationStart);
    expect(respectHtml.indexOf(leftColumnBodyStart)).toBeLessThan(
      respectHtml.indexOf(rightColumnContinuationStart),
    );
  });

  it("keeps 2.1 body text before the right-column 2.2 heading in respect.pdf", () => {
    const section21 = "<h3>2.1 Politeness and Respect</h3>";
    const section21BodyStart = "<p>Humans are highly sensitive to politeness and re-</p>";
    const section22 = "<h3>2.2 LLMs and Prompt Engineering</h3>";

    expect(respectHtml).toContain(section21);
    expect(respectHtml).toContain(section21BodyStart);
    expect(respectHtml).toContain(section22);
    expect(respectHtml.indexOf(section21)).toBeLessThan(respectHtml.indexOf(section21BodyStart));
    expect(respectHtml.indexOf(section21BodyStart)).toBeLessThan(respectHtml.indexOf(section22));
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
      '<p>1 <a href="https://openai.com/product">https://openai.com/product</a></p>',
    );
    expect(respectHtml).toContain(
      '<p>2 <a href="https://huggingface.co/meta-llama/Llama-2-70b-chat">https://huggingface.co/meta-llama/Llama-2-70b-chat</a></p>',
    );
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
      "Attention mechanisms have become an integral part of compelling sequence modeling and transduc-tion models in various tasks, allowing modeling of dependencies without regard to their distance in",
    );
  });

  it("does not render detached lowercase math-subscripts as standalone paragraphs in attention.pdf", () => {
    expect(html).not.toContain("<p>model</p>");
    expect(html).not.toContain("<p>drop</p>");
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

  it("renders wrapped repository URLs in attention.pdf as a single hyperlink", () => {
    expect(html).toContain(
      '<a href="https://github.com/tensorflow/tensor2tensor">https://github.com/tensorflow/tensor2tensor</a>',
    );
    expect(html).not.toContain("<p>https://github.com/</p>");
    expect(html).not.toContain("<p>tensorflow/tensor2tensor .</p>");
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

  it("separates cross-column mixed rows in tft.pdf into distinct lines", () => {
    expect(tftHtml).not.toContain(
      "<p>of structural ordering in AOSs prohibits the implementa- TFT circuit, various metals (Al, Cu, Ag, Au, and Mo)</p>",
    );
    expect(tftHtml).toContain("<p>of structural ordering in AOSs prohibits the implementa-</p>");
    expect(tftHtml).toContain("<p>TFT circuit, various metals (Al, Cu, Ag, Au, and Mo) and con-</p>");
  });

  it("keeps left-column abstract text before right-column abstract text in tft.pdf", () => {
    const leftColumnText = "The stabilization and control of the electrical properties in solution-processed";
    const rightColumnLine = "<p>various semiconductors, sputter-deposited</p>";
    expect(tftHtml).toContain(leftColumnText);
    expect(tftHtml).toContain(rightColumnLine);
    expect(tftHtml.indexOf(leftColumnText)).toBeLessThan(tftHtml.indexOf(rightColumnLine));
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
    const rightColumnLine = "<p>various semiconductors, sputter-deposited</p>";
    expect(tftHtml).toContain(leftColumnTailText);
    expect(tftHtml).toContain(rightColumnLine);
    expect(tftHtml.indexOf(leftColumnTailText)).toBeLessThan(tftHtml.indexOf(rightColumnLine));
  });
});
