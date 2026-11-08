import { parseLocaleNumber } from "./property-form-numbers";

export type PropertyFormPortfolioType = "ready" | "launch" | "third_party";
export type PropertyFormThirdPartyKind = "" | "partner" | "private_owner";

type PortfolioFormFields = {
  tipo_de_negocio: string;
  portfolio_type: PropertyFormPortfolioType;
  third_party_kind: PropertyFormThirdPartyKind;
  partner_name: string;
  partner_contact: string;
  commission_split_percent: string;
  third_party_authorized_until: string;
};

export const LAUNCH_DEAL_TYPE = "Lançamento";

const isLaunchDeal = (dealType: string) =>
  dealType.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase() === "lancamento";

/**
 * Keeps the pair the API accepts: `launch` requires the Lançamento deal type and
 * `ready` forbids it. Third party works with any deal type.
 */
export function portfolioTypeForDeal(current: PropertyFormPortfolioType, dealType: string): PropertyFormPortfolioType {
  if (current === "third_party") return current;
  return isLaunchDeal(dealType) ? "launch" : "ready";
}

/** The deal type to adopt after picking a portfolio type; null keeps the current one. */
export function dealForPortfolioType(type: PropertyFormPortfolioType, dealType: string) {
  if (type === "launch") return isLaunchDeal(dealType) ? null : LAUNCH_DEAL_TYPE;
  if (type === "ready" && isLaunchDeal(dealType)) return "Venda";
  return null;
}

export function propertyPortfolioToFormFields(property: {
  tipo_de_negocio?: string | null;
  portfolio_type?: PropertyFormPortfolioType | null;
  third_party_kind?: "partner" | "private_owner" | null;
  partner_name?: string | null;
  partner_contact?: string | null;
  commission_split_percent?: number | null;
  third_party_authorized_until?: string | null;
}) {
  return {
    portfolio_type: portfolioTypeForDeal(property.portfolio_type ?? "ready", property.tipo_de_negocio || "Venda"),
    third_party_kind: (property.third_party_kind ?? "") as PropertyFormThirdPartyKind,
    partner_name: property.partner_name ?? "",
    partner_contact: property.partner_contact ?? "",
    commission_split_percent: property.commission_split_percent?.toString() ?? "",
    third_party_authorized_until: property.third_party_authorized_until ?? "",
  };
}

/**
 * Sends only what this viewer may change: the partner contact needs contact access
 * and the split and authorization date are manager fields.
 */
export function buildPropertyPortfolioInput(
  formData: PortfolioFormFields,
  options: { canManage: boolean; canEditOwnerDetails?: boolean },
) {
  const portfolioType = portfolioTypeForDeal(formData.portfolio_type, formData.tipo_de_negocio);
  const input: {
    portfolio_type: PropertyFormPortfolioType;
    third_party_kind?: "partner" | "private_owner" | null;
    partner_name?: string | null;
    partner_contact?: string | null;
    commission_split_percent?: number | null;
    third_party_authorized_until?: string | null;
  } = { portfolio_type: portfolioType };
  if (portfolioType !== "third_party") return input;

  input.third_party_kind = formData.third_party_kind || null;
  if (formData.third_party_kind === "partner") {
    input.partner_name = formData.partner_name.trim() || null;
    if (options.canEditOwnerDetails !== false) {
      input.partner_contact = formData.partner_contact.trim() || null;
    }
  }
  if (options.canManage) {
    input.commission_split_percent = parseLocaleNumber(formData.commission_split_percent) ?? null;
    input.third_party_authorized_until = formData.third_party_authorized_until || null;
  }
  return input;
}

/**
 * Reclassifying a third-party property clears its partner contact, split and
 * authorization date, so the API refuses it to whoever cannot see those fields.
 * The buttons say so up front instead of failing on save.
 */
export function getPortfolioLocks(options: {
  storedType?: PropertyFormPortfolioType | null;
  storedKind?: PropertyFormThirdPartyKind | null;
  canManage: boolean;
  canEditOwnerDetails: boolean;
}) {
  const storedThirdParty = options.storedType === "third_party";
  const contactProtected = storedThirdParty && options.storedKind === "partner" && !options.canEditOwnerDetails;
  return {
    typeLockReason: !storedThirdParty
      ? null
      : !options.canManage
        ? "Só gestores podem tirar um imóvel de Terceiros, porque isso apaga a comissão e a autorização."
        : contactProtected
          ? "Você não tem acesso ao contato do parceiro, que seria apagado nessa mudança."
          : null,
    kindLockReason: contactProtected
      ? "Você não tem acesso ao contato do parceiro, que seria apagado nessa mudança."
      : null,
  };
}

export function getPortfolioValidationIssues(formData: PortfolioFormFields) {
  if (portfolioTypeForDeal(formData.portfolio_type, formData.tipo_de_negocio) !== "third_party") return [];
  const split = parseLocaleNumber(formData.commission_split_percent);
  return [
    !formData.third_party_kind
      ? { label: "Parceiro ou proprietário particular", tab: "structure", fieldId: "property-third-party-kind" }
      : null,
    formData.third_party_kind === "partner" && !formData.partner_name.trim()
      ? { label: "Nome do parceiro", tab: "structure", fieldId: "property-partner-name" }
      : null,
    formData.commission_split_percent.trim() && (split === null || split === undefined || Number.isNaN(split) || split < 0 || split > 100)
      ? { label: "Divisão de comissão entre 0% e 100%", tab: "structure", fieldId: "property-commission-split" }
      : null,
  ].filter((issue): issue is NonNullable<typeof issue> => Boolean(issue));
}

export type PropertyFormProgressItem = { label: string; done: boolean };

/** Reads the same validation issues that block saving, so the list cannot disagree with them. */
export function buildPropertyFormProgress(
  formData: { bairro: string; cidade: string },
  issues: ReadonlyArray<{ tab: string }>,
): PropertyFormProgressItem[] {
  const clear = (tab: string) => !issues.some((issue) => issue.tab === tab);
  return [
    { label: "Responsável e proprietário", done: clear("owner") },
    { label: "Título, tipo e negócio", done: clear("structure") },
    { label: "Endereço", done: clear("location") && Boolean(formData.bairro.trim() && formData.cidade.trim()) },
    { label: "Valor", done: clear("values") },
    { label: "Quartos e área", done: clear("characteristics") },
    { label: "Ao menos uma foto", done: clear("media") },
  ];
}
