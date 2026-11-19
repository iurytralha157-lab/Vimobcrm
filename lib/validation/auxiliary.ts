// Compatibility exports for existing consumers. New contracts belong to their domain module.
export {
  uuidListSchema,
  organizationIdSchema,
  entityIdSchema,
} from "@/lib/validation/shared-schema-values";
export {
  auditLogFiltersSchema,
  auditLogListInputSchema,
  apiAuditLogListResponseSchema,
  auditFeedEventPayloadSchema,
} from "@/lib/validation/audit";
export {
  apiConversationLeadDetailResponseSchema,
  leadAttachmentCreateInputSchema,
  apiLeadAttachmentResponseSchema,
  apiLeadAttachmentListResponseSchema,
  apiLeadEnrichmentListResponseSchema,
  apiLeadMetaResponseSchema,
  leadTaskTypeSchema,
  leadTaskCreateInputSchema,
  leadTaskPatchInputSchema,
  cadenceTaskCompletionInputSchema,
  apiLeadTaskResponseSchema,
  apiLeadTaskListResponseSchema,
  apiLeadVisibilityResponseSchema,
} from "@/lib/validation/lead-details";
export {
  messageTemplateCreateInputSchema,
  messageTemplateUpdateInputSchema,
  apiMessageTemplateResponseSchema,
  apiMessageTemplateListResponseSchema,
} from "@/lib/validation/message-templates";
export {
  paymentCheckoutQuerySchema,
  checkoutBillingProfileSessionSchema,
  checkoutBillingDraftSessionSchema,
  paymentStatusQuerySchema,
  paymentMutationInputSchema,
} from "@/lib/validation/billing-checkout";
export {
  propertyCatalogCreateInputSchema,
  propertyCatalogSeedInputSchema,
  apiPropertyCatalogResponseSchema,
  apiPropertyCatalogListResponseSchema,
  apiPropertyImageResponseSchema,
  propertyCityInputSchema,
  propertyCityUpdateInputSchema,
  propertyNeighborhoodInputSchema,
  propertyNeighborhoodUpdateInputSchema,
  propertyCondominiumInputSchema,
  propertyCondominiumUpdateInputSchema,
  propertyCatalogDeleteInputSchema,
  apiPropertyCityResponseSchema,
  apiPropertyCityListResponseSchema,
  apiPropertyNeighborhoodResponseSchema,
  apiPropertyNeighborhoodListResponseSchema,
  apiPropertyCondominiumResponseSchema,
  apiPropertyCondominiumListResponseSchema,
  propertyOwnerInputSchema,
  propertyOwnerCatalogUpdateInputSchema,
  propertyOwnerPageQuerySchema,
  apiPropertyOwnerResponseSchema,
  apiPropertyOwnerPageResponseSchema,
  apiPropertyCaptorResponseSchema,
  apiPropertySiteInfoResponseSchema,
  apiPropertySummaryListResponseSchema,
} from "@/lib/validation/property-catalogs";
export {
  publicDomainSchema,
  publicSiteQuerySchema,
  apiPublicSiteResolveResponseSchema,
  apiPublicDataResponseSchema,
  publicSiteConfigSchema,
  publicPropertySchema,
  publicHomeDataSchema,
  publicPropertiesDataSchema,
  publicPropertyDataSchema,
  publicSiteResolveServerSchema,
  publicMenuItemListEnvelopeSchema,
  publicSearchFilterListEnvelopeSchema,
} from "@/lib/validation/public-site";
export {
  realtimeEventSchema,
} from "@/lib/validation/realtime";
export {
  siteAssetInputSchema,
  siteSlugSchema,
  siteCustomDomainSchema,
  organizationSiteMutationSchema,
  siteMenuItemInputSchema,
  siteMenuItemUpdateSchema,
  siteSearchFilterInputSchema,
  siteSearchFilterUpdateSchema,
  siteReorderInputSchema,
  apiOrganizationSiteResponseSchema,
  apiOptionalOrganizationSiteResponseSchema,
  apiSiteMenuItemResponseSchema,
  apiSiteMenuItemListResponseSchema,
  apiSiteSearchFilterResponseSchema,
  apiSiteSearchFilterListResponseSchema,
  apiSiteAssetResponseSchema,
  apiDomainVerificationResponseSchema,
} from "@/lib/validation/organization-sites";
export {
  pageSpeedStrategySchema,
  pageSpeedResponseSchema,
} from "@/lib/validation/site-performance";
export {
  stageAutomationInputSchema,
  stageOperationalConfigInputSchema,
  pipelineSLAInputSchema,
  apiStageAutomationResponseSchema,
  apiStageAutomationListResponseSchema,
  apiStageOperationalResponseSchema,
  apiStageOperationalListResponseSchema,
  apiPipelineSLAResponseSchema,
  apiPipelineSLAListResponseSchema,
} from "@/lib/validation/pipelines";
export {
  errorSeveritySchema,
  errorSourceSchema,
  reportErrorEventInputSchema,
  errorEventFiltersSchema,
  apiErrorEventResponseSchema,
  apiErrorEventListResponseSchema,
} from "@/lib/validation/error-events";
export {
  apiUserSummaryListResponseSchema,
} from "@/lib/validation/users";
export {
  outgoingWebhookEventSchema,
  webhookCreateInputSchema,
  webhookUpdateInputSchema,
  publicAPIIdempotencyKeySchema,
  publicAPILeadInputSchema,
  apiWebhookResponseSchema,
  apiWebhookListResponseSchema,
} from "@/lib/validation/webhooks";
export {
  metaCampaignListSchema,
} from "@/lib/validation/integrations";
export {
  searchFilterColumnsSchema,
  searchFilterMaxLengthSchema,
} from "@/lib/validation/search-filters";
