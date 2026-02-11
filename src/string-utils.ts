function normalizeSpacing(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

const FOOTNOTE_LEADING_NUMERIC_MARKER_PATTERN = /^\(?(\d{1,2})\)?[.)]?\s+/u;

export function parseLeadingNumericMarker(text: string): number | undefined {
  const match = FOOTNOTE_LEADING_NUMERIC_MARKER_PATTERN.exec(normalizeSpacing(text));
  if (!match) return undefined;
  const marker = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(marker) ? marker : undefined;
}
