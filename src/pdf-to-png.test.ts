import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  buildPdftoppmArgs,
  collectGeneratedPngFiles,
  convertPdfToPng,
  getDefaultOutputPrefix,
} from "./pdf-to-png.ts";

type Dependencies = NonNullable<Parameters<typeof convertPdfToPng>[1]>;

describe("getDefaultOutputPrefix", () => {
  it("uses the PDF file name without extension", () => {
    expect(getDefaultOutputPrefix("/tmp/report.final.pdf")).toBe("report.final");
  });
});

describe("buildPdftoppmArgs", () => {
  it("builds pdftoppm arguments for png rendering at the configured dpi", () => {
    expect(buildPdftoppmArgs("/tmp/input.pdf", "/tmp/out/input", 300)).toEqual([
      "-r",
      "300",
      "-png",
      "/tmp/input.pdf",
      "/tmp/out/input",
    ]);
  });
});

describe("collectGeneratedPngFiles", () => {
  it("collects and sorts generated page images by page number", () => {
    const fileNames = [
      "input-10.png",
      "input-2.png",
      "input-1.png",
      "input-01.png",
      "other-1.png",
      "input-final.png",
      "input-3.jpg",
    ];

    expect(collectGeneratedPngFiles(fileNames, "input")).toEqual([
      "input-01.png",
      "input-1.png",
      "input-2.png",
      "input-10.png",
    ]);
  });
});

describe("convertPdfToPng", () => {
  it("converts pages using pdftoppm and returns sorted generated files", async () => {
    const observedArgs: string[][] = [];
    const dependencies = createDependencies({
      runPdftoppm: async (args: string[]) => {
        observedArgs.push(args);
      },
      readOutputDir: async () => ["report-3.png", "report-1.png", "report-2.png"],
    });

    const result = await convertPdfToPng(
      {
        inputPdfPath: "/tmp/report.pdf",
        outputDirPath: "/tmp/output",
        dpi: 300,
      },
      dependencies,
    );

    const resolvedInput = resolve("/tmp/report.pdf");
    const resolvedOutput = resolve("/tmp/output");

    expect(observedArgs).toEqual([
      ["-r", "300", "-png", resolvedInput, join(resolvedOutput, "report")],
    ]);
    expect(result).toEqual({
      dpi: 300,
      outputDirPath: resolvedOutput,
      generatedFiles: [
        join(resolvedOutput, "report-1.png"),
        join(resolvedOutput, "report-2.png"),
        join(resolvedOutput, "report-3.png"),
      ],
    });
  });

  it("throws when dpi is invalid", async () => {
    await expect(
      convertPdfToPng(
        {
          inputPdfPath: "/tmp/report.pdf",
          outputDirPath: "/tmp/output",
          dpi: 0,
        },
        createDependencies(),
      ),
    ).rejects.toThrow("DPI must be a positive integer.");
  });

  it("throws when input pdf is not readable", async () => {
    const dependencies = createDependencies({
      assertReadableFile: async () => {
        throw new Error("Cannot read input PDF: /tmp/missing.pdf");
      },
    });

    await expect(
      convertPdfToPng(
        {
          inputPdfPath: "/tmp/missing.pdf",
          outputDirPath: "/tmp/output",
        },
        dependencies,
      ),
    ).rejects.toThrow("Cannot read input PDF: /tmp/missing.pdf");
  });

  it("throws when no png files are generated", async () => {
    const dependencies = createDependencies({
      readOutputDir: async () => ["report.txt", "report-1.jpg"],
    });

    await expect(
      convertPdfToPng(
        {
          inputPdfPath: "/tmp/report.pdf",
          outputDirPath: "/tmp/output",
        },
        dependencies,
      ),
    ).rejects.toThrow("No PNG files were generated from the PDF.");
  });

  it("throws a clear error when pdftoppm is not installed", async () => {
    const dependencies = createDependencies({
      runPdftoppm: async () => {
        const error = new Error("spawn pdftoppm ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    });

    await expect(
      convertPdfToPng(
        {
          inputPdfPath: "/tmp/report.pdf",
          outputDirPath: "/tmp/output",
        },
        dependencies,
      ),
    ).rejects.toThrow(
      "pdftoppm command not found. Install poppler to enable PDF to PNG conversion.",
    );
  });

  it("includes stderr from pdftoppm failures", async () => {
    const dependencies = createDependencies({
      runPdftoppm: async () => {
        const error = new Error("conversion failed") as NodeJS.ErrnoException & {
          stderr?: string;
        };
        error.stderr = "broken pdf";
        throw error;
      },
    });

    await expect(
      convertPdfToPng(
        {
          inputPdfPath: "/tmp/report.pdf",
          outputDirPath: "/tmp/output",
        },
        dependencies,
      ),
    ).rejects.toThrow("Failed to convert PDF to PNG: broken pdf");
  });

  it("uses default node dependencies when no custom dependency is provided", async () => {
    vi.resetModules();

    const accessMock = vi.fn(async () => {});
    const mkdirMock = vi.fn(async () => {});
    const readdirMock = vi.fn(async () => ["input-2.png", "input-1.png"]);
    const execFileMock = vi.fn((...args: unknown[]) => {
      const callback = args[2] as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      callback(null, "", "");
    });

    vi.doMock("node:fs/promises", () => ({
      access: accessMock,
      mkdir: mkdirMock,
      readdir: readdirMock,
    }));
    vi.doMock("node:child_process", () => ({
      execFile: execFileMock,
    }));

    try {
      const module = await import("./pdf-to-png.ts");
      const outputDir = "/tmp/output";
      const inputPdf = "/tmp/input.pdf";
      const result = await module.convertPdfToPng({
        inputPdfPath: inputPdf,
        outputDirPath: outputDir,
      });

      const resolvedOutputDir = resolve(outputDir);
      const resolvedInputPdf = resolve(inputPdf);
      expect(accessMock).toHaveBeenCalledWith(resolvedInputPdf, expect.any(Number));
      expect(mkdirMock).toHaveBeenCalledWith(resolvedOutputDir, { recursive: true });
      expect(execFileMock).toHaveBeenCalledWith(
        "pdftoppm",
        ["-r", "300", "-png", resolvedInputPdf, join(resolvedOutputDir, "input")],
        expect.any(Function),
      );
      expect(readdirMock).toHaveBeenCalledWith(resolvedOutputDir);
      expect(result.generatedFiles).toEqual([
        join(resolvedOutputDir, "input-1.png"),
        join(resolvedOutputDir, "input-2.png"),
      ]);
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.doUnmock("node:child_process");
    }
  });

  it("maps default access errors to readable input file errors", async () => {
    vi.resetModules();

    const accessMock = vi.fn(async () => {
      throw new Error("EACCES");
    });

    vi.doMock("node:fs/promises", () => ({
      access: accessMock,
      mkdir: vi.fn(async () => {}),
      readdir: vi.fn(async () => ["input-1.png"]),
    }));
    vi.doMock("node:child_process", () => ({
      execFile: vi.fn(),
    }));

    try {
      const module = await import("./pdf-to-png.ts");
      const inputPdf = "/tmp/blocked.pdf";
      await expect(
        module.convertPdfToPng({
          inputPdfPath: inputPdf,
          outputDirPath: "/tmp/output",
        }),
      ).rejects.toThrow(`Cannot read input PDF: ${resolve(inputPdf)}`);
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.doUnmock("node:child_process");
    }
  });
});

function createDependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    assertReadableFile: vi.fn(async () => {}),
    ensureOutputDir: vi.fn(async () => {}),
    runPdftoppm: vi.fn(async () => {}),
    readOutputDir: vi.fn(async () => ["report-1.png"]),
    ...overrides,
  };
}
