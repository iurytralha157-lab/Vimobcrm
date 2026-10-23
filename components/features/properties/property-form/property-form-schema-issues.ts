import type { ZodIssue } from "zod";
import type { ValidationIssue } from "@/components/features/properties/property-form/property-form-model";

const fields: Record<string, ValidationIssue> = {
  title: { label: "Título do imóvel", tab: "structure", fieldId: "property-title" },
  status: { label: "Status do imóvel", tab: "structure", fieldId: "property-status" },
  tipo_de_imovel: { label: "Tipo do imóvel", tab: "structure", fieldId: "property-type" },
  tipo_de_negocio: { label: "Modalidade", tab: "structure", fieldId: "property-deal-type" },
  quartos: { label: "Quartos", tab: "characteristics", fieldId: "property-bedrooms" },
  suites: { label: "Suítes", tab: "characteristics", fieldId: "property-suites" },
  banheiros: { label: "Banheiros", tab: "characteristics", fieldId: "property-bathrooms" },
  vagas: { label: "Vagas", tab: "characteristics", fieldId: "property-parking-spaces" },
  area_util: { label: "Área útil", tab: "characteristics", fieldId: "property-usable-area" },
  area_total: { label: "Área total", tab: "characteristics", fieldId: "property-total-area" },
  andar: { label: "Andar", tab: "characteristics", fieldId: "property-floor" },
  ano_construcao: { label: "Ano de construção", tab: "characteristics", fieldId: "property-construction-year" },
  ano_reforma: { label: "Ano da reforma", tab: "characteristics", fieldId: "property-renovation-year" },
  preco: { label: "Preço de venda", tab: "values", fieldId: "property-sale-price" },
  valor_locacao: { label: "Valor de locação", tab: "values", fieldId: "property-rental-price" },
  condominio: { label: "Taxa de condomínio", tab: "values", fieldId: "property-condominium-fee" },
  iptu: { label: "IPTU", tab: "values", fieldId: "property-property-tax" },
  cep: { label: "CEP", tab: "location", fieldId: "property-cep" },
  cidade: { label: "Cidade", tab: "location", fieldId: "property-city-manual" },
  bairro: { label: "Bairro", tab: "location", fieldId: "property-neighborhood-manual" },
  uf: { label: "UF", tab: "location", fieldId: "property-state" },
  owner_email: { label: "E-mail do proprietário", tab: "owner", fieldId: "property-owner-email" },
  owner_name: { label: "Nome do proprietário", tab: "owner", fieldId: "property-owner-name" },
  cadastrado_por: { label: "Responsável pela captação", tab: "owner", fieldId: "property-captor" },
  descricao_site: { label: "Descrição pública", tab: "media", fieldId: "property-public-description" },
  comissao_venda: { label: "Comissão de venda", tab: "commissions", fieldId: "property-sale-commission" },
  comissao_locacao: { label: "Comissão de locação", tab: "commissions", fieldId: "property-rental-commission" },
};

export function propertySchemaIssuesToForm(issues: readonly ZodIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.flatMap((issue) => {
    const field = String(issue.path[0] ?? "");
    const mapped = fields[field] ?? { label: "Dados do imóvel", tab: "structure" };
    if (seen.has(mapped.fieldId ?? mapped.label)) return [];
    seen.add(mapped.fieldId ?? mapped.label);
    return [mapped];
  });
}
