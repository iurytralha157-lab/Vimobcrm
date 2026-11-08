import { z } from "zod";

import { validateDomainResponse } from "@/lib/validation";
import { vimobAPIRequest } from "./vimob-client";

const SYNC_TIMEOUT_MS = 150_000;

const assetSchema = z
  .object({
    id: z.string(),
    type: z.enum(["ad_account", "page", "instagram_account"]),
    external_id: z.string(),
    name: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    is_selected: z.boolean(),
  })
  .passthrough();

const connectionSchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    external_user_name: z.string(),
    status: z.string(),
    granted_scopes: z.array(z.string()),
    missing_scopes: z.array(z.string()),
    token_expires_at: z.string().nullable(),
    last_validated_at: z.string().nullable(),
    last_error: z.string(),
    created_at: z.string(),
    assets: z.array(assetSchema),
  })
  .passthrough();

const listSchema = z
  .object({
    enabled: z.boolean(),
    meta_configured: z.boolean(),
    connections: z.array(connectionSchema),
  })
  .passthrough();

const startSchema = z.object({ auth_url: z.string().url() }).passthrough();

const syncSchema = z
  .object({
    success: z.boolean(),
    synced: z.number(),
    media_synced: z.number(),
    social_synced: z.number(),
    errors: z.array(z.string()).nullable(),
  })
  .passthrough();

export type MarketingConnection = z.infer<typeof connectionSchema>;
export type MarketingConnectionAsset = z.infer<typeof assetSchema>;
export type MarketingConnectionSyncResult = z.infer<typeof syncSchema>;

export const marketingConnectionsAPI = {
  async list(organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>("/v1/marketing/connections", { organizationId });
    return validateDomainResponse(listSchema, response, "marketing.connections.list");
  },

  async startMeta(returnUrl: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>("/v1/marketing/connections/meta/start", {
      method: "POST",
      organizationId,
      body: { return_url: returnUrl },
    });
    return validateDomainResponse(startSchema, response, "marketing.connections.start");
  },

  async updateAssets(connectionId: string, selectedAssetIds: string[], organizationId?: string | null) {
    await vimobAPIRequest<unknown>(`/v1/marketing/connections/${encodeURIComponent(connectionId)}/assets`, {
      method: "PUT",
      organizationId,
      body: { selected_asset_ids: selectedAssetIds },
    });
  },

  async sync(connectionId: string, dateStart: string, dateStop: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>(`/v1/marketing/connections/${encodeURIComponent(connectionId)}/sync`, {
      method: "POST",
      organizationId,
      body: { date_start: dateStart, date_stop: dateStop },
      timeoutMs: SYNC_TIMEOUT_MS,
    });
    return validateDomainResponse(syncSchema, response, "marketing.connections.sync");
  },

  async disconnect(connectionId: string, organizationId?: string | null) {
    await vimobAPIRequest<unknown>(`/v1/marketing/connections/${encodeURIComponent(connectionId)}`, {
      method: "DELETE",
      organizationId,
    });
  },
};
