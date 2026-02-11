import { execFile } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { join, parse, resolve } from "node:path";
import { promisify } from "node:util";
import { assertReadableFile } from "./file-access.ts";

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

interface GeneratedPngFileEntry {
  fileName: string;
  pageNumber: number;
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
  const expression = new RegExp(`^${escapeRegExp(outputPrefix)}-(\\d+)\\.png$`);
  const generatedFiles: GeneratedPngFileEntry[] = [];
  for (const fileName of fileNames) {
    const entry = parseGeneratedPngFileEntry(fileName, expression);
    if (!entry) continue;
    generatedFiles.push(entry);
  }

  generatedFiles.sort(
    (left, right) => left.pageNumber - right.pageNumber || left.fileName.localeCompare(right.fileName),
  );
  return generatedFiles.map((entry) => entry.fileName);
}

export async function convertPdfToPng({
  inputPdfPath,
  outputDirPath,
  dpi = 300,
}: ConvertPdfToPngInput, dependencies?: ConvertPdfToPngDependencies): Promise<ConvertPdfToPngResult> {
  assertValidDpi(dpi);

  const resolvedDependencies = dependencies ?? createDefaultDependencies();

  const resolvedInputPdfPath = resolve(inputPdfPath);
  const resolvedOutputDirPath = resolve(outputDirPath);
  const outputPrefix = getDefaultOutputPrefix(resolvedInputPdfPath);
  const outputPrefixPath = join(resolvedOutputDirPath, outputPrefix);

  await resolvedDependencies.assertReadableFile(resolvedInputPdfPath);
  await resolvedDependencies.ensureOutputDir(resolvedOutputDirPath);

  await runPdftoppmOrThrow(
    resolvedDependencies.runPdftoppm,
    buildPdftoppmArgs(resolvedInputPdfPath, outputPrefixPath, dpi),
  );

  const generatedFileNames = collectGeneratedPngFiles(
    await resolvedDependencies.readOutputDir(resolvedOutputDirPath),
    outputPrefix,
  );

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

function parseGeneratedPngFileEntry(
  fileName: string,
  expression: RegExp,
): GeneratedPngFileEntry | undefined {
  const match = expression.exec(fileName);
  if (!match) return undefined;
  return { fileName, pageNumber: Number.parseInt(match[1], 10) };
}

function assertValidDpi(dpi: number): void {
  if (Number.isInteger(dpi) && dpi > 0) return;
  throw new Error("DPI must be a positive integer.");
}

async function runPdftoppmOrThrow(
  runPdftoppm: ConvertPdfToPngDependencies["runPdftoppm"],
  args: string[],
): Promise<void> {
  try {
    await runPdftoppm(args);
  } catch (error: unknown) {
    throw createConversionError(error);
  }
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
