import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { contactsAPI } from '@/lib/api/contacts';
import { useAuth } from '@/contexts/AuthContext';

const CONTACTS_STALE_TIME_MS = 1000 * 60 * 10;
const CONTACTS_CACHE_TIME_MS = 1000 * 60 * 60;

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
  mode?: 'compact' | 'full';
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
  whatsapp: string | null;
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
  source_detail: string | null;
  source_session_id: string | null;
  source_webhook_id: string | null;
  visitor_session_id: string | null;
  status: string;
  priority: string | null;
  message: string | null;
  initial_message: string | null;
  property_code: string | null;
  property_id: string | null;
  interest_property_id: string | null;
  interest_plan_id: string | null;
  created_at: string;
  updated_at: string;
  sla_status: string | null;
  last_interaction_at: string | null;
  last_interaction_preview: string | null;
  last_interaction_channel: string | null;
  tags: ContactTag[];
  total_count: number;
  deal_status: 'open' | 'won' | 'lost' | null;
  lost_reason: string | null;
  feedback: string | null;
  valor_interesse: string | null;
  commission_percentage: string | null;
  faixa_valor_imovel: string | null;
  renda_familiar: string | null;
  finalidade_compra: string | null;
  procura_financiamento: boolean | null;
  trabalha: boolean | null;
  cargo: string | null;
  empresa: string | null;
  profissao: string | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  is_own_resource: boolean | null;
  first_touch_at: string | null;
  first_touch_seconds: number | null;
  first_touch_channel: string | null;
  first_touch_actor_user_id: string | null;
  first_response_at: string | null;
  first_response_seconds: number | null;
  first_response_channel: string | null;
  first_response_is_automation: boolean | null;
  first_response_actor_user_id: string | null;
  stage_entered_at: string | null;
  last_entry_at: string | null;
  reentry_count: number;
  redistribution_count: number;
  last_contact_at: string | null;
  next_follow_up_at: string | null;
  won_at: string | null;
  lost_at: string | null;
  created_by: string | null;
  metadata_json: string | null;
  meta_lead_id: string | null;
  meta_form_id: string | null;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_ad_id: string | null;
  meta_click_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  form_id: string | null;
  form_name: string | null;
  platform: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  creative_url: string | null;
  creative_video_url: string | null;
  creative_instagram_url: string | null;
  meta_payload_json: string | null;
  meta_raw_payload_json: string | null;
}

export function useContactsList(filters: ContactListFilters) {
  const { organization, profile, user } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id ?? null;

  return useQuery({
    queryKey: ['contacts-list', organizationId, user?.id, filters],
    queryFn: () => contactsAPI.list(filters, organizationId),
    enabled: !!user?.id && !!organizationId,
    placeholderData: keepPreviousData,
    staleTime: CONTACTS_STALE_TIME_MS,
    gcTime: CONTACTS_CACHE_TIME_MS,
    refetchOnMount: true,
  });
}
