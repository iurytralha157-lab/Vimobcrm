import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { integrationsAPI } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface MetaFormQuestion {
  key: string;
  label: string;
  type: string;
}

export interface MetaForm {
  id: string;
  name: string;
  status: string;
  leads_count?: number;
  questions?: MetaFormQuestion[];
}

export interface MetaFormConfig {
  id: string;
  organization_id: string;
  integration_id: string;
  form_id: string;
  form_name: string | null;
  pipeline_id: string | null;
  stage_id: string | null;
  default_status: string | null;
  assigned_user_id: string | null;
  round_robin_id?: string | null;
  property_id: string | null;
  purpose?: string | null;
  source?: string | null;
  source_details?: string | null;
  default_values?: Record<string, unknown>;
  created_by?: string | null;
  created_by_name?: string | null;
  auto_tags: string[];
  field_mapping: Record<string, string>;
  custom_fields_config: string[];
  is_active: boolean;
  leads_received: number;
  last_lead_at: string | null;
  created_at: string;
  updated_at: string;
}

type MetaFormConfigRecord = Omit<
  MetaFormConfig,
  "auto_tags" | "custom_fields_config" | "default_values" | "field_mapping"
> & {
  auto_tags?: unknown;
  custom_fields_config?: unknown;
  default_values?: unknown;
  field_mapping?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function normalizeMetaFormConfig(config: MetaFormConfigRecord): MetaFormConfig {
  return {
    ...config,
    auto_tags: isStringArray(config.auto_tags) ? config.auto_tags : [],
    field_mapping: isStringRecord(config.field_mapping) ? config.field_mapping : {},
    custom_fields_config: isStringArray(config.custom_fields_config) ? config.custom_fields_config : [],
    default_values: isRecord(config.default_values) ? config.default_values : {},
  };
}

export function useMetaFormConfigs(integrationId: string | undefined) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["meta-form-configs", integrationId],
    queryFn: async () => {
      if (!profile?.organization_id || !integrationId) return [];
      const configs = await integrationsAPI.listMetaFormConfigs(integrationId, profile.organization_id);
      return (configs as unknown as MetaFormConfigRecord[]).map(normalizeMetaFormConfig);
    },
    enabled: !!profile?.organization_id && !!integrationId,
  });
}

export function useAllMetaFormConfigs() {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["meta-form-configs", "all", profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const configs = await integrationsAPI.listMetaFormConfigs(undefined, profile.organization_id);
      return (configs as unknown as MetaFormConfigRecord[]).map(normalizeMetaFormConfig);
    },
    enabled: !!profile?.organization_id,
  });
}

export function useFetchPageForms() {
  return useMutation({
    mutationFn: ({ pageId }: { pageId: string }) =>
      integrationsAPI.invokeFunction<{ forms: MetaForm[] }>("meta-oauth", {
        action: "get_page_forms",
        page_id: pageId,
      }),
  });
}

export function useSaveFormConfig() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (config: {
      integrationId: string;
      formId: string;
      formName?: string;
      propertyId?: string;
      roundRobinId?: string | null;
      purpose?: string | null;
      source?: string | null;
      sourceDetails?: string | null;
      defaultValues?: Record<string, unknown>;
      autoTags?: string[];
      fieldMapping?: Record<string, string>;
      customFieldsConfig?: string[];
      isActive?: boolean;
    }) => {
      if (!profile?.organization_id) throw new Error("No organization");

      return integrationsAPI.saveMetaFormConfig({
        integrationId: config.integrationId,
        formId: config.formId,
        formName: config.formName,
        propertyId: config.propertyId || null,
        roundRobinId: config.roundRobinId || null,
        purpose: config.purpose || null,
        source: config.source || null,
        sourceDetails: config.sourceDetails || null,
        defaultValues: config.defaultValues || {},
        autoTags: config.autoTags || [],
        fieldMapping: config.fieldMapping || {},
        customFieldsConfig: config.customFieldsConfig || [],
        isActive: config.isActive !== false,
      }, profile.organization_id);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["meta-form-configs", variables.integrationId] });
      queryClient.invalidateQueries({ queryKey: ["meta-form-configs"] });
      queryClient.invalidateQueries({ queryKey: ["round-robin-rules"] });
      toast.success("Configuracao do formulario salva!");
    },
    onError: (error: Error) => {
      toast.error(`Erro ao salvar: ${error.message}`);
    },
  });
}

export function useToggleFormConfig() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: ({ formId, isActive, integrationId }: { formId: string; isActive: boolean; integrationId: string }) => {
      if (!profile?.organization_id) throw new Error("No organization");
      return integrationsAPI.toggleMetaFormConfig({ integrationId, formId, isActive }, profile.organization_id);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["meta-form-configs", variables.integrationId] });
      queryClient.invalidateQueries({ queryKey: ["meta-form-configs"] });
    },
    onError: (error: Error) => {
      toast.error(`Erro: ${error.message}`);
    },
  });
}

export function useDeleteFormConfig() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: ({ formId, integrationId }: { formId: string; integrationId: string }) => {
      if (!profile?.organization_id) throw new Error("No organization");
      return integrationsAPI.deleteMetaFormConfig({ integrationId, formId }, profile.organization_id);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["meta-form-configs", variables.integrationId] });
      queryClient.invalidateQueries({ queryKey: ["meta-form-configs"] });
      queryClient.invalidateQueries({ queryKey: ["round-robin-rules"] });
      toast.success("Configuracao removida!");
    },
    onError: (error: Error) => {
      toast.error(`Erro: ${error.message}`);
    },
  });
}
