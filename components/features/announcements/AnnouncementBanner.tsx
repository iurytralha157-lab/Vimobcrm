"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Megaphone, X } from "lucide-react";

import { useActiveAnnouncement } from "@/hooks/use-announcements";
import { cn } from "@/lib/utils";

export function AnnouncementBanner() {
  const { data: announcement } = useActiveAnnouncement();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [timedOutKey, setTimedOutKey] = useState<string | null>(null);
  const timeoutKey = announcement?.id
    ? `${announcement.id}:${announcement.display_duration_seconds || "manual"}`
    : null;

  useEffect(() => {
    if (!announcement?.id || !announcement.display_duration_seconds || !timeoutKey) return undefined;

    const timeout = window.setTimeout(() => {
      setTimedOutKey(timeoutKey);
    }, announcement.display_duration_seconds * 1000);

    return () => window.clearTimeout(timeout);
  }, [announcement?.display_duration_seconds, announcement?.id, timeoutKey]);

  if (!announcement || !announcement.show_banner) return null;
  if (dismissedId === announcement.id || timedOutKey === timeoutKey) return null;

  const hasAction = Boolean(announcement.button_url && announcement.button_text);

  return (
    <div className="flex w-full shrink-0 items-center gap-2 bg-[#FF4529] px-3 py-2 text-white shadow-sm sm:px-4">
      <Megaphone className="h-4 w-4 shrink-0" strokeWidth={1.8} />
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{announcement.message}</p>
      {hasAction ? (
        <a
          href={announcement.button_url || "#"}
          target={announcement.button_url?.startsWith("http") ? "_blank" : undefined}
          rel={announcement.button_url?.startsWith("http") ? "noreferrer" : undefined}
          className={cn(
            "hidden h-7 shrink-0 items-center gap-1 rounded-[6px] bg-white/14 px-2.5 text-xs font-semibold transition-colors hover:bg-white/20",
            "sm:inline-flex",
          )}
        >
          <span>{announcement.button_text}</span>
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
        </a>
      ) : null}
      <button
        type="button"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-white/80 transition-colors hover:bg-white/14 hover:text-white"
        onClick={() => setDismissedId(announcement.id)}
        aria-label="Fechar comunicado"
        title="Fechar comunicado"
      >
        <X className="h-4 w-4" strokeWidth={1.8} />
      </button>
    </div>
  );
}
