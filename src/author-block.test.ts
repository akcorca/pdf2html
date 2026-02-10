import { describe, it, expect } from "vitest";
import { pdfToHtmlInternals } from "./pdf-to-html.ts";
import { extractDocument } from "./pdf-extract.ts";

describe("author block", () => {
  it("merges author lines into a single block", async () => {
    const pdf = await extractDocument("data/attention.pdf");
    const lines = pdfToHtmlInternals.filterPageArtifacts(
      pdfToHtmlInternals.collectTextLines(pdf),
    );
    const html = pdfToHtmlInternals.renderHtml(lines);

    const expected = `<div class="authors">
Ashish Vaswani Noam Shazeer<br>
Niki Parmar Jakob Uszkoreit<br>
Google Brain Google Brain<br>
Google Research Google Research<br>
avaswani@google.com noam@google.com<br>
nikip@google.com usz@google.com<br>
Llion Jones Aidan N. Gomez<br>
Google Research University of Toronto<br>
Łukasz Kaiser<br>
llion@google.com aidan@cs.toronto.edu<br>
Google Brain<br>
lukaszkaiser@google.com<br>
Illia Polosukhin<br>
illia.polosukhin@gmail.com
</div>`;

    // This is what is currently generated, and is wrong.
    const unexpected = `<p>Ashish Vaswani Noam Shazeer</p>
<p>Niki Parmar Jakob Uszkoreit</p>
<p>Google Brain Google Brain</p>
<p>Google Research Google Research</p>
<p>avaswani@google.com noam@google.com</p>
<p>nikip@google.com usz@google.com</p>
<p>Llion Jones Aidan N. Gomez</p>
<p>Google Research University of Toronto</p>
<p>Łukasz Kaiser</p>
<p>llion@google.com aidan@cs.toronto.edu</p>
<p>Google Brain</p>
<p>lukaszkaiser@google.com</p>
<p>Illia Polosukhin</p>
<p>illia.polosukhin@gmail.com</p>`;

    expect(html).not.toContain(unexpected);
    expect(html).toContain(expected);
  });
});
