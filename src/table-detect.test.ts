import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { convertPdfToHtml } from "./pdf-to-html.ts";

const outputDirPath = resolve("data/work/test-debug/table-detect");

describe("table detection", () => {
  let respectHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    const pdf = { input: "data/respect.pdf", output: "respect.html" };
    await convertPdfToHtml({
      inputPdfPath: resolve(pdf.input),
      outputHtmlPath: join(outputDirPath, pdf.output),
    });
    respectHtml = await readFile(join(outputDirPath, "respect.html"), "utf8");
  });

  it("renders Table 1 in respect.pdf as a semantic table element", () => {
    expect(respectHtml).toContain("<table>");
    expect(respectHtml).toContain("<caption>Table 1: Scores on the three language understanding benchmarks.</caption>");
    expect(respectHtml).toMatch(/<th[^>]*>MMLU<\/th>/);
    expect(respectHtml).toMatch(/<th[^>]*>C-Eval<\/th>/);
    expect(respectHtml).toMatch(/<th[^>]*>JMMLU<\/th>/);
    expect(respectHtml).toMatch(/<td[^>]*>60.02<\/td>/);
    expect(respectHtml).toMatch(/<td[^>]*>75.82<\/td>/);
    const table1Match = respectHtml.match(/<caption>Table 1: Scores on the three language understanding benchmarks.<\/caption>([\s\S]*?)<\/table>/);
    expect(table1Match).toBeTruthy();
    const table1 = table1Match?.[0] ?? "";
    expect(table1).not.toContain("<td>P</td>");
  });

  it("should correctly split merged data cells in Table 1 of respect.pdf", () => {
    const table1Match = respectHtml.match(/<caption>Table 1: Scores on the three language understanding benchmarks.<\/caption>([\s\S]*?)<\/table>/);
    expect(table1Match).toBeTruthy();
    const table1Html = table1Match?.[0] ?? "";

    // Check that the problematic cell is split
    const row8Match = table1Html.match(/<tr>\s*<td[^>]*>8<\/td>([\s\S]*?)<\/tr>/);
    expect(row8Match).toBeTruthy();
    const row8Cells = row8Match?.[1] ?? "";
    expect(row8Cells).toContain("<td>71.98</td>");
    expect(row8Cells).toContain("<td>38.23</td>");
  });

  it("does not mix nearby body text into Table 2 rows in respect.pdf", () => {
    const table2Match = respectHtml.match(
      /<caption>Table 2: MMLU benchmark scores of Llama2-70B and its base model\.<\/caption>[\s\S]*?<\/table>/,
    );
    expect(table2Match).toBeTruthy();

    const table2 = table2Match?.[0] ?? "";
    expect(table2).not.toContain("politeness levels, and its bias fluctuates more sig- 7");
    expect(table2).not.toContain("nificantly. Its bias level is almost identical to GPT- 6");
    expect(table2).not.toContain("tion 5.1.2, such a pattern potentially embodies the 3");

    expect(table2).toMatch(/<td>7<\/td><td>55\.26<\/td><td>54\.84<\/td>(?:<td><\/td>)?/);
    expect(table2).toMatch(/<td>6<\/td><td>52\.23<\/td><td>54\.75<\/td>(?:<td><\/td>)?/);
    expect(table2).toMatch(/<td>3<\/td><td>49\.02<\/td><td>53\.51<\/td>(?:<td><\/td>)?/);
  });
});

describe("table detection in attention.pdf", () => {
  let attentionHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    const pdf = { input: "data/attention.pdf", output: "attention.html" };
    await convertPdfToHtml({
      inputPdfPath: resolve(pdf.input),
      outputHtmlPath: join(outputDirPath, pdf.output),
    });
    attentionHtml = await readFile(join(outputDirPath, "attention.html"), "utf8");
  });

  it("renders Table 1 in attention.pdf as a semantic table element", () => {
    expect(attentionHtml).toContain("<table>");
    expect(attentionHtml).toContain(
      "<caption>Table 1: Maximum path lengths, per-layer complexity and minimum number of sequential operations for different layer types. n is the sequence length, d is the representation dimension, k is the kernel size of convolutions and r the size of the neighborhood in restricted self-attention.</caption>",
    );
    const table1Match = attentionHtml.match(/<caption>Table 1[\s\S]*?<\/caption>([\s\S]*?)<\/table>/);
    expect(table1Match).toBeTruthy();
    const tableContent = table1Match?.[1] ?? "";
    expect(tableContent).toContain("<thead>");
    expect(tableContent).toContain("</thead>");
    expect(tableContent).toContain("<tbody>");
    expect(tableContent).toContain("</tbody>");
    expect(tableContent).toMatch(/<th[^>]*>Layer Type<\/th>/);
    expect(tableContent).toMatch(/<th[^>]*>Complexity per Layer<\/th>/);
    expect(tableContent).toMatch(/<th[^>]*>Sequential Operations<\/th>/);
    expect(tableContent).toMatch(/<th[^>]*>Maximum Path Length<\/th>/);
  });

  it("aligns Table 1 body cells to header columns without an empty spacer column", () => {
    const table1Match = attentionHtml.match(
      /<caption>Table 1[\s\S]*?<\/caption>([\s\S]*?)<\/table>/,
    );
    expect(table1Match).toBeTruthy();
    const tableContent = table1Match?.[1] ?? "";

    expect(tableContent).toContain(
      "<tr><td>Self-Attention</td><td>O ( n 2 · d )</td><td>O (1)</td><td>O (1)</td></tr>",
    );
    expect(tableContent).not.toContain(
      "<tr><td>Self-Attention</td><td></td><td>O ( n 2 · d )</td><td>O (1)</td><td>O (1)</td></tr>",
    );
  });
});

describe("table detection in clean.pdf", () => {
  let cleanHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    const pdf = { input: "data/clean.pdf", output: "clean.html" };
    await convertPdfToHtml({
      inputPdfPath: resolve(pdf.input),
      outputHtmlPath: join(outputDirPath, pdf.output),
    });
    cleanHtml = await readFile(join(outputDirPath, "clean.html"), "utf8");
  });

  it("renders sparse multi-row headers as a complete semantic header row", () => {
    const table1Match = cleanHtml.match(
      /<caption>Table 1: Data standardization performance by comparing different systems\.<\/caption>[\s\S]*?<\/table>/,
    );
    expect(table1Match).toBeTruthy();
    const table1 = table1Match?.[0] ?? "";

    expect(table1).toContain("<thead>");
    expect(table1).toContain(
      "<tr><th>System</th><th>Cell-Level Matching Rate(%)</th><th>Latency (s)</th></tr>",
    );
    expect(table1).not.toContain(
      "<tr><th>Cell-Level Matching Rate(%)</th></tr>",
    );
  });
});

describe("table detection in covid.pdf", () => {
  let covidHtml = "";

  beforeAll(async () => {
    await mkdir(outputDirPath, { recursive: true });
    const pdf = { input: "data/covid.pdf", output: "covid.html" };
    await convertPdfToHtml({
      inputPdfPath: resolve(pdf.input),
      outputHtmlPath: join(outputDirPath, pdf.output),
    });
    covidHtml = await readFile(join(outputDirPath, "covid.html"), "utf8");
  });

  it("renders Table 1 in covid.pdf as a semantic table element", () => {
    expect(covidHtml).toContain("<table>");
    expect(covidHtml).toContain(
      "<caption>Table 1 Patient characteristics for admissions in England with arterial and venous thrombo-embolic events between 1st Feb 2018 and 31st July 2020, by study period (pre-COVID-19 and during COVID-19), and COVID-19 status.</caption>",
    );
    const table1Match = covidHtml.match(/<caption>Table 1[\s\S]*?<\/caption>([\s\S]*?)<\/table>/);
    expect(table1Match).toBeTruthy();
    const tableContent = table1Match?.[1] ?? "";
    expect(tableContent).toContain("<thead>");
    expect(tableContent).toContain("<tbody>");
  });

  it("renders Table 2 in covid.pdf as a semantic table element", () => {
    expect(covidHtml).toContain("<table>");
    expect(covidHtml).toContain(
      "<caption>Table 2 Incidence rates, absolute risk change and adjusted relative risk between pre- COVID-19 and COVID-19 periods.</caption>",
    );
    const table2Match = covidHtml.match(/<caption>Table 2[\s\S]*?<\/caption>([\s\S]*?)<\/table>/);
    expect(table2Match).toBeTruthy();
    const tableContent = table2Match?.[1] ?? "";
    expect(tableContent).toContain("<thead>");
    expect(tableContent).toContain("<tbody>");
  });
});
