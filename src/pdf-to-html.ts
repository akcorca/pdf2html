interface ConvertPdfToHtmlInput {
  inputPdfPath: string;
  outputHtmlPath: string;
}

interface ConvertPdfToHtmlResult {
  outputHtmlPath: string;
}

export async function convertPdfToHtml(
  input: ConvertPdfToHtmlInput,
): Promise<ConvertPdfToHtmlResult> {
  // TODO
  return { outputHtmlPath: input.outputHtmlPath };
}
