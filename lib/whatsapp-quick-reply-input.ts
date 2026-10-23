export type QuickReplyTrigger = { start: number; end: number; query: string };
type SearchableReply = { shortcut: string; content: string };

function searchable(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
}

/** Only a slash token at a word boundary and immediately before the caret. */
export function getQuickReplyTrigger(value: string, caret: number): QuickReplyTrigger | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > value.length) return null;
  const match = /(?:^|\s)\/([\p{L}\p{N}_-]*)$/u.exec(value.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[1].length - 1, end: caret, query: match[1] };
}

/** Filtering is local; typing another character never starts a server request. */
export function filterQuickReplies<T extends SearchableReply>(items: readonly T[], query: string): T[] {
  const prefix = searchable(query.trim());
  const rank = (item: T) => searchable(item.shortcut) === prefix ? 0
    : searchable(item.shortcut).startsWith(prefix) ? 1 : 2;
  return items.filter(item => searchable(item.shortcut).startsWith(prefix) || searchable(item.content).startsWith(prefix))
    .sort((a, b) => rank(a) - rank(b) || a.shortcut.localeCompare(b.shortcut, "pt-BR"));
}

/** Uses DOM selection offsets (UTF-16) and never changes the surrounding draft. */
export function insertQuickReplyAtSelection(value: string, start: number, end: number, content: string) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > value.length) {
    return { value, caret: value.length };
  }
  return { value: value.slice(0, start) + content + value.slice(end), caret: start + content.length };
}

/** A stale suggestion must not replace text typed after the list was rendered. */
export function insertQuickReply(value: string, trigger: QuickReplyTrigger, content: string) {
  const current = getQuickReplyTrigger(value, trigger.end);
  if (!current || current.start !== trigger.start || current.query !== trigger.query) {
    return { value, caret: Math.min(Math.max(0, trigger.end), value.length) };
  }
  return insertQuickReplyAtSelection(value, trigger.start, trigger.end, content);
}

export function suggestQuickReplyShortcut(value: string): string {
  const firstWord = searchable(value.trim()).replace(/[^a-z0-9_\s-]/g, " ").trim().split(/\s+/)[0] || "";
  return firstWord.replace(/^[^a-z0-9]+/, "").slice(0, 40) || "mensagem";
}
