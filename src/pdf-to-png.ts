import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readdir } from "node:fs/promises";
import { join, parse, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ConvertPdfToPngInput {
  inputPdfPath: string;
  outputDirPath: string;
  dpi?: number;
}

interface ConvertPdfToPngResult {
  dpi: number;
  outputDirPath: string;
  generatedFiles: string[];
}

interface ConvertPdfToPngDependencies {
  assertReadableFile: (filePath: string) => Promise<void>;
  ensureOutputDir: (outputDirPath: string) => Promise<void>;
  runPdftoppm: (args: string[]) => Promise<void>;
  readOutputDir: (outputDirPath: string) => Promise<string[]>;
}

export function getDefaultOutputPrefix(inputPdfPath: string): string {
  const name = parse(inputPdfPath).name.trim();
  return name.length > 0 ? name : "page";
}

export function buildPdftoppmArgs(
  inputPdfPath: string,
  outputPrefixPath: string,
  dpi = 300,
): string[] {
  return ["-r", `${dpi}`, "-png", inputPdfPath, outputPrefixPath];
}

export function collectGeneratedPngFiles(
  fileNames: string[],
  outputPrefix: string,
): string[] {
  const parsePageNumber = createGeneratedPngPageNumberParser(outputPrefix);
  return fileNames
    .map((fileName) => ({ fileName, pageNumber: parsePageNumber(fileName) }))
    .filter(
      (entry): entry is { fileName: string; pageNumber: number } => entry.pageNumber !== undefined,
    )
    .sort((left, right) => left.pageNumber - right.pageNumber || left.fileName.localeCompare(right.fileName))
    .map((entry) => entry.fileName);
}

export async function convertPdfToPng({
  inputPdfPath,
  outputDirPath,
  dpi = 300,
}: ConvertPdfToPngInput, dependencies?: ConvertPdfToPngDependencies): Promise<ConvertPdfToPngResult> {
  if (!Number.isInteger(dpi) || dpi <= 0) {
    throw new Error("DPI must be a positive integer.");
  }

  const resolvedDependencies = dependencies ?? createDefaultDependencies();

  const resolvedInputPdfPath = resolve(inputPdfPath);
  const resolvedOutputDirPath = resolve(outputDirPath);
  const outputPrefix = getDefaultOutputPrefix(resolvedInputPdfPath);
  const outputPrefixPath = join(resolvedOutputDirPath, outputPrefix);

  await resolvedDependencies.assertReadableFile(resolvedInputPdfPath);
  await resolvedDependencies.ensureOutputDir(resolvedOutputDirPath);

  try {
    await resolvedDependencies.runPdftoppm(
      buildPdftoppmArgs(resolvedInputPdfPath, outputPrefixPath, dpi),
    );
  } catch (error: unknown) {
    throw createConversionError(error);
  }

  const fileNames = await resolvedDependencies.readOutputDir(
    resolvedOutputDirPath,
  );
  const generatedFileNames = collectGeneratedPngFiles(fileNames, outputPrefix);

  if (generatedFileNames.length === 0) {
    throw new Error("No PNG files were generated from the PDF.");
  }

  return {
    dpi,
    outputDirPath: resolvedOutputDirPath,
    generatedFiles: generatedFileNames.map((fileName) =>
      join(resolvedOutputDirPath, fileName),
    ),
  };
}

async function assertReadableFile(filePath: string): Promise<void> {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new Error(`Cannot read input PDF: ${filePath}`);
  }
}

function createDefaultDependencies(): ConvertPdfToPngDependencies {
  return {
    assertReadableFile,
    ensureOutputDir: async (outputDirPath: string) => {
      await mkdir(outputDirPath, { recursive: true });
    },
    runPdftoppm: async (args: string[]) => {
      await execFileAsync("pdftoppm", args);
    },
    readOutputDir: (outputDirPath: string) => readdir(outputDirPath),
  };
}

function createGeneratedPngPageNumberParser(
  outputPrefix: string,
): (fileName: string) => number | undefined {
  const expression = new RegExp(`^${escapeRegExp(outputPrefix)}-(\\d+)\\.png$`);
  return (fileName: string) => {
    const match = expression.exec(fileName);
    if (!match) return undefined;
    return Number.parseInt(match[1], 10);
  };
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createConversionError(error: unknown): Error {
  const typed = error as NodeJS.ErrnoException & { stderr?: string };

  if (typed.code === "ENOENT") {
    return new Error(
      "pdftoppm command not found. Install poppler to enable PDF to PNG conversion.",
    );
  }

  const stderr = typed.stderr?.trim();
  const detail = stderr && stderr.length > 0 ? stderr : typed.message;

  return new Error(`Failed to convert PDF to PNG: ${detail}`);
}
