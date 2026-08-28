export type WhatsAppReferralLeadContext = {
  explicit_source_type?: string | null;
  source_id?: string | null;
};

export type ImportedMetaAdLookup = (
  organizationId: string,
  sourceId: string,
) => Promise<boolean>;

const META_AD_ID_PATTERN = /^\d{5,40}$/;

export async function hasVerifiedMetaAdLeadCreationContext(
  organizationId: string,
  referral: WhatsAppReferralLeadContext | null | undefined,
  hasImportedMetaAd: ImportedMetaAdLookup,
) {
  if (!referral) return false;

  const sourceType = referral.explicit_source_type?.trim().toLowerCase() || "";
  const sourceId = referral.source_id?.trim() || "";
  if (sourceType !== "ad" || !META_AD_ID_PATTERN.test(sourceId)) return false;

  return await hasImportedMetaAd(organizationId, sourceId);
}
