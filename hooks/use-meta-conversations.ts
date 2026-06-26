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
  external_id: string;
  content: string | null;
  message_type: string;
  from_me: boolean;
  status: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  sent_at: string;
  created_at: string;
}

export function useMetaConversations(pageId?: string) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["meta-conversations", pageId],
    queryFn: async () => {
      if (!profile?.organization_id) return [];

      return integrationsAPI.listMetaConversations<MetaConversation>(pageId, profile.organization_id);
    },
    enabled: !!profile?.organization_id,
  });
}

export function useMetaMessages(conversationId: string | null) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["meta-messages", conversationId],
    queryFn: async () => {
      if (!conversationId) return [];

      return integrationsAPI.listMetaMessages<MetaMessage>(conversationId, profile?.organization_id);
    },
    enabled: !!conversationId,
  });
}

export function useSendMetaMessage() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({
      conversationId,
      text,
      platform,
      recipientExternalId
    }: {
      conversationId: string;
      text: string;
      platform: 'instagram' | 'messenger';
      recipientExternalId: string;
    }) => {
      return integrationsAPI.invokeFunction("meta-messenger-proxy", {
        action: "sendMessage",
        platform,
        recipientId: recipientExternalId,
        text,
        conversationId
      }, profile?.organization_id);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["meta-messages", variables.conversationId] });
    }
  });
}
