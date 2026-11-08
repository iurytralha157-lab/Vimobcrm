"use client";

import { Pencil } from "lucide-react";

import { EmptyNote, Panel } from "@/components/features/marketing/marketing-ui";
import { Button } from "@/components/ui/button";
import { usePropertyCondominiums } from "@/hooks/use-property-locations";
import { formatPropertyArea, formatPropertyBoolean, formatPropertyDate } from "@/lib/property-display-utils";

import { normalizeText } from "../../property-display";
import { PROPERTY_SECONDARY_BUTTON_CLASS, PropertyFieldGrid, filledFields, isFilled } from "../../property-ui";
import { ADDRESS_VISIBILITY_LABELS, hasField, type WorkspaceProperty } from "../property-workspace-model";

const yesNo = (value: boolean | null | undefined) => (value == null ? null : formatPropertyBoolean(value));
const area = (value: number | null | undefined) => (value ? formatPropertyArea(value) : null);
const list = (value: string[] | null | undefined) => (value?.length ? value.join(", ") : null);

/** Empty important fields this viewer can see. Protected fields never count as missing. */
export function missingImportantFields(property: WorkspaceProperty) {
  const isLand = ["terreno", "lote"].includes(normalizeText(property.tipo_de_imovel || property.tipo));
  const candidates: Array<[string, unknown, boolean]> = [
    ["tipo do imóvel", property.tipo_de_imovel || property.tipo, true],
    ["quartos", property.quartos, !isLand],
    ["banheiros", property.banheiros, !isLand],
    ["área", property.area_util || property.area_total, true],
    ["CEP", property.cep, true],
    ["ano de construção", property.ano_construcao, !isLand && hasField(property, "ano_construcao")],
    ["zoneamento", property.zoneamento, hasField(property, "zoneamento")],
    ["matrícula", property.numero_matricula, hasField(property, "numero_matricula")],
  ];
  return candidates.filter(([, value, applies]) => applies && !isFilled(value)).map(([label]) => label);
}

export function TechnicalTab({
  property,
  canEdit,
  onEdit,
}: {
  property: WorkspaceProperty;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { data: condominiums = [] } = usePropertyCondominiums();
  const condominium = condominiums.find((item) => item.id === property.condominium_id)?.name;
  const missing = missingImportantFields(property);

  const identity = filledFields([
    { label: "Tipo", value: property.tipo_de_imovel || property.tipo },
    { label: "Negócio", value: property.tipo_de_negocio },
    { label: "Finalidade", value: property.finalidade },
    { label: "Situação", value: property.situacao_imovel },
    { label: "Padrão", value: property.padrao },
    { label: "Andar", value: property.andar != null ? `${property.andar}º` : null },
    { label: "Posição", value: property.posicao_localizacao },
    { label: "Ano de construção", value: property.ano_construcao },
    { label: "Ano da reforma", value: property.ano_reforma },
    { label: "Mobília", value: property.mobilia },
    { label: "Aceita pet", value: yesNo(property.regra_pet) },
  ]);
  const rooms = filledFields([
    { label: "Quartos", value: property.quartos },
    { label: "Suítes", value: property.suites },
    { label: "Banheiros", value: property.banheiros },
    { label: "Vagas", value: property.vagas },
    { label: "Área útil", value: area(property.area_util) },
    { label: "Área total", value: area(property.area_total) },
  ]);
  const amenities = filledFields([
    { label: "Do imóvel", value: list(property.detalhes_extras) },
    { label: "Proximidades", value: list(property.proximidades) },
    { label: "Marcadores", value: list(property.marcadores) },
  ]);
  const visibility = property.address_visibility || property.public_address_visibility;
  const location = filledFields([
    { label: "Endereço", value: [property.endereco, property.numero].filter(Boolean).join(", ") },
    { label: "Complemento", value: property.complemento },
    { label: "Bairro", value: property.bairro },
    { label: "Cidade", value: [property.cidade, property.uf].filter(Boolean).join(", ") },
    { label: "CEP", value: property.cep },
    { label: "Condomínio", value: condominium },
    { label: "País", value: property.pais },
    { label: "Zoneamento", value: property.zoneamento },
    { label: "No site mostra", value: visibility ? ADDRESS_VISIBILITY_LABELS[visibility] ?? visibility : null },
  ]);
  const documentation = filledFields([
    { label: "Matrícula", value: property.numero_matricula },
    { label: "Código do IPTU", value: property.codigo_iptu },
    { label: "Código de eletricidade", value: property.codigo_eletricidade },
    { label: "Código de água", value: property.codigo_agua },
    { label: "Ocupação", value: property.ocupacao },
    { label: "Projeto aprovado", value: yesNo(property.projeto_aprovado) },
    { label: "Aprovação ambiental", value: property.aprovacao_ambiental },
    { label: "Comercialização autorizada", value: yesNo(property.autorizado_comercializacao) },
    { label: "Autorização até", value: property.third_party_authorized_until ? formatPropertyDate(property.third_party_authorized_until) : null },
    { label: "Referência alternativa", value: property.referencia_alternativa },
    { label: "Status descritivo", value: property.status_descritivo },
    { label: "Observações", value: property.observacoes_documentacao },
  ]);

  return (
    <div className="min-w-0 space-y-3">
      {missing.length > 0 && (
        <div role="status" className="flex flex-col gap-2 rounded-[12px] bg-destructive/10 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-[13px] font-light text-[var(--app-text-primary)]">
            {missing.length === 1 ? "Falta 1 campo importante" : `Faltam ${missing.length} campos importantes`}: {missing.join(", ")}.
          </p>
          {canEdit && (
            <Button type="button" variant="ghost" onClick={onEdit} className={`${PROPERTY_SECONDARY_BUTTON_CLASS} shrink-0 bg-[var(--app-surface-solid)]`}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Preencher agora
            </Button>
          )}
        </div>
      )}
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <Panel title="O imóvel">
            {identity.length > 0 ? <PropertyFieldGrid fields={identity} columns={5} /> : <EmptyNote>Nada preenchido ainda.</EmptyNote>}
          </Panel>
          <Panel title="Cômodos e áreas">
            {rooms.length > 0 ? <PropertyFieldGrid fields={rooms} columns={5} /> : <EmptyNote>Nada preenchido ainda.</EmptyNote>}
          </Panel>
          {amenities.length > 0 && <Panel title="Comodidades"><PropertyFieldGrid fields={amenities} columns={3} /></Panel>}
        </div>
        <div className="min-w-0 space-y-3">
          {location.length > 0 && <Panel title="Localização"><PropertyFieldGrid fields={location} columns={2} /></Panel>}
          {documentation.length > 0 && <Panel title="Documentação"><PropertyFieldGrid fields={documentation} columns={2} /></Panel>}
        </div>
      </div>
    </div>
  );
}
