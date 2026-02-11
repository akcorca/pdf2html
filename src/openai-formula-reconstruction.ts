import type { ExtractedFragment } from "./pdf-types.ts";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

interface ReconstructionResult {
  reconstructed: boolean;
  text: string;
}

export async function reconstructFormulaWithGpt(
  fragments: ExtractedFragment[],
): Promise<ReconstructionResult> {
  if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY environment variable not set.");
    return { reconstructed: false, text: "" };
  }

  const prompt = createPromptForReconstruction(fragments);

  try {
    const response = await fetch(COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5-mini-2025-08-07",
        messages: [
          {
            role: "system",
            content:
              "You are an expert in document layout analysis and mathematical formula reconstruction. Your task is to reconstruct a mathematical formula from a list of text fragments extracted from a PDF. The fragments might be out of order or contain extraneous spacing.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenAI API request failed with status ${response.status}: ${errorText}`);
      return { reconstructed: false, text: "" };
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      console.error("OpenAI API returned no content.");
      return { reconstructed: false, text: "" };
    }

    return { reconstructed: true, text: content };
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    return { reconstructed: false, text: "" };
  }
}

function createPromptForReconstruction(fragments: ExtractedFragment[]): string {
  const fragmentsJson = JSON.stringify(
    fragments.map((f) => ({
      text: f.text,
      x: f.x,
      y: f.y,
      fontSize: f.fontSize,
    })),
  );

  return `
The following is a JSON array of text fragments that likely form a mathematical formula. They were extracted from a PDF and are unordered and fragmented.
- 'x' and 'y' are coordinates (y is inverted, lower y is higher on page).
- 'fontSize' can help distinguish superscripts/subscripts.

Your task is to reconstruct the original formula into a single, readable line of text.
- Use standard text representations for math symbols (e.g., sqrt() for square root).
- Pay attention to the spatial relationships (x, y) and font sizes to determine the correct order and structure (e.g., exponents, fractions).
- Output only the reconstructed formula as a single line of text.

Example:
Input:
[
  {"text": "y", "x": 10, "y": 100, "fontSize": 12},
  {"text": "=", "x": 20, "y": 100, "fontSize": 12},
  {"text": "x", "x": 30, "y": 100, "fontSize": 12},
  {"text": "2", "x": 40, "y": 102, "fontSize": 8}
]
Output:
y = x^2

Here are the fragments to reconstruct:
${fragmentsJson}
`;
}
