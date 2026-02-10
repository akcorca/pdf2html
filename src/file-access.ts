import { constants } from "node:fs";
import { access } from "node:fs/promises";

export async function assertReadableFile(filePath: string): Promise<void> {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new Error(`Cannot read input PDF: ${filePath}`);
  }
}
