import { Button } from '@/components/ui/button';
import {
  Link2,
  FileText,
  Calendar,
  Target,
  Megaphone,
  Layers,
  Image as ImageIcon,
  ExternalLink
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { LeadMeta } from '@/hooks/use-lead-meta';

type LeadMetaWithCreativeLinks = LeadMeta & {
  creative_instagram_url?: string | null;
};

function getSafeExternalUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatCapturedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';
  return format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

function openExternalUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

interface LeadTrackingSectionProps {
  leadMeta: LeadMeta | null;
  isLoading?: boolean;
}

export function LeadTrackingSection({ leadMeta, isLoading }: LeadTrackingSectionProps) {
  if (isLoading) {
    return (
      <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-1/3 rounded-[4px] bg-[var(--app-surface-hover)]" />
          <div className="h-20 rounded-[6px] bg-[var(--app-surface-hover)]" />
        </div>
      </div>
    );
  }

  if (!leadMeta) {
    return null;
  }

  // Check if there's any tracking data to show
  const hasCampaignData = leadMeta.campaign_id || leadMeta.campaign_name ||
    leadMeta.adset_id || leadMeta.adset_name ||
    leadMeta.ad_id || leadMeta.ad_name ||
    leadMeta.form_id || leadMeta.form_name;

  const hasUtmData = leadMeta.utm_source || leadMeta.utm_medium ||
    leadMeta.utm_campaign || leadMeta.utm_content || leadMeta.utm_term;

  const hasContactNotes = leadMeta.contact_notes;

  // If no tracking data at all, don't render
  if (!hasCampaignData && !hasUtmData && !hasContactNotes) {
    return null;
  }

  const creativeInstagramUrl = (leadMeta as LeadMetaWithCreativeLinks).creative_instagram_url;
  const creativeImageUrl = getSafeExternalUrl(leadMeta.creative_url);
  const creativeVideoUrl = getSafeExternalUrl(leadMeta.creative_video_url);
  const instagramUrl = getSafeExternalUrl(creativeInstagramUrl);
  const primaryCreativeUrl = creativeVideoUrl || creativeImageUrl;

  return (
    <div className="space-y-4">
      {/* Header removido para evitar duplicação no card */}

      {/* Campaign Data */}
      {hasCampaignData && (
        <div className="space-y-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <Megaphone className="h-4 w-4" />
            </span>
            <span className="text-[14px] font-normal">Dados da Campanha</span>
          </div>

          <div className="grid gap-2">
            {(leadMeta.campaign_name || leadMeta.campaign_id) && (
              <TrackingRow
                icon={Target}
                label="Campanha"
                value={leadMeta.campaign_name || leadMeta.campaign_id || ''}
                subValue={leadMeta.campaign_name && leadMeta.campaign_id ? `ID: ${leadMeta.campaign_id}` : undefined}
              />
            )}

            {(leadMeta.adset_name || leadMeta.adset_id) && (
              <TrackingRow
                icon={Layers}
                label="Conjunto"
                value={leadMeta.adset_name || leadMeta.adset_id || ''}
                subValue={leadMeta.adset_name && leadMeta.adset_id ? `ID: ${leadMeta.adset_id}` : undefined}
              />
            )}

            {(leadMeta.ad_name || leadMeta.ad_id) && (
              <TrackingRow
                icon={ImageIcon}
                label="Anúncio"
                value={leadMeta.ad_name || leadMeta.ad_id || ''}
                subValue={leadMeta.ad_name && leadMeta.ad_id ? `ID: ${leadMeta.ad_id}` : undefined}
                externalUrl={primaryCreativeUrl || undefined}
                externalUrlLabel="Ver criativo"
              />
            )}

            {(leadMeta.form_name || leadMeta.form_id) && (
              <TrackingRow
                icon={FileText}
                label="Formulário"
                value={leadMeta.form_name || leadMeta.form_id || ''}
                subValue={leadMeta.form_name && leadMeta.form_id && leadMeta.form_name !== leadMeta.form_id ? `ID: ${leadMeta.form_id}` : undefined}
              />
            )}

            {leadMeta.created_at && (
              <TrackingRow
                icon={Calendar}
                label="Capturado em"
                value={formatCapturedAt(leadMeta.created_at)}
              />
            )}
          </div>

          {/* Creative Preview (Video or Image) */}
          {primaryCreativeUrl && (
            <div className="mt-3 space-y-2 border-t border-[var(--app-border)] pt-3">
              {creativeVideoUrl ? (
                <video
                  src={creativeVideoUrl}
                  controls
                  preload="metadata"
                  className="max-h-[240px] w-full rounded-[8px] bg-black"
                  poster={creativeImageUrl || undefined}
                />
              ) : creativeImageUrl ? (
                <button
                  type="button"
                  className="block w-full rounded-[8px] outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  onClick={() => openExternalUrl(creativeImageUrl)}
                  aria-label="Abrir criativo do anúncio"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- Creative URLs come from Meta and may not be covered by Next image domains yet. */}
                  <img
                    src={creativeImageUrl}
                    alt="Criativo do anúncio"
                    className="max-h-[240px] w-full rounded-[8px] object-cover transition-opacity hover:opacity-90"
                  />
                </button>
              ) : null}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 flex-1 gap-2 rounded-[6px] bg-[var(--app-surface-solid)] text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
                  onClick={() => openExternalUrl(primaryCreativeUrl)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Ver Criativo
                </Button>
                {instagramUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 flex-1 gap-2 rounded-[6px] bg-[var(--app-surface-solid)] text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
                    onClick={() => openExternalUrl(instagramUrl)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Ver no Instagram
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* UTM Parameters */}
      {hasUtmData && (
        <div className="space-y-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <Link2 className="h-4 w-4" />
            </span>
            <span className="text-[14px] font-normal">Parâmetros UTM</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {leadMeta.utm_source && (
              <UtmTag label="source" value={leadMeta.utm_source} />
            )}
            {leadMeta.utm_medium && (
              <UtmTag label="medium" value={leadMeta.utm_medium} />
            )}
            {leadMeta.utm_campaign && (
              <UtmTag label="campaign" value={leadMeta.utm_campaign} className="col-span-2" />
            )}
            {leadMeta.utm_content && (
              <UtmTag label="content" value={leadMeta.utm_content} />
            )}
            {leadMeta.utm_term && (
              <UtmTag label="term" value={leadMeta.utm_term} />
            )}
          </div>
        </div>
      )}

      {/* Contact Notes */}
      {hasContactNotes && (
        <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <FileText className="h-4 w-4" />
            </span>
            <span className="text-[14px] font-normal">Observações do Contato</span>
          </div>
          <p className="whitespace-pre-wrap text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
            {leadMeta.contact_notes}
          </p>
        </div>
      )}
    </div>
  );
}

// Helper components
interface TrackingRowProps {
  icon: React.ElementType;
  label: string;
  value: string;
  subValue?: string;
  externalUrl?: string;
  externalUrlLabel?: string;
}

function TrackingRow({ icon: Icon, label, value, subValue, externalUrl }: TrackingRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-[6px] bg-[var(--app-surface-solid)] p-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">{label}</p>
        <p className="truncate text-[12px] font-normal text-[var(--app-text-primary)]">{value}</p>
        {subValue && (
          <p className="truncate text-[11px] font-light text-[var(--app-text-tertiary)]">{subValue}</p>
        )}
      </div>
      {externalUrl && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-[6px] shadow-none hover:bg-[var(--app-surface-hover)]"
          onClick={() => openExternalUrl(externalUrl)}
          title="Abrir no Meta Ads Manager"
          aria-label="Abrir criativo no Meta Ads Manager"
        >
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      )}
    </div>
  );
}

interface UtmTagProps {
  label: string;
  value: string;
  className?: string;
}

function UtmTag({ label, value, className }: UtmTagProps) {
  return (
    <div className={`rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 ${className || ''}`}>
      <p className="font-mono text-[11px] font-light text-[var(--app-text-tertiary)]">utm_{label}</p>
      <p className="truncate text-[12px] font-normal text-[var(--app-text-primary)]">{value}</p>
    </div>
  );
}
