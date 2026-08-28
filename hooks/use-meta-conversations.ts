import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { integrationsAPI } from "@/lib/api/integrations";

export interface MetaConversation {
  id: string;
  organization_id: string;
  lead_id: string | null;
  external_id: string;
  platform: 'instagram' | 'messenger';
  contact_name: string | null;
  contact_picture: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  lead?: {
    id: string;
    name: string;
  };
}

export interface MetaMessage {
  id: string;
  conversation_id: string;
  external_id: string | null;
  content: string | null;
  message_type: string;
  from_me: boolean;
  status: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  sent_at: string | null;
  created_at: string;
  client_request_id?: string | null;
  provider_attempted_at?: string | null;
  completed_at?: string | null;
  delivery_error_code?: string | null;
  idempotent_replay?: boolean;
}

export function useMetaConversations(pageId?: string, options: { enabled?: boolean } = {}) {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id ?? null;

  return useQuery({
    queryKey: ["meta-conversations", organizationId, pageId],
    queryFn: async () => {
      if (!organizationId) return [];

      return integrationsAPI.listMetaConversations<MetaConversation>(pageId, organizationId);
    },
    enabled: options.enabled !== false && !!organizationId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useMetaMessages(conversationId: string | null, options: { enabled?: boolean } = {}) {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id ?? null;

  return useQuery({
    queryKey: ["meta-messages", organizationId, conversationId],
    queryFn: async () => {
      if (!conversationId || !organizationId) return [];

      return integrationsAPI.listMetaMessages<MetaMessage>(conversationId, organizationId);
    },
    enabled: options.enabled !== false && !!conversationId && !!organizationId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useSendMetaMessage() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id ?? null;

  return useMutation({
    mutationFn: async ({
      conversationId,
      text,
      platform,
      recipientExternalId,
      idempotencyKey,
    }: {
      conversationId: string;
      text: string;
      platform: 'instagram' | 'messenger';
      recipientExternalId: string;
      idempotencyKey: string;
    }) => {
      if (!organizationId) throw new Error("Organização ativa não encontrada");
      // Platform and recipient are intentionally resolved again by the Go API
      // from the tenant-scoped conversation. They are retained in this hook's
      // input only for compatibility with the existing UI contract.
      void platform;
      void recipientExternalId;
      return integrationsAPI.sendMetaMessage<MetaMessage>(
        conversationId,
        { text, idempotencyKey },
        organizationId,
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["meta-messages", organizationId, variables.conversationId] });
      queryClient.invalidateQueries({ queryKey: ["meta-conversations", organizationId] });
    },
    retry: 2,
  });
}
