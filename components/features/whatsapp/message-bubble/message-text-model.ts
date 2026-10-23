export type MessageInlineNode =
  | { kind: "text" | "email" | "link" | "mention" | "code"; text: string }
  | { kind: "strong" | "emphasis" | "strike"; children: MessageInlineNode[] };

const URL_AT_START = /^https?:\/\/[^\s<>"']+/i;
const EMAIL_AT_START = /^[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/;
const MENTION_AT_START = /^@(?:\d{7,}|[\w\u00C0-\u017F]+)/;
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;
const FORMATS = { "*": "strong", "_": "emphasis", "~": "strike" } as const;

function trimLinkPunctuation(value: string) {
  let result = value.replace(/[.,!?;:]+$/, "");
  while (result.endsWith(")") && (result.match(/\)/g)?.length || 0) > (result.match(/\(/g)?.length || 0)) result = result.slice(0, -1);
  return result;
}

/** React renders this AST as text/elements. Provider text never becomes HTML. */
export function parseMessageInline(source: string, depth = 0): MessageInlineNode[] {
  const nodes: MessageInlineNode[] = [];
  const appendText = (text: string) => {
    const previous = nodes.at(-1);
    if (previous?.kind === "text") previous.text += text;
    else nodes.push({ kind: "text", text });
  };
  let index = 0;
  while (index < source.length) {
    const remaining = source.slice(index);
    const previousCharacter = source[index - 1] || "";
    const url = URL_AT_START.exec(remaining)?.[0];
    if (url) {
      const text = trimLinkPunctuation(url);
      nodes.push({ kind: "link", text }); index += text.length; continue;
    }
    const email = !WORD_CHARACTER.test(previousCharacter) ? EMAIL_AT_START.exec(remaining)?.[0] : null;
    if (email) { nodes.push({ kind: "email", text: email }); index += email.length; continue; }
    const codeDelimiter = remaining.startsWith("```") ? "```" : remaining.startsWith("`") ? "`" : null;
    if (codeDelimiter) {
      const close = source.indexOf(codeDelimiter, index + codeDelimiter.length);
      if (close > index + codeDelimiter.length) {
        nodes.push({ kind: "code", text: source.slice(index + codeDelimiter.length, close) });
        index = close + codeDelimiter.length; continue;
      }
    }
    const marker = source[index] as keyof typeof FORMATS;
    if (depth < 8 && marker in FORMATS && !WORD_CHARACTER.test(previousCharacter) && !/\s/.test(source[index + 1] || "")) {
      let close = source.indexOf(marker, index + 1);
      while (close >= 0 && (WORD_CHARACTER.test(source[close + 1] || "") || /\s/.test(source[close - 1] || ""))) close = source.indexOf(marker, close + 1);
      if (close > index + 1) {
        nodes.push({ kind: FORMATS[marker], children: parseMessageInline(source.slice(index + 1, close), depth + 1) });
        index = close + 1; continue;
      }
    }
    const mention = !WORD_CHARACTER.test(previousCharacter) && previousCharacter !== "@" ? MENTION_AT_START.exec(remaining)?.[0] : null;
    if (mention) { nodes.push({ kind: "mention", text: mention }); index += mention.length; continue; }
    appendText(source[index]); index += 1;
  }
  return nodes;
}

export function collectNumericMentions(nodes: readonly MessageInlineNode[]): string[] {
  return nodes.flatMap((node) => "children" in node ? collectNumericMentions(node.children)
    : node.kind === "mention" && /^@\d{7,}$/.test(node.text) ? [node.text.slice(1)] : []);
}

export type MessageTextBlock = { kind: "paragraph" | "quote" | "bullet" | "numbered" | "code"; text: string; marker?: string };

export function parseMessageTextBlocks(source: string): MessageTextBlock[] {
  const blocks: MessageTextBlock[] = [];
  // A fenced block can contain newlines and literal formatting/link markers.
  const parts = source.split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("```") && part.endsWith("```")) { blocks.push({ kind: "code", text: part.slice(3, -3).replace(/^\n|\n$/g, "") }); continue; }
    for (const line of part.split("\n")) {
      const quote = /^> (.*)$/.exec(line);
      const bullet = /^([-*]) (.*)$/.exec(line);
      const numbered = /^(\d{1,3}\.) (.*)$/.exec(line);
      if (quote) blocks.push({ kind: "quote", text: quote[1] });
      else if (bullet) blocks.push({ kind: "bullet", text: bullet[2], marker: "•" });
      else if (numbered) blocks.push({ kind: "numbered", text: numbered[2], marker: numbered[1] });
      else blocks.push({ kind: "paragraph", text: line });
    }
  }
  return blocks;
}
