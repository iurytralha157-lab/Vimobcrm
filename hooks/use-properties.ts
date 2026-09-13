import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalActiveOrganizationId as useOrganizationId } from "@/hooks/use-active-organization";
import {
  propertiesAPI,
  type PropertyHistoryEvent,
  type PropertyRecord,
  type PropertyUpdateInput as PropertyAPIUpdateInput,
  type PropertyWithCapabilities,
} from "@/lib/api/properties";
import { stringifyErrorMessage as getErrorMessage } from "@/lib/api/vimob-error";
import {
  enforceClientActionRateLimit,
  getClientRateLimitMessage,
} from "@/lib/client-action-rate-limit";
import {
  parseDomainInput,
  parseNumericFilter,
  propertyCreateInputSchema,
  propertyUpdateInputSchema,
} from "@/lib/validation";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import {
  isPropertyWorkspaceConflict,
  propertyConflictQueryKeys,
  PROPERTY_WORKSPACE_CONFLICT_MESSAGE,
} from "@/lib/property-concurrency";

export type Property = PropertyWithCapabilities;
const EMPTY_PROPERTIES: Property[] = [];

type PropertyMutationInput = Omit<
  Partial<PropertyRecord>,
  "id" | "code" | "organization_id" | "created_at" | "updated_at"
> & {
  metadata?: Record<string, unknown>;
};
type PropertyUpdateInput = PropertyAPIUpdateInput & {
  id: string;
  expected_updated_at: string;
};
type PropertyDeleteInput = {
  id: string;
  expected_updated_at: string;
};

export interface PropertyFilters {
  scope?: "own";
  status?: string;
  tipo_de_negocio?: string;
  tipo_de_imovel?: string;
  cidade?: string;
  bairro?: string;
  responsavel_id?: string;
  quartos_min?: string;
  suites_min?: string;
  banheiros_min?: string;
  valor_min?: string;
  valor_max?: string;
  aceita_permuta?: string;
  aceita_financiamento?: string;
  published_on_site?: string;
  owner_id?: string;
  condominium_id?: string;
  mobilia?: string;
  exclusividade?: string;
  placa_no_local?: string;
  destaque?: string;
  vagas_min?: string;
  area_util_min?: string;
  area_util_max?: string;
  area_total_min?: string;
  area_total_max?: string;
}

const sanitizeSearchTerm = (value?: string) => value?.trim() || undefined;

async function refreshPropertyAfterConflict(
  queryClient: QueryClient,
  organizationId: string | undefined,
  propertyId: string,
) {
  await Promise.all(
    propertyConflictQueryKeys(organizationId, propertyId).map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}

function normalizeFilters(filters: PropertyFilters = {}) {
  return {
    scope: filters.scope,
    status: filters.status || undefined,
    tipo_de_negocio: filters.tipo_de_negocio || undefined,
    tipo_de_imovel: filters.tipo_de_imovel || undefined,
    cidade: sanitizeSearchTerm(filters.cidade),
    bairro: sanitizeSearchTerm(filters.bairro),
    responsavel_id: filters.responsavel_id || undefined,
    quartos_min: parseNumericFilter(filters.quartos_min),
    suites_min: parseNumericFilter(filters.suites_min),
    banheiros_min: parseNumericFilter(filters.banheiros_min),
    valor_min: parseNumericFilter(filters.valor_min),
    valor_max: parseNumericFilter(filters.valor_max),
    aceita_permuta:
      filters.aceita_permuta === "true"
        ? true
        : filters.aceita_permuta === "false"
          ? false
          : undefined,
    aceita_financiamento:
      filters.aceita_financiamento === "true"
        ? true
        : filters.aceita_financiamento === "false"
          ? false
          : undefined,
    published_on_site:
      filters.published_on_site === "true"
        ? true
        : filters.published_on_site === "false"
          ? false
          : undefined,
    owner_id: filters.owner_id || undefined,
    condominium_id: filters.condominium_id || undefined,
    mobilia: filters.mobilia || undefined,
    exclusividade:
      filters.exclusividade === "true"
        ? true
        : filters.exclusividade === "false"
          ? false
          : undefined,
    placa_no_local:
      filters.placa_no_local === "true"
        ? true
        : filters.placa_no_local === "false"
          ? false
          : undefined,
    destaque:
      filters.destaque === "true"
        ? true
        : filters.destaque === "false"
          ? false
          : undefined,
    vagas_min: parseNumericFilter(filters.vagas_min),
    area_util_min: parseNumericFilter(filters.area_util_min),
    area_util_max: parseNumericFilter(filters.area_util_max),
    area_total_min: parseNumericFilter(filters.area_total_min),
    area_total_max: parseNumericFilter(filters.area_total_max),
  };
}

export function useProperties(
  search?: string,
  filters: Pick<PropertyFilters, "scope"> = {},
  options: { enabled?: boolean; limit?: number } = {},
) {
  const { user } = useAuth();
  const organizationId = useOrganizationId();
  const { hasModule } = useOrganizationModules();
  const hasPropertiesModule = hasModule("properties");
  const normalizedSearch = sanitizeSearchTerm(search);
  const normalizedFilters = normalizeFilters(filters);
  const limit = options.limit ?? 1000;

  return useQuery({
    queryKey: [
      "properties",
      organizationId,
      normalizedSearch,
      normalizedFilters,
      limit,
    ],
    queryFn: async () => {
      if (!organizationId || !hasPropertiesModule) return EMPTY_PROPERTIES;

      const { data, error } = await propertiesAPI.getProperties(
        organizationId,
        {
          search: normalizedSearch,
          limit,
          ...normalizedFilters,
        },
      );

      if (error) throw error;
      return data;
    },
    enabled:
      !!user?.id &&
      !!organizationId &&
      hasPropertiesModule &&
      options.enabled !== false,
    select: (data) => (hasPropertiesModule ? data : EMPTY_PROPERTIES),
    placeholderData: hasPropertiesModule ? keepPreviousData : EMPTY_PROPERTIES,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });
}

export function useInfiniteProperties(
  search?: string,
  pageSize: number = 24,
  filters: PropertyFilters = {},
  options: { enabled?: boolean } = {},
) {
  const { user } = useAuth();
  const organizationId = useOrganizationId();
  const normalizedSearch = sanitizeSearchTerm(search);
  const normalizedFilters = normalizeFilters(filters);

  return useInfiniteQuery({
    queryKey: [
      "properties-infinite",
      organizationId,
      normalizedSearch,
      pageSize,
      normalizedFilters,
    ],
    queryFn: async ({ pageParam = 0 }) => {
      if (!organizationId) {
        return {
          properties: [] as Property[],
          nextPage: undefined,
          totalCount: 0,
        };
      }

      const { data, count, error } = await propertiesAPI.getProperties(
        organizationId,
        {
          limit: pageSize,
          offset: pageParam * pageSize,
          search: normalizedSearch,
          ...normalizedFilters,
        },
      );

      if (error) throw error;

      return {
        properties: data,
        nextPage:
          (pageParam + 1) * pageSize < (count || 0) ? pageParam + 1 : undefined,
        totalCount: count || 0,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 30,
    enabled: !!user?.id && !!organizationId && options.enabled !== false,
  });
}

export function useProperty(id: string | null) {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: ["property", organizationId, id],
    queryFn: async () => {
      if (!id || !organizationId) return null;

      const { data, error } = await propertiesAPI.getProperty(
        id,
        organizationId,
      );
      if (error) throw error;

      return data;
    },
    enabled: !!id && !!organizationId,
    staleTime: 0,
  });
}

export function usePropertyHistory(
  id: string | null,
  options: { enabled?: boolean } = {},
) {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: ["property-history", organizationId, id],
    queryFn: async () => {
      if (!id || !organizationId) return [] as PropertyHistoryEvent[];

      const { data, error } = await propertiesAPI.getPropertyHistory(
        id,
        organizationId,
      );
      if (error) throw error;

      return data;
    },
    enabled: !!id && !!organizationId && options.enabled !== false,
    staleTime: 1000 * 30,
  });
}

export function useCreateProperty(
  options: { showSuccessToast?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const organizationId = useOrganizationId();

  return useMutation({
    mutationFn: async (propertyInput: PropertyMutationInput) => {
      if (!user?.id) throw new Error("Usuário não autenticado");
      if (!organizationId) throw new Error("Usuário não possui organização");

      enforceClientActionRateLimit(`property:create:${user.id}`, [
        { limit: 1, windowMs: 1000 },
        { limit: 10, windowMs: 60_000 },
      ]);

      const createInput = parseDomainInput(
        propertyCreateInputSchema,
        {
          ...propertyInput,
          cadastrado_por: propertyInput.cadastrado_por || user.id,
        },
        "properties.create",
      );
      const { data, error } = await propertiesAPI.createProperty(
        organizationId,
        createInput,
      );

      if (error) throw error;
      if (!data)
        throw new Error(
          "Não foi possível concluir o cadastro do imóvel. Tente novamente.",
        );

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      queryClient.invalidateQueries({ queryKey: ["properties-infinite"] });
      if (options.showSuccessToast !== false) {
        toast.success("Imóvel cadastrado com sucesso!");
      }
    },
    onError: (error) => {
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      toast.error("Erro ao cadastrar imóvel: " + getErrorMessage(error));
    },
  });
}

export function useUpdateProperty() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const organizationId = useOrganizationId();

  return useMutation({
    mutationFn: async ({ id, ...updates }: PropertyUpdateInput) => {
      if (!user?.id) throw new Error("Usuário não autenticado");
      if (!organizationId) throw new Error("Usuário não possui organização");

      enforceClientActionRateLimit(`property:update:${user.id}:${id}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 30, windowMs: 60_000 },
      ]);

      const updateInput = parseDomainInput(
        propertyUpdateInputSchema,
        updates,
        "properties.update",
      );
      const { data, error } = await propertiesAPI.updateProperty(
        id,
        updateInput,
        organizationId,
      );

      if (error) throw error;
      if (!data)
        throw new Error(
          "Nenhuma alteração foi gravada. Verifique sua permissão para editar este imóvel.",
        );

      return data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      queryClient.invalidateQueries({ queryKey: ["properties-infinite"] });
      queryClient.invalidateQueries({
        queryKey: ["property", organizationId, variables.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["property-history", organizationId, variables.id],
      });
      if (data?.id) {
        queryClient.invalidateQueries({
          queryKey: ["property", organizationId, data.id],
        });
        if (data.id !== variables.id) {
          queryClient.invalidateQueries({
            queryKey: ["property-history", organizationId, data.id],
          });
        }
      }
      toast.success("Imóvel atualizado!");
    },
    onError: async (error, variables) => {
      if (isPropertyWorkspaceConflict(error)) {
        await refreshPropertyAfterConflict(
          queryClient,
          organizationId,
          variables.id,
        );
        toast.error(PROPERTY_WORKSPACE_CONFLICT_MESSAGE);
        return;
      }
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      toast.error("Erro ao atualizar imóvel: " + getErrorMessage(error));
    },
  });
}

export function useDeleteProperty() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const organizationId = useOrganizationId();

  return useMutation({
    mutationFn: async ({ id, expected_updated_at }: PropertyDeleteInput) => {
      if (!user?.id) throw new Error("Usuário não autenticado");
      if (!organizationId) throw new Error("Usuário não possui organização");

      enforceClientActionRateLimit(`property:delete:${user.id}:${id}`, [
        { limit: 1, windowMs: 1000 },
        { limit: 10, windowMs: 60_000 },
      ]);

      const { error } = await propertiesAPI.deleteProperty(
        id,
        expected_updated_at,
        organizationId,
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      queryClient.invalidateQueries({ queryKey: ["properties-infinite"] });
      toast.success("Imóvel excluído!");
    },
    onError: async (error, variables) => {
      if (isPropertyWorkspaceConflict(error)) {
        await refreshPropertyAfterConflict(
          queryClient,
          organizationId,
          variables.id,
        );
        toast.error(PROPERTY_WORKSPACE_CONFLICT_MESSAGE);
        return;
      }
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      toast.error("Erro ao excluir imóvel: " + getErrorMessage(error));
    },
  });
}
