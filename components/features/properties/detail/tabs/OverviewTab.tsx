"use client";

import { Check, CircleAlert, Clock3 } from "lucide-react";

import { EmptyNote, Panel } from "@/components/features/marketing/marketing-ui";
import { cleanPropertyDescription } from "@/lib/property-description";
import { formatPropertyBoolean, formatPropertyDate } from "@/lib/property-display-utils";
import type { PropertyWorkspacePayload } from "@/lib/validation";
import { cn } from "@/lib/utils";

import { PropertyChip, PropertyFieldGrid, filledFields } from "../../property-ui";
import { buildAttentionItems, hasField, localDateISO, type AttentionTone } from "../property-workspace-model";

const ATTENTION_ICONS: Record<AttentionTone, { icon: typeof Clock3; className: string }> = {
  danger: { icon: CircleAlert, className: "text-destructive" },
  warning: { icon: Clock3, className: "text-warning" },
  success: { icon: Check, className: "text-emerald-600 dark:text-emerald-400" },
};

export function OverviewTab({
  workspace,
  onOpenTechnical,
}: {
  workspace: PropertyWorkspacePayload;
  onOpenTechnical: () => void;
}) {
  const { property, summary, assets, keys } = workspace;
  const publicDescription = cleanPropertyDescription(property.descricao_site);
  const description = cleanPropertyDescription(property.descricao);
  const attention = buildAttentionItems({ property, summary, assets, keys, today: localDateISO() });
  const fields = filledFields([
    { label: "Tipo", value: property.tipo_de_imovel || property.tipo },
    { label: "Finalidade", value: hasField(property, "finalidade") ? property.finalidade : null },
    { label: "Andar", value: hasField(property, "andar") && property.andar != null ? `${property.andar}º` : null },
    { label: "Mobília", value: hasField(property, "mobilia") ? property.mobilia : null },
    { label: "Ano de construção", value: hasField(property, "ano_construcao") ? property.ano_construcao : null },
    { label: "Aceita pet", value: hasField(property, "regra_pet") && property.regra_pet != null ? formatPropertyBoolean(property.regra_pet) : null },
    { label: "Financiamento", value: property.aceita_financiamento ? "Aceita" : null },
    { label: "Permuta", value: property.aceita_permuta ? "Aceita" : null },
    { label: "Ocupação", value: hasField(property, "ocupacao") ? property.ocupacao : null },
  ]);
  const features = hasField(property, "detalhes_extras") ? property.detalhes_extras ?? [] : [];

  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        <Panel
          title="Principais informações"
          aside={(
            <button type="button" onClick={onOpenTechnical} className="hover:text-[var(--app-text-primary)]">
              Ver ficha técnica
            </button>
          )}
        >
          {fields.length > 0
            ? <PropertyFieldGrid fields={fields} />
            : <EmptyNote>Nenhuma informação principal preenchida.</EmptyNote>}
        </Panel>

        <Panel title="Descrição">
          {publicDescription || description ? (
            <div className="space-y-3">
              {publicDescription && (
                <p className="whitespace-pre-wrap text-[13px] font-light leading-5 text-[var(--app-text-primary)]">{publicDescription}</p>
              )}
              {description && description !== publicDescription && (
                <div>
                  <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">Descrição do cadastro</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[13px] font-light leading-5 text-[var(--app-text-secondary)]">{description}</p>
                </div>
              )}
            </div>
          ) : <EmptyNote>Nenhuma descrição cadastrada.</EmptyNote>}
          {features.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {features.map((feature) => <PropertyChip key={feature}>{feature}</PropertyChip>)}
            </div>
          )}
        </Panel>
      </div>

      <div className="min-w-0 space-y-3">
        <Panel title="O que precisa de atenção">
          {attention.length > 0 ? (
            <ul className="divide-y divide-[var(--app-border)]">
              {attention.map((item) => {
                const { icon: Icon, className } = ATTENTION_ICONS[item.tone];
                return (
                  <li key={item.key} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
                    <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", className)} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-light text-[var(--app-text-primary)]">{item.title}</p>
                      {item.detail && <p className="text-[12px] font-light text-[var(--app-text-secondary)]">{item.detail}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <EmptyNote>Nada pendente neste imóvel.</EmptyNote>}
        </Panel>
        {property.updated_at && (
          <p className="px-1 text-[11px] font-light text-[var(--app-text-tertiary)]">
            Atualizado em {formatPropertyDate(property.updated_at, true)}
          </p>
        )}
      </div>
    </div>
  );
}
