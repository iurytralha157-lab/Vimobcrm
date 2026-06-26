"use client";

import { useEffect, useMemo, useState } from "react";
import { Megaphone, X } from "lucide-react";

import { useActiveAnnouncements } from "@/hooks/use-announcements";
import { cn } from "@/lib/utils";

const ROTATION_INTERVAL_MS = 6000;

export function AnnouncementBanner() {
  const { data: announcements = [] } = useActiveAnnouncements();
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const visibleAnnouncements = useMemo(
    () => announcements.filter((announcement) => !dismissedIds.includes(announcement.id)),
    [announcements, dismissedIds],
  );

  const safeActiveIndex = visibleAnnouncements.length > 0 ? activeIndex % visibleAnnouncements.length : 0;
  const activeAnnouncement = visibleAnnouncements[safeActiveIndex];

  useEffect(() => {
    if (visibleAnnouncements.length <= 1) return undefined;

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % visibleAnnouncements.length);
    }, ROTATION_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [visibleAnnouncements.length]);

  useEffect(() => {
    if (!activeAnnouncement?.display_duration_seconds) return undefined;

    const timeout = window.setTimeout(() => {
      setDismissedIds((current) => {
        return Array.from(new Set([...current, activeAnnouncement.id]));
      });
    }, activeAnnouncement.display_duration_seconds * 1000);

    return () => window.clearTimeout(timeout);
  }, [activeAnnouncement?.display_duration_seconds, activeAnnouncement?.id]);

  if (!activeAnnouncement) return null;

  const dismissCurrentSet = () => {
    const visibleIds = visibleAnnouncements.map((announcement) => announcement.id);
    const next = Array.from(new Set([...dismissedIds, ...visibleIds]));
    setDismissedIds(next);
  };

  return (
    <div className="w-full shrink-0 bg-[#FF4529] text-white shadow-sm">
      <div className="mx-auto flex min-h-10 w-full items-center gap-3 px-4 py-2 text-sm md:px-6">
        <Megaphone className="h-4 w-4 shrink-0" strokeWidth={1.8} />

        <div className="min-w-0 flex-1 overflow-hidden">
          <div
            key={activeAnnouncement.id}
            className="flex min-w-0 items-center gap-3 transition-opacity duration-300"
          >
            <p className="min-w-0 flex-1 truncate font-medium">{activeAnnouncement.message}</p>
            {activeAnnouncement.button_url && activeAnnouncement.button_text ? (
              <a
                href={activeAnnouncement.button_url}
                className="hidden shrink-0 rounded-[6px] bg-white px-2.5 py-1 text-xs font-semibold text-[#FF4529] transition-colors hover:bg-white/90 sm:inline-flex"
              >
                {activeAnnouncement.button_text}
              </a>
            ) : null}
          </div>
        </div>

        {visibleAnnouncements.length > 1 ? (
          <div className="hidden items-center gap-1 sm:flex">
            {visibleAnnouncements.map((announcement, index) => (
              <span
                key={announcement.id}
                className={cn(
                  "h-1.5 w-1.5 rounded-full bg-white/45 transition-all",
                  index === safeActiveIndex && "w-4 bg-white",
                )}
              />
            ))}
          </div>
        ) : null}

        <button
          type="button"
          onClick={dismissCurrentSet}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/12 text-white transition-colors hover:bg-white/20"
          aria-label="Fechar comunicado"
          title="Fechar comunicado"
        >
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
