import type { ReactNode } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ExternalLink, FileEdit, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { ConversationLeadDetail } from "@/lib/api/conversation-lead-detail";
import { formatPhoneForDisplay } from "@/lib/phone-utils";
import {
  panelSectionClassName,
  safeExternalURL,
  sectionTitleClassName,
  sectionTitleStyle,
} from "@/components/features/whatsapp/conversations/conversation-lead-panel-ui";

const SOURCE_LABELS: Record<string, string> = {
  facebook: "Facebook",
  google: "Google",
  manual: "Manual",
  meta: "Meta",
  outro: "outro",
  site: "Site",
  whatsapp: "Whatsapp",
};

function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 text-xs">
      <span className="shrink-0 text-[var(--app-text-tertiary)]">{label}</span>
      <span className="flex min-w-0 flex-1 justify-end [overflow-wrap:anywhere] text-right font-light text-[var(--app-text-primary)]">
        {value}
      </span>
    </div>
  );
}

type ConversationLeadMeta = ConversationLeadDetail["meta"];

function metaText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function hasLeadTrackingData(
  leadMeta: ConversationLeadMeta | null | undefined,
) {
  if (!leadMeta) return false;
  return [
    leadMeta.campaign_name,
    leadMeta.ad_name,
    leadMeta.form_name,
    leadMeta.utm_campaign,
    leadMeta.utm_medium,
    leadMeta.utm_source,
    leadMeta.contact_notes,
    leadMeta.creative_url,
    leadMeta.creative_video_url,
  ].some((value) => Boolean(metaText(value)));
}

function CampaignTrackingHover({
  leadMeta,
  fallbackLabel,
}: {
  leadMeta: ConversationLeadMeta | null | undefined;
  fallbackLabel: string;
}) {
  if (!hasLeadTrackingData(leadMeta)) return <>{fallbackLabel}</>;

  const displayName =
    metaText(leadMeta?.campaign_name) ||
    metaText(leadMeta?.utm_campaign) ||
    metaText(leadMeta?.ad_name) ||
    metaText(leadMeta?.form_name) ||
    fallbackLabel;
  const mainRows = [
    ["Campanha", leadMeta?.campaign_name || leadMeta?.utm_campaign],
    ["Conjunto", null],
    ["Anuncio", leadMeta?.ad_name],
    ["Formulario", leadMeta?.form_name],
    ["Plataforma", fallbackLabel],
    ["Origem", leadMeta?.utm_source],
  ] as const;
  const utmRows = [
    ["utm_source", leadMeta?.utm_source],
    ["utm_medium", leadMeta?.utm_medium],
    ["utm_campaign", leadMeta?.utm_campaign],
  ] as const;
  const links = [
    ["Criativo", leadMeta?.creative_url],
    ["Video", leadMeta?.creative_video_url],
  ] as const;
  const DetailRow = ({ label, value }: { label: string; value: unknown }) => {
    const text = metaText(value);
    if (!text) return null;

    return (
      <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 text-left text-[11px] leading-snug">
        <span className="text-[var(--app-text-tertiary)]">{label}</span>
        <span className="break-words text-left font-light text-[var(--app-text-primary)]">
          {text}
        </span>
      </div>
    );
  };
  const hasUtms = utmRows.some(([, value]) => Boolean(metaText(value)));
  const hasLinks = links.some(([, value]) => Boolean(safeExternalURL(value)));

  return (
    <HoverCard openDelay={100} closeDelay={420}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="group inline-flex min-w-0 max-w-[180px] items-center justify-end gap-1 overflow-hidden whitespace-nowrap text-right font-medium text-[var(--app-text-primary)] outline-none transition-colors hover:text-primary focus-visible:text-primary"
          title={displayName}
        >
          <span className="min-w-0 truncate underline decoration-dotted decoration-[var(--app-text-tertiary)] underline-offset-4 group-hover:decoration-primary group-focus-visible:decoration-primary">
            {displayName}
          </span>
          <Info className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)] transition-colors group-hover:text-primary group-focus-visible:text-primary" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="left"
        align="center"
        sideOffset={4}
        className="vimob-popover-content z-[100] w-[min(420px,calc(100vw-2rem))] rounded-[8px] border-0 p-0 text-left text-[var(--app-text-primary)] shadow-none"
      >
        <div className="border-b border-[var(--app-border)] px-3 py-2 text-left">
          <p className="text-[12px] font-light text-primary">
            Rastreamento de Campanha
          </p>
        </div>

        <div className="max-h-[420px] space-y-3 overflow-y-auto p-3 text-left">
          <div className="space-y-1.5">
            {mainRows.map(([label, value]) => (
              <DetailRow key={label} label={label} value={value} />
            ))}
          </div>

          {hasUtms && (
            <div className="space-y-1.5 border-t border-[var(--app-border)] pt-3 text-left">
              <p className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                UTMs
              </p>
              {utmRows.map(([label, value]) => (
                <DetailRow key={label} label={label} value={value} />
              ))}
            </div>
          )}

          {leadMeta?.contact_notes && (
            <div className="border-t border-[var(--app-border)] pt-3 text-left">
              <p className="text-[12px] font-light text-[var(--app-text-tertiary)]">
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
                const href = safeExternalURL(value);
                if (!href) return null;
                return (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-[11px] font-medium text-[var(--app-text-secondary)] transition-colors hover:text-primary"
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

function formatSource(source?: string | null) {
  if (!source) return "outro";
  return SOURCE_LABELS[source.toLowerCase()] || source;
}

type ConversationLeadContactInformationProps = {
  lead: Pick<ConversationLeadDetail, "id" | "phone" | "email" | "source" | "created_at" | "meta">;
  leadDisplayName: string;
};

export function ConversationLeadContactInformation({ lead, leadDisplayName }: ConversationLeadContactInformationProps) {
  const sourceLabel = formatSource(lead.source);
  const sourceValue = hasLeadTrackingData(lead.meta) ? (
    <CampaignTrackingHover leadMeta={lead.meta} fallbackLabel={sourceLabel} />
  ) : (
    sourceLabel
  );
  const contactRows = [
    { label: "Nome", value: leadDisplayName },
    {
      label: "Telefone",
      value: lead.phone ? formatPhoneForDisplay(lead.phone) : null,
    },
    { label: "E-mail", value: lead.email },
    { label: "Origem", value: sourceValue },
    {
      label: "Criado em",
      value: lead.created_at
        ? format(new Date(lead.created_at), "dd/MM/yy HH:mm")
        : null,
    },
  ].filter((row) => Boolean(row.value));

  return (
    <section className={panelSectionClassName}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className={sectionTitleClassName} style={sectionTitleStyle}>
          Dados do contato
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="lead-detail-subtle-action h-7 rounded-[6px] px-2 text-[10px] font-light"
          asChild
        >
          <Link href={`/crm/pipelines?lead=${lead.id}`}>
            <FileEdit className="h-3 w-3" />
            Editar
          </Link>
        </Button>
      </div>

      <div className="space-y-2">
        {contactRows.map((row) => (
          <InfoLine key={row.label} label={row.label} value={row.value} />
        ))}
      </div>
    </section>
  );
}
