import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  messageTemplatesAPI,
  type CreateTemplateInput,
  type MessageTemplate,
  type UpdateTemplateInput,
} from '@/lib/api/message-templates';

export type { CreateTemplateInput, MessageTemplate } from '@/lib/api/message-templates';

export interface TemplateVariables {
  nome?: string;
  corretor?: string;
  imobiliaria?: string;
  data?: string;
  horario?: string;
  empreendimento?: string;
  [key: string]: string | undefined;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Erro desconhecido';
}

export function replaceTemplateVariables(content: string, variables: TemplateVariables): string {
  let result = content;

  Object.entries(variables).forEach(([key, value]) => {
    if (value) {
      const regex = new RegExp(`\\{${key}\\}`, 'gi');
      result = result.replace(regex, value);
    }
  });

  return result;
}

export function extractTemplateVariables(content: string): string[] {
  const regex = /\{(\w+)\}/g;
  const matches = content.matchAll(regex);
  const variables = new Set<string>();

  for (const match of matches) {
    variables.add(match[1].toLowerCase());
  }

  return Array.from(variables);
}

function useActiveOrganizationId() {
  const { profile, organization } = useAuth();
  return organization?.id || profile?.organization_id || undefined;
}

export function useMessageTemplates() {
  const organizationId = useActiveOrganizationId();

  return useQuery({
    queryKey: ['message-templates', organizationId],
    queryFn: async () => messageTemplatesAPI.list(organizationId),
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useMessageTemplatesByCategory() {
  const { data: templates, ...rest } = useMessageTemplates();

  const groupedTemplates = templates?.reduce((acc, template) => {
    const category = template.category || 'geral';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(template);
    return acc;
  }, {} as Record<string, MessageTemplate[]>) || {};

  return { data: groupedTemplates, ...rest };
}

export function useCreateMessageTemplate() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: async (input: CreateTemplateInput) => {
      if (!organizationId) {
        throw new Error('Organizacao nao encontrada');
      }

      return messageTemplatesAPI.create({
        name: input.name,
        content: input.content,
        category: input.category || 'geral',
        variables: extractTemplateVariables(input.content),
      }, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['message-templates'] });
      toast.success('Template criado com sucesso!');
    },
    onError: (error: unknown) => {
      toast.error('Erro ao criar template: ' + getErrorMessage(error));
    },
  });
}

export function useUpdateMessageTemplate() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: async ({ id, ...input }: Partial<CreateTemplateInput> & { id: string }) => {
      if (!organizationId) {
        throw new Error('Organizacao nao encontrada');
      }

      const updateInput: UpdateTemplateInput = {
        name: input.name,
        content: input.content,
        category: input.category,
      };

      return messageTemplatesAPI.update(id, updateInput, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['message-templates'] });
      toast.success('Template atualizado!');
    },
    onError: (error: unknown) => {
      toast.error('Erro ao atualizar: ' + getErrorMessage(error));
    },
  });
}

export function useDeleteMessageTemplate() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) {
        throw new Error('Organizacao nao encontrada');
      }

      await messageTemplatesAPI.remove(id, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['message-templates'] });
      toast.success('Template excluido!');
    },
    onError: (error: unknown) => {
      toast.error('Erro ao excluir: ' + getErrorMessage(error));
    },
  });
}

export const TEMPLATE_CATEGORIES: Record<string, string> = {
  saudacao: 'Saudacao',
  follow_up: 'Follow-up',
  agendamento: 'Agendamento',
  pos_visita: 'Pos-visita',
  negociacao: 'Negociacao',
  geral: 'Geral',
};
