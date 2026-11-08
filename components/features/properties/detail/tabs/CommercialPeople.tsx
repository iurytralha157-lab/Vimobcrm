"use client";

import { Pencil, Plus } from "lucide-react";

import { EmptyNote, Panel } from "@/components/features/marketing/marketing-ui";
import { Button } from "@/components/ui/button";
import { formatPropertyBoolean, formatPropertyDate } from "@/lib/property-display-utils";
import type { PropertyWorkspaceMeta, PropertyWorkspaceOwnership } from "@/lib/validation";
import { cn } from "@/lib/utils";

import {
  PROPERTY_SECONDARY_BUTTON_CLASS,
  PersonAvatar,
  PropertyChip,
  PropertyFieldGrid,
  ResponsibleAvatar,
  filledFields,
} from "../../property-ui";
import { hasField, type WorkspaceProperty } from "../property-workspace-model";

function ownerContactFields(ownership: PropertyWorkspaceOwnership) {
  const owner = ownership.owner;
  return filledFields([
    { label: "Celular", value: "cellphone" in owner ? owner.cellphone : null },
    { label: "Telefone residencial", value: "phone_residential" in owner ? owner.phone_residential : null },
    { label: "Telefone comercial", value: "phone_commercial" in owner ? owner.phone_commercial : null },
    { label: "E-mail", value: "email" in owner ? owner.email : null },
    { label: "Origem", value: "media_source" in owner ? owner.media_source : null },
    { label: "Notificar por e-mail", value: "notify_email" in owner && owner.notify_email != null ? formatPropertyBoolean(owner.notify_email) : null },
    { label: "Vigência", value: ownership.valid_to ? `${formatPropertyDate(ownership.valid_from)} a ${formatPropertyDate(ownership.valid_to)}` : `Desde ${formatPropertyDate(ownership.valid_from)}` },
    { label: "Nota do proprietário", value: "notes" in owner ? owner.notes : null },
    { label: "Nota do vínculo", value: "notes" in ownership ? ownership.notes : null },
  ]);
}

export function CommercialOwners({
  property,
  ownerships,
  meta,
  normalizedResourcesAvailable,
  today,
  onCreate,
  onEdit,
  onEnd,
}: {
  property: WorkspaceProperty;
  ownerships: PropertyWorkspaceOwnership[];
  meta: PropertyWorkspaceMeta;
  normalizedResourcesAvailable: boolean;
  today: string;
  onCreate: () => void;
  onEdit: (ownership: PropertyWorkspaceOwnership) => void;
  onEnd: (ownership: PropertyWorkspaceOwnership) => void;
}) {
  const isActive = (ownership: PropertyWorkspaceOwnership) =>
    ownership.valid_from <= today && (!ownership.valid_to || today < ownership.valid_to);
  const activeShare = ownerships.filter(isActive).reduce((sum, item) => sum + Number(item.ownership_percentage || 0), 0);
  const legacyFields = filledFields([
    { label: "Nome", value: property.owner_name },
    { label: "Celular", value: hasField(property, "owner_cellphone") ? property.owner_cellphone : null },
    { label: "Telefone residencial", value: hasField(property, "owner_phone_residential") ? property.owner_phone_residential : null },
    { label: "Telefone comercial", value: hasField(property, "owner_phone_commercial") ? property.owner_phone_commercial : null },
    { label: "E-mail", value: hasField(property, "owner_email") ? property.owner_email : null },
    { label: "Origem", value: hasField(property, "owner_media_source") ? property.owner_media_source : null },
  ]);
  const partnerFields = filledFields([
    { label: "Parceiro", value: property.partner_name },
    { label: "Contato do parceiro", value: hasField(property, "partner_contact") ? property.partner_contact : null },
  ]);

  return (
    <Panel
      title="Proprietários"
      aside={ownerships.length > 0 ? `${activeShare.toLocaleString("pt-BR")}% informado` : !meta.can_view_owner_contacts ? "Contatos protegidos" : undefined}
    >
      {partnerFields.length > 0 && (
        <div className="mb-3 border-b border-[var(--app-border)] pb-3">
          <PropertyFieldGrid fields={partnerFields} columns={2} />
        </div>
      )}
      {ownerships.length > 0 ? (
        <ul className="divide-y divide-[var(--app-border)]">
          {ownerships.map((ownership) => {
            const active = isActive(ownership);
            const status = active ? "Ativo" : ownership.valid_from > today ? "Agendado" : "Histórico";
            return (
              <li key={ownership.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <PersonAvatar name={ownership.owner.name} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="min-w-0 break-words text-[13px] font-light text-[var(--app-text-primary)]">{ownership.owner.name}</p>
                      {ownership.is_primary && <PropertyChip>Principal</PropertyChip>}
                      <PropertyChip tone={active ? "success" : "neutral"}>{status}</PropertyChip>
                    </div>
                    {!meta.can_view_owner_contacts && (
                      <p className="text-[12px] font-light text-[var(--app-text-tertiary)]">Contato oculto pela organização</p>
                    )}
                  </div>
                  <span className="shrink-0 text-[15px] font-normal tabular-nums text-[var(--app-text-primary)]">{ownership.ownership_percentage}%</span>
                </div>
                <div className="mt-2"><PropertyFieldGrid fields={ownerContactFields(ownership)} columns={2} /></div>
                {meta.can_manage && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button type="button" variant="ghost" className={PROPERTY_SECONDARY_BUTTON_CLASS} onClick={() => onEdit(ownership)}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Editar
                    </Button>
                    {!ownership.valid_to && (
                      <Button type="button" variant="ghost" className={PROPERTY_SECONDARY_BUTTON_CLASS} onClick={() => onEnd(ownership)}>
                        Encerrar vínculo
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : legacyFields.length > 0 ? (
        <PropertyFieldGrid fields={legacyFields} columns={2} />
      ) : partnerFields.length === 0 ? (
        <EmptyNote>Nenhum proprietário vinculado.</EmptyNote>
      ) : null}
      {meta.can_manage && normalizedResourcesAvailable && (
        <Button type="button" variant="ghost" className={cn(PROPERTY_SECONDARY_BUTTON_CLASS, "mt-3")} onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Adicionar proprietário
        </Button>
      )}
    </Panel>
  );
}

type TeamPerson = { name: string; avatarUrl: string | null } | null;

function TeamMember({ label, person }: { label: string; person: NonNullable<TeamPerson> }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ResponsibleAvatar name={person.name} avatarUrl={person.avatarUrl} role={label} />
      <div className="min-w-0">
        <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">{label}</p>
        <p className="truncate text-[13px] font-light text-[var(--app-text-primary)]">{person.name}</p>
      </div>
    </div>
  );
}

export function CommercialTeam({
  responsible,
  captor,
  broker,
  editPolicy,
}: {
  responsible: TeamPerson;
  captor: TeamPerson;
  broker: TeamPerson;
  editPolicy?: string | null;
}) {
  return (
    <Panel title="Equipe">
      <div className="grid grid-cols-2 gap-3">
        {responsible && <TeamMember label="Responsável" person={responsible} />}
        {captor && <TeamMember label="Captação" person={captor} />}
        {broker && <TeamMember label="Corretor" person={broker} />}
        <div className="col-span-2">
          <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">Pode editar</p>
          <p className="text-[13px] font-light text-[var(--app-text-primary)]">
            {editPolicy === "everyone" ? "Todos que podem ver o imóvel" : "Responsável e gestores"}
          </p>
        </div>
      </div>
    </Panel>
  );
}
