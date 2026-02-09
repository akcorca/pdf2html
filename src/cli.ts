#!/usr/bin/env node

import { Command } from "commander";
import { convertPdfToHtml } from "./pdf-to-html.ts";
import { convertPdfToPng } from "./pdf-to-png.ts";

const program = new Command();

program
  .name("hello-cli")
  .description("CLI utilities for PDF conversion")
  .showHelpAfterError();

program
  .command("pdf2png")
  .description("Convert each page in a PDF to 300 DPI PNG files in an output directory")
  .argument("<pdfPath>", "Path to input PDF file")
  .argument("<outputDir>", "Path to output directory")
  .action(async (pdfPath: string, outputDir: string) => {
    const conversion = await convertPdfToPng({
      inputPdfPath: pdfPath,
      outputDirPath: outputDir,
      dpi: 300,
    });

    console.log(
      `Generated ${conversion.generatedFiles.length} PNG file(s) in ${conversion.outputDirPath}`,
    );
  });

program.action(() => {
  program.outputHelp();
});

program
  .command("pdf2html")
  .description("Convert a PDF to a simple text-based HTML file")
  .argument("<pdfPath>", "Path to input PDF file")
  .argument("<outputHtmlPath>", "Path to output HTML file")
  .action(async (pdfPath: string, outputHtmlPath: string) => {
    const conversion = await convertPdfToHtml({
      inputPdfPath: pdfPath,
      outputHtmlPath,
    });

    console.log(`Generated HTML file at ${conversion.outputHtmlPath}`);
});

void program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
