import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadsAPI } from '@/lib/api/leads';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Tables, TablesUpdate } from '@/integrations/supabase/types';
import { enforceClientActionRateLimit, getClientRateLimitMessage } from '@/lib/client-action-rate-limit';
type LeadTag = Pick<Tables<'tags'>, 'id' | 'name' | 'color'>;
type CreateLeadInput = {
  name: string;
  phone?: string;
  email?: string;
  message?: string;
  source?: string;
  stage_id?: string;
  pipeline_id?: string;
  property_code?: string;
  property_id?: string;
  assigned_user_id?: string;
  tag_ids?: string[];
  conversation_id?: string;
  cargo?: string;
  empresa?: string;
  profissao?: string;
  endereco?: string;
  bairro?: string;
  numero?: string;
  cep?: string;
  cidade?: string;
  uf?: string;
  renda_familiar?: string;
  faixa_valor_imovel?: string;
  valor_interesse?: number | null;
  deal_status?: string;
  lost_reason?: string;
  is_own_resource?: boolean;
};
type CreateLeadResult = Lead & { reentry?: boolean; assignedUserName?: string };

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const getErrorCode = (error: unknown) => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code?: unknown }).code || '');
  }
  return '';
};

export type Lead = Tables<'leads'> & {
  tags?: LeadTag[];
  assignee?: { id: string; name: string; avatar_url: string | null };
  stage?: { id: string; name: string; color: string | null; stage_key: string | null };
};

const leadReadRelationKeys = new Set<keyof Lead>(['tags', 'assignee', 'stage']);

function toLeadUpdateInput(updates: Partial<Lead>): TablesUpdate<'leads'> {
  return Object.fromEntries(
    Object.entries(updates).filter(([key]) => !leadReadRelationKeys.has(key as keyof Lead))
  ) as TablesUpdate<'leads'>;
}

export function useLeads(filters?: {
  stageId?: string;
  assigneeId?: string;
  search?: string;
  limit?: number;
}) {
  const { user, profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || undefined;
  const limit = filters?.limit || 200;

  return useQuery({
    queryKey: ['leads', organizationId, filters],
    queryFn: async () => {
      if (!organizationId) return [] as Lead[];

      const { data, error } = await leadsAPI.getLeads(organizationId, {
        limit,
        stageId: filters?.stageId,
        assigneeId: filters?.assigneeId,
        search: filters?.search,
      });

      if (error) throw error;

      return (data || []) as Lead[];
    },
    enabled: !!user?.id && !!organizationId,
  });
}

export function useLead(id: string | null) {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || undefined;

  return useQuery({
    queryKey: ['lead', organizationId, id],
    queryFn: async () => {
      if (!id || !organizationId) return null;

      const { data, error } = await leadsAPI.getLead(id, organizationId);
      if (error) throw error;

      return data as Lead;
    },
    enabled: !!id && !!organizationId,
  });
}

export function useCreateLead() {
  const queryClient = useQueryClient();
  const { user, profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || undefined;

  return useMutation<CreateLeadResult, Error, CreateLeadInput>({
    mutationFn: async (lead) => {
      if (!user?.id) throw new Error('Usuario nao autenticado');
      if (!organizationId) throw new Error('Usuario nao possui organizacao');

      enforceClientActionRateLimit(`lead:create:${user.id}`, [
        { limit: 1, windowMs: 1000 },
        { limit: 10, windowMs: 60_000 },
      ]);

      const { data, error, reentry, assignedUserName } = await leadsAPI.createLead(organizationId, {
        ...lead,
        source: lead.source || 'manual',
      });

      if (error) throw error;
      if (!data) {
        throw new Error('API nao retornou o lead criado');
      }

      return { ...data, reentry, assignedUserName };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      if (data?.id) {
        queryClient.invalidateQueries({ queryKey: ['lead', data.id] });
        queryClient.invalidateQueries({ queryKey: ['lead-history-v2', data.id] });
      }
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
      if (data?.reentry) {
        toast.success(`Lead ja existia e foi atualizado. Responsavel atual: ${data.assignedUserName || 'sem responsavel'}`);
      } else {
        toast.success('Lead criado com sucesso!');
      }
    },
    onError: (error) => {
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      toast.error('Erro ao criar lead: ' + error.message);
    },
  });
}

export function useUpdateLead() {
  const queryClient = useQueryClient();
  const { user, profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || undefined;

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Lead> & { id: string }) => {
      if (!user?.id) throw new Error('Usuario nao autenticado');
      if (!organizationId) throw new Error('Usuario nao possui organizacao');

      enforceClientActionRateLimit(`lead:update:${user.id}:${id}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 30, windowMs: 60_000 },
      ]);

      const updateData = toLeadUpdateInput(updates);

      const { data, error } = await leadsAPI.updateLead(id, updateData, organizationId);
      if (error) throw error;
      if (!data) {
        throw new Error('Nenhuma alteração foi gravada. Verifique se você tem permissão para editar este lead.');
      }

      return data;
    },
    onSuccess: (data) => {
      // Sincronização cirúrgica: apenas o necessário
      if (data?.id) {
        queryClient.invalidateQueries({ queryKey: ['lead', data.id] });
        queryClient.invalidateQueries({ queryKey: ['lead-history-v2', data.id] });
      }

      // Invalida listas apenas para refletir as mudanças (usa refetch em background)
      queryClient.invalidateQueries({ queryKey: ['leads'], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['activities'], refetchType: 'none' });
    },
    onError: (error) => {
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      toast.error('Erro ao atualizar lead: ' + error.message);
    },
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();
  const { user, profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || undefined;

  return useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('Usuario nao autenticado');
      if (!organizationId) throw new Error('Usuario nao possui organizacao');

      enforceClientActionRateLimit(`lead:delete:${user.id}:${id}`, [
        { limit: 1, windowMs: 1000 },
        { limit: 10, windowMs: 60_000 },
      ]);

      const { error } = await leadsAPI.deleteLead(id, organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['contacts-list'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'] });
      toast.success('Contato excluído!');
    },
    onError: (error) => {
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      toast.error('Erro ao excluir lead: ' + error.message);
    },
  });
}

export function useAddLeadTag() {
  const queryClient = useQueryClient();
  const { user, profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || undefined;

  return useMutation({
    mutationFn: async ({ leadId, tagId }: { leadId: string; tagId: string }) => {
      if (!user?.id) throw new Error('Usuario nao autenticado');
      if (!organizationId) throw new Error('Usuario nao possui organizacao');

      enforceClientActionRateLimit(`lead:tag:add:${user.id}:${leadId}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 20, windowMs: 60_000 },
      ]);

      // Verificar se a tag já está associada ao lead
      const { error } = await leadsAPI.addLeadTag(leadId, tagId, organizationId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['conversation-lead-detail'] });
      queryClient.invalidateQueries({ queryKey: ['lead-history-v2', variables.leadId] });
      toast.success('Tag adicionada!');
    },
    onError: (error: unknown) => {
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      const message = getErrorMessage(error);
      if (getErrorCode(error) === 'tag_already_exists' || message === 'TAG_ALREADY_EXISTS' || message.includes('unique constraint')) {
        toast.info('Esta tag já está adicionada ao lead');
      } else {
        toast.error('Erro ao adicionar tag: ' + message);
      }
    },
  });
}

export function useRemoveLeadTag() {
  const queryClient = useQueryClient();
  const { user, profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || undefined;

  return useMutation({
    mutationFn: async ({ leadId, tagId }: { leadId: string; tagId: string }) => {
      if (!user?.id) throw new Error('Usuario nao autenticado');
      if (!organizationId) throw new Error('Usuario nao possui organizacao');

      enforceClientActionRateLimit(`lead:tag:remove:${user.id}:${leadId}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 20, windowMs: 60_000 },
      ]);

      const { error } = await leadsAPI.removeLeadTag(leadId, tagId, organizationId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead'] });
      queryClient.invalidateQueries({ queryKey: ['stages'] });
      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['conversation-lead-detail'] });
      queryClient.invalidateQueries({ queryKey: ['lead-history-v2', variables.leadId] });
      toast.success('Tag removida!');
    },
    onError: (error) => {
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) {
        toast.error(rateLimitMessage);
        return;
      }
      toast.error('Erro ao remover tag: ' + error.message);
    },
  });
}
