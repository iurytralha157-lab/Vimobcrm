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

interface LeadTrackingSectionProps {
  leadMeta: LeadMeta | null;
  isLoading?: boolean;
}

export function LeadTrackingSection({ leadMeta, isLoading }: LeadTrackingSectionProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="h-20 bg-muted rounded" />
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

  return (
    <div className="space-y-4">
      {/* Header removido para evitar duplicação no card */}

      {/* Campaign Data */}
      {hasCampaignData && (
        <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4 space-y-3">
          <div className="flex items-center gap-2 mb-3">
            <Megaphone className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Dados da Campanha</span>
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
                externalUrl={leadMeta.creative_video_url || leadMeta.creative_url || undefined}
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
                value={format(new Date(leadMeta.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              />
            )}
          </div>

          {/* Creative Preview (Video or Image) */}
          {(leadMeta.creative_video_url || leadMeta.creative_url) && (
            <div className="mt-3 pt-3 border-t border-white/[0.055] space-y-2">
              {leadMeta.creative_video_url ? (
                <video
                  src={leadMeta.creative_video_url}
                  controls
                  preload="metadata"
                  className="w-full rounded-lg max-h-[240px] bg-black"
                  poster={leadMeta.creative_url || undefined}
                />
              ) : leadMeta.creative_url ? (
                <>
                {/* eslint-disable-next-line @next/next/no-img-element -- Creative URLs come from Meta and may not be covered by Next image domains yet. */}
                <img
                  src={leadMeta.creative_url}
                  alt="Criativo do anúncio"
                  className="w-full rounded-lg max-h-[240px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => window.open(leadMeta.creative_url!, '_blank')}
                />
                </>
              ) : null}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-2 text-xs"
                  onClick={() => window.open(leadMeta.creative_video_url || leadMeta.creative_url!, '_blank')}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Ver Criativo
                </Button>
                {creativeInstagramUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-2 text-xs"
                    onClick={() => window.open(creativeInstagramUrl, '_blank')}
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
        <div className="rounded-xl bg-white/[0.035] border border-white/[0.055] p-4 space-y-3">
          <div className="flex items-center gap-2 mb-3">
            <Link2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Parâmetros UTM</span>
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
        <div className="rounded-xl bg-gradient-to-br from-amber-50/50 to-amber-100/30 dark:from-amber-950/20 dark:to-amber-900/10 border border-amber-200/50 dark:border-amber-800/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-medium text-amber-800 dark:text-amber-200">Observações do Contato</span>
          </div>
          <p className="text-sm text-amber-700 dark:text-amber-300 whitespace-pre-wrap">
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
    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.035]">
      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium truncate">{value}</p>
        {subValue && (
          <p className="text-xs text-muted-foreground truncate">{subValue}</p>
        )}
      </div>
      {externalUrl && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => window.open(externalUrl, '_blank')}
          title="Abrir no Meta Ads Manager"
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
    <div className={`bg-white/[0.035] rounded-lg px-3 py-2 ${className || ''}`}>
      <p className="text-xs text-muted-foreground font-mono">utm_{label}</p>
      <p className="text-sm font-medium truncate">{value}</p>
    </div>
  );
}
