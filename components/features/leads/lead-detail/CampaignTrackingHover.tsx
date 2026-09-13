import { useCallback, useEffect, useRef, useState } from 'react';
import { ptBR } from 'date-fns/locale';
import { ExternalLink, Info } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { getSafeAbsoluteHttpUrl } from '@/lib/safe-http-url';
import type { CampaignTrackingDetails } from './types';
import { formatDateSafely } from './utils';
import {
  hasLeadTrackingData,
  metaText,
  safeExternalUrl,
  trackingSourceLabel,
} from './tracking';

export function CampaignTrackingHover({
  leadMeta,
}: {
  leadMeta: CampaignTrackingDetails | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const keepOpen = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  }, []);

  const scheduleClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, 420);
  }, []);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  if (!hasLeadTrackingData(leadMeta)) return null;

  const sourceLabel =
    trackingSourceLabel(leadMeta?.platform) || trackingSourceLabel(leadMeta?.source_type);
  const displayName =
    metaText(leadMeta?.campaign_name) ||
    metaText(leadMeta?.utm_campaign) ||
    metaText(leadMeta?.ad_name) ||
    metaText(leadMeta?.form_name) ||
    sourceLabel ||
    'Campanha registrada';

  const mainRows = [
    ['Campanha', metaText(leadMeta?.campaign_name) || metaText(leadMeta?.utm_campaign)],
    ['Conjunto', leadMeta?.adset_name],
    ['Anuncio', leadMeta?.ad_name],
    ['Formulario', leadMeta?.form_name],
    ['ID do formulário', leadMeta?.form_id],
    ['Página', leadMeta?.page_name || leadMeta?.page_id],
    ['Leadgen', leadMeta?.leadgen_id],
    ['Plataforma', trackingSourceLabel(leadMeta?.platform) || leadMeta?.platform],
    ['Origem', trackingSourceLabel(leadMeta?.source_type) || leadMeta?.utm_source],
    [
      'Capturado em',
      leadMeta?.created_at
        ? formatDateSafely(
            leadMeta.created_at,
            "dd/MM/yyyy 'às' HH:mm",
            ptBR,
            leadMeta.created_at,
          )
        : null,
    ],
  ] as const;

  const utmRows = [
    ['utm_source', leadMeta?.utm_source],
    ['utm_medium', leadMeta?.utm_medium],
    ['utm_campaign', leadMeta?.utm_campaign],
    ['utm_content', leadMeta?.utm_content],
    ['utm_term', leadMeta?.utm_term],
  ] as const;

  const safeCreativeLink = getSafeAbsoluteHttpUrl(leadMeta?.creative_link_url)
    || getSafeAbsoluteHttpUrl(leadMeta?.creative_instagram_url);
  const seenLinks = new Set<string>();
  const links = ([
    ['Link do criativo', safeCreativeLink],
    ['Imagem', getSafeAbsoluteHttpUrl(leadMeta?.creative_url)],
    ['Video', getSafeAbsoluteHttpUrl(leadMeta?.creative_video_url)],
  ] as const).flatMap(([label, value]) => {
    const href = metaText(value);
    if (!href || seenLinks.has(href)) return [];
    seenLinks.add(href);
    return [[label, href] as const];
  });

  const DetailRow = ({ label, value }: { label: string; value: unknown }) => {
    const text = metaText(value);
    if (!text) return null;

    return (
      <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 text-left text-[11px] leading-snug">
        <span className="text-[var(--app-text-tertiary)]">{label}</span>
        <span className="break-words text-left font-normal text-[var(--app-text-primary)]">
          {text}
        </span>
      </div>
    );
  };

  const hasUtms = utmRows.some(([, value]) => Boolean(metaText(value)));
  const hasLinks = links.length > 0;

  return (
    <HoverCard
      open={open}
      onOpenChange={(nextOpen) => nextOpen ? keepOpen() : scheduleClose()}
      openDelay={0}
      closeDelay={0}
    >
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          onClick={keepOpen}
          onFocus={keepOpen}
          onBlur={scheduleClose}
          onPointerEnter={keepOpen}
          onPointerLeave={scheduleClose}
          className="group inline-flex min-w-0 max-w-full items-center justify-end gap-1 text-right font-normal text-[var(--app-text-primary)] outline-none transition-colors hover:text-primary focus-visible:text-primary"
        >
          <span className="truncate underline decoration-dotted decoration-[var(--app-text-tertiary)] underline-offset-4 group-hover:decoration-primary group-focus-visible:decoration-primary">
            {displayName}
          </span>
          <Info className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)] transition-colors group-hover:text-primary group-focus-visible:text-primary" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="center"
        sideOffset={4}
        collisionPadding={12}
        onFocusCapture={keepOpen}
        onBlurCapture={scheduleClose}
        onPointerEnter={keepOpen}
        onPointerLeave={scheduleClose}
        className="vimob-popover-content w-[min(420px,calc(100vw-2rem))] rounded-[8px] border-0 p-0 text-left text-[var(--app-text-primary)] shadow-none"
      >
        <div className="border-b border-[var(--app-border)] px-3 py-2 text-left">
          <p className="text-[11px] font-normal text-primary">Rastreamento de campanha</p>
        </div>

        <div className="max-h-[420px] space-y-3 overflow-y-auto p-3 text-left">
          <div className="space-y-1.5">
            {mainRows.map(([label, value]) => (
              <DetailRow key={label} label={label} value={value} />
            ))}
          </div>

          {hasUtms && (
            <div className="space-y-1.5 border-t border-[var(--app-border)] pt-3 text-left">
              <p className="text-[11px] font-normal text-[var(--app-text-tertiary)]">UTMs</p>
              {utmRows.map(([label, value]) => (
                <DetailRow key={label} label={label} value={value} />
              ))}
            </div>
          )}

          {leadMeta?.contact_notes && (
            <div className="border-t border-[var(--app-border)] pt-3 text-left">
              <p className="text-[11px] font-normal text-[var(--app-text-tertiary)]">
                Observações
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-snug text-[var(--app-text-secondary)]">
                {leadMeta.contact_notes}
              </p>
            </div>
          )}

          {hasLinks && (
            <div className="flex flex-wrap gap-2 border-t border-[var(--app-border)] pt-3 text-left">
              {links.map(([label, value]) => {
                const href = safeExternalUrl(value);
                if (!href) return null;
                return (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-[11px] font-light text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] hover:text-primary"
                  >
                    <span>{label}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
