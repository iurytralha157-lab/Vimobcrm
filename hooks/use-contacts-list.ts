import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { contactsAPI } from '@/lib/api/contacts';

export interface ContactListFilters {
  search?: string;
  teamId?: string;
  pipelineId?: string;
  stageId?: string;
  assigneeId?: string;
  unassigned?: boolean;
  tagId?: string;
  source?: string;
  campaignId?: string;
  adSetId?: string;
  adId?: string;
  dealStatus?: 'open' | 'won' | 'lost';
  createdFrom?: string;
  createdTo?: string;
  sortBy?: 'created_at' | 'name' | 'last_interaction_at' | 'stage';
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface ContactTag {
  id: string;
  name: string;
  color: string;
}

export interface Contact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  whatsapp_avatar_url: string | null;
  pipeline_id: string | null;
  pipeline_name: string | null;
  stage_id: string | null;
  stage_name: string | null;
  stage_color: string | null;
  assigned_user_id: string | null;
  assignee_name: string | null;
  assignee_avatar: string | null;
  source: string;
  created_at: string;
  sla_status: string | null;
  last_interaction_at: string | null;
  last_interaction_preview: string | null;
  last_interaction_channel: string | null;
  tags: ContactTag[];
  total_count: number;
  deal_status: 'open' | 'won' | 'lost' | null;
  lost_reason: string | null;
  last_entry_at: string | null;
  reentry_count: number;
}

export function useContactsList(filters: ContactListFilters) {
  return useQuery({
    queryKey: ['contacts-list', filters],
    queryFn: () => contactsAPI.list(filters),
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5, // Cache por 5 minutos
    gcTime: 1000 * 60 * 15,
  });
}
