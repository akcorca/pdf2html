import type { TextLine } from "./pdf-types.ts";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

interface ReorderResult {
  reordered: boolean;
  lines: TextLine[];
}

export async function reorderLinesWithChatGpt(lines: TextLine[]): Promise<ReorderResult> {
  if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY environment variable not set.");
    return { reordered: false, lines };
  }

  const prompt = createPromptForReordering(lines);

  try {
    const response = await fetch(COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5-mini-2025-08-07",
        messages: [
          { role: "system", content: "You are an expert in document layout analysis. Your task is to reorder lines of text that were incorrectly read from a two-column PDF page." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenAI API request failed with status ${response.status}: ${errorText}`);
      return { reordered: false, lines };
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    console.log("OpenAI API response content:", content);

    if (!content) {
      console.error("OpenAI API returned no content.");
      return { reordered: false, lines };
    }

    const reorderedIndexes = JSON.parse(content) as number[];
    if (!Array.isArray(reorderedIndexes) || reorderedIndexes.length !== lines.length) {
      console.error("OpenAI API returned invalid data format.");
      return { reordered: false, lines };
    }
    
    const reorderedLines = reorderedIndexes.map(index => lines[index]);

    return { reordered: true, lines: reorderedLines };
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    return { reordered: false, lines };
  }
}

function createPromptForReordering(lines: TextLine[]): string {
    const linesJson = JSON.stringify(lines.map((line, index) => ({
        index,
        text: line.text,
        x: line.x,
        y: line.y,
    })));

    return `
The following is a JSON array of text lines extracted from a PDF page. They are incorrectly ordered due to a two-column layout being read row-by-row.
The 'x' coordinate indicates the horizontal position. A lower 'x' means the text is on the left.
Your task is to reorder these lines into a correct, logical reading order. First read the left column from top to bottom, then the right column from top to bottom.

Return a JSON array of numbers, where each number is the original index of the line in its correct new position. The output should be only the JSON array.

Example:
Input lines:
[
  {"index": 0, "text": "left 1", "x": 100, "y": 500},
  {"index": 1, "text": "right 1", "x": 400, "y": 500},
  {"index": 2, "text": "left 2", "x": 100, "y": 480},
  {"index": 3, "text": "right 2", "x": 400, "y": 480}
]
Correct output:
[0, 2, 1, 3]

Here are the lines to reorder:
${linesJson}
`;
}