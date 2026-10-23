import { useEffect, useRef, type KeyboardEvent } from "react";
import { Search } from "lucide-react";

import { WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME } from "@/components/features/whatsapp/conversation-list-ui";

function tagOptions(input: HTMLElement) {
  return Array.from(input.closest("[data-conversation-tag-picker]")?.querySelectorAll<HTMLElement>(
    "[data-conversation-tag-option]:not([disabled]):not([data-disabled])",
  ) || []);
}

export function handleConversationTagOptionsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const options = tagOptions(event.currentTarget);
  const current = options.findIndex(option => option === event.target);
  if (current < 0 || !options.length) return;
  event.preventDefault();
  event.stopPropagation();
  const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
    : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
  options[next].focus({ preventScroll: true });
  options[next].scrollIntoView({ block: "nearest" });
}

export function ConversationTagSearchInput({ value, onChange }: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return (
    <div className="relative m-1">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        aria-label="Buscar tags"
        placeholder="Buscar tags..."
        autoComplete="off"
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Escape" || event.key === "Tab") return;
          event.stopPropagation();
          if (event.key === "Enter") event.preventDefault();
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const options = tagOptions(event.currentTarget);
          const option = event.key === "ArrowDown" ? options[0] : options.at(-1);
          option?.focus({ preventScroll: true });
          option?.scrollIntoView({ block: "nearest" });
        }}
        className={`h-8 w-full min-w-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] py-1 pl-7 pr-2 text-base font-light text-foreground placeholder:text-muted-foreground md:text-[12px] ${WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME}`}
      />
    </div>
  );
}
