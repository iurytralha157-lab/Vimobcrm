import { useMentionNames } from "@/hooks/use-mention-names";
import { cn } from "@/lib/utils";

import { getSafeExternalHttpUrl } from "../message-media";

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
  compact = false,
}: MessageTextProps) {
  const mentionRegex = /(@\d{7,}|@[\w\u00C0-\u017F]+(?:\s[\w\u00C0-\u017F]+){0,2})/g;
  const mentionTokenRegex = /^(@\d{7,}|@[\w\u00C0-\u017F]+(?:\s[\w\u00C0-\u017F]+){0,2})$/;
  const parts = content
    .split(mentionRegex)
    .filter((part): part is string => typeof part === "string" && part.length > 0);

  const digitMentions = parts
    .filter((part) => /^@\d{7,}$/.test(part))
    .map((part) => part.slice(1));
  const names = useMentionNames(digitMentions, { groupJid, sessionId, leadId });

  const renderTextWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
    const urlParts = text.split(urlRegex);

    return urlParts.map((urlPart, index) => {
      const safeUrl = /^https?:\/\//i.test(urlPart) ? getSafeExternalHttpUrl(urlPart) : null;
      if (safeUrl) {
        return (
          <a
            key={index}
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className={cn(
              "underline break-all transition-colors duration-200",
              fromMe
                ? "font-normal text-primary-foreground hover:text-primary-foreground/80"
                : "font-normal text-primary hover:text-primary/80",
            )}
          >
            {urlPart}
          </a>
        );
      }
      return urlPart;
    });
  };

  return (
    <p className={cn(compact ? "text-[12px] leading-[16px]" : "text-[13px] leading-[18px]", "min-w-0 whitespace-pre-wrap break-words")}>
      {parts.length === 1
        ? renderTextWithLinks(content)
        : parts.map((part, index) => {
            if (!mentionTokenRegex.test(part)) return renderTextWithLinks(part);
            const isDigit = /^@\d{7,}$/.test(part);
            const display = isDigit ? `@${names[part.slice(1)] ?? part.slice(1)}` : part;
            return (
              <span
                key={index}
                className={cn(
                  "inline-block rounded-[4px] px-1 py-0.5 font-normal transition-colors duration-200",
                  fromMe
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-primary/15 text-primary dark:bg-primary/25",
                )}
              >
                {display}
              </span>
            );
          })}
    </p>
  );
}
