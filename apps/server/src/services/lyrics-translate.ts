/** Helpers for lyrics translation: a pure function, so it can be tested without the assistant. */

/** The translated lines from the model's reply, only when there is exactly one per sung line. */
export function parseTranslation(text: string, expected: number): string[] | null {
  const stripped = text.replace(/```(?:json)?/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1)) as { lines?: unknown };
    if (!Array.isArray(parsed.lines) || parsed.lines.length !== expected) return null;
    if (!parsed.lines.every(l => typeof l === 'string')) return null;
    return (parsed.lines as string[]).map(l => l.trim());
  } catch {
    return null;
  }
}

