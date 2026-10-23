"use client";

import { useEffect, useState } from "react";
import { AvatarImage } from "@/components/ui/avatar";
import { getWhatsAppAvatarCandidates } from "@/lib/whatsapp-avatar";

/** Try the authorized candidates, then one bounded retry; geometry never changes. */
export function WhatsAppAvatarImage({ src, fallbackSrc, fallbackSources = [], alt, className }: {
  src?: string | null; fallbackSrc?: string | null; fallbackSources?: readonly (string | null | undefined)[];
  alt?: string; className?: string;
}) {
  const candidates = getWhatsAppAvatarCandidates(src, fallbackSrc, ...fallbackSources);
  const signature = JSON.stringify(candidates);
  const [attempt, setAttempt] = useState({ signature, index: 0, retry: 0, exhausted: false });
  const current = attempt.signature === signature ? attempt : { signature, index: 0, retry: 0, exhausted: false };
  if (attempt.signature !== signature) setAttempt(current);
  useEffect(() => {
    if (!current.exhausted || current.retry > 0 || candidates.length === 0) return;
    const timer = window.setTimeout(() => setAttempt(previous => previous.signature === signature
      ? { signature, index: 0, retry: 1, exhausted: false } : previous), 750);
    return () => window.clearTimeout(timer);
  }, [candidates.length, current.exhausted, current.retry, signature]);
  const selected = current.exhausted ? undefined : candidates[current.index];
  return <AvatarImage key={`${signature}:${current.index}:${current.retry}`} src={selected} alt={alt}
    className={className} onLoadingStatusChange={status => {
      if (status !== "error" || !selected) return;
      setAttempt(previous => {
        if (previous.signature !== signature || previous.index !== current.index || previous.retry !== current.retry) return previous;
        return previous.index + 1 < candidates.length ? { ...previous, index: previous.index + 1 }
          : { ...previous, exhausted: true };
      });
    }} />;
}
