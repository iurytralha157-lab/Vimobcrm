/** The spreadsheet cell uses JSON so separators inside a tag name survive a round trip. */
export function serializeContactTags(names: readonly string[]): string {
  return JSON.stringify(Array.from(new Set(names.map((name) => name.trim()).filter(Boolean))));
}

export function parseContactTags(value: string): { names: string[]; error?: string } {
  const text = value.trim();
  if (!text) return { names: [] };
  let names: string[];
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed) || parsed.some((name) => typeof name !== 'string')) {
        return { names: [], error: 'Tags em JSON devem ser uma lista de nomes de texto' };
      }
      names = parsed as string[];
    } catch {
      return { names: [], error: 'A lista JSON de tags está incompleta ou inválida' };
    }
  } else {
    // Existing templates and third-party files keep their legacy list syntax.
    names = text.split(/[,;|]/);
  }
  return { names: Array.from(new Set(names.map((name) => name.trim()).filter(Boolean))) };
}
