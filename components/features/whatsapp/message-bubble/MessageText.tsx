import type { ReactNode } from "react";
import { useMentionNames } from "@/hooks/use-mention-names";
import { cn } from "@/lib/utils";

import { getSafeExternalHttpUrl } from "../message-media";
import { collectNumericMentions, parseMessageInline, parseMessageTextBlocks, type MessageInlineNode } from "./message-text-model";

export interface MessageTextProps {
  content: string;
  fromMe: boolean;
  groupJid?: string | null;
  sessionId?: string | null;
  leadId?: string | null;
  compact?: boolean;
}

// Renders message text with WhatsApp-style mentions. Digit mentions are
// resolved to contact / lead names; word mentions keep highlight styling.
export function MessageText({
  content,
  fromMe,
  groupJid,
  sessionId,
  leadId,
}: MessageTextProps) {
  const blocks = parseMessageTextBlocks(content);
  const parsedBlocks = blocks.map((block) => ({ ...block, nodes: block.kind === "code" ? [] : parseMessageInline(block.text) }));
  const digitMentions = [...new Set(parsedBlocks.flatMap((block) => collectNumericMentions(block.nodes)))];
  const names = useMentionNames(digitMentions, { groupJid, sessionId, leadId });
  const renderNodes = (nodes: readonly MessageInlineNode[]): ReactNode => nodes.map((node, index) => {
    if ("children" in node) {
      const children = renderNodes(node.children);
      if (node.kind === "strong") return <strong key={index} className="font-semibold">{children}</strong>;
      if (node.kind === "emphasis") return <em key={index}>{children}</em>;
      return <del key={index}>{children}</del>;
    }
    if (node.kind === "code") return <code key={index} className="rounded bg-current/5 px-1 font-mono">{node.text}</code>;
    if (node.kind === "link") {
      const safeUrl = getSafeExternalHttpUrl(node.text);
      return safeUrl ? <a key={index} href={safeUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
        className={cn("break-all underline", fromMe ? "text-primary-foreground" : "text-primary")}>{node.text}</a> : node.text;
    }
    if (node.kind !== "mention") return node.text;
    const display = /^@\d{7,}$/.test(node.text) ? `@${names[node.text.slice(1)] ?? node.text.slice(1)}` : node.text;
    return <span key={index} className={cn("rounded-[4px] px-1 py-0.5", fromMe ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/15 text-primary")}>{display}</span>;
  });

  return (
    <div data-message-text className="min-w-0 whitespace-pre-wrap break-words text-[12px] font-[200] leading-[17px]">
      {parsedBlocks.map((block, index) => {
        if (block.kind === "code") return <pre key={index} className="my-1 overflow-x-auto rounded bg-current/5 p-2"><code className="font-mono">{block.text}</code></pre>;
        if (block.kind === "quote") return <blockquote key={index} className="my-0.5 border-l-2 border-current/40 pl-2 opacity-90">{renderNodes(block.nodes)}</blockquote>;
        if (block.kind === "bullet") return <ul key={index} className="list-disc pl-5"><li style={{ fontWeight: "inherit" }}>{renderNodes(block.nodes)}</li></ul>;
        if (block.kind === "numbered") return <ol key={index} start={Number.parseInt(block.marker || "1", 10)} className="list-decimal pl-5"><li style={{ fontWeight: "inherit" }}>{renderNodes(block.nodes)}</li></ol>;
        return <div key={index}>{block.text ? renderNodes(block.nodes) : "\u00a0"}</div>;
      })}
    </div>
  );
}
