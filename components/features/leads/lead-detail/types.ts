import type { Lead } from '@/hooks/use-leads';
import type { LeadMeta } from '@/hooks/use-lead-meta';
import type { PipelineLead } from '@/hooks/use-stages';
import type { Tag } from '@/hooks/use-tags';
import type { User as AppUser } from '@/hooks/use-users';

export type LeadDetailStage = {
  id: string;
  name: string;
  color?: string | null;
  stage_key?: string | null;
  pipeline_id?: string | null;
  position?: number | null;
  is_won?: boolean | null;
  is_lost?: boolean | null;
  is_active?: boolean | null;
};

export type CadenceTaskType = 'call' | 'message' | 'email' | 'note';

export type LeadDetailTag = {
  id?: string;
  name?: string | null;
  color?: string | null;
};

export type RenderableLeadTag = LeadDetailTag & { id: string };

export type LeadDetailAssignee = {
  id: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

export type LeadDetailLead = Omit<PipelineLead, 'stage' | 'assignee' | 'tags'> &
  Omit<Partial<Lead>, 'stage' | 'assignee' | 'tags'> & {
    whatsapp_picture?: string | null;
    whatsapp_avatar_url?: string | null;
    contact_picture?: string | null;
    assignee?: LeadDetailAssignee | null;
    property?: {
      id?: string;
      code?: string | null;
      title?: string | null;
      preco?: number | null;
    } | null;
    interest_property?: {
      id?: string;
      code?: string | null;
      title?: string | null;
      preco?: number | null;
    } | null;
    stage?: LeadDetailStage | null;
    tags?: LeadDetailTag[];
  };

export type CampaignTrackingDetails = Omit<Partial<LeadMeta>, 'lead_id' | 'created_at'> & {
  lead_id?: string | null;
  created_at?: string | null;
  page_name?: string | null;
  leadgen_id?: string | null;
  creative_link_url?: string | null;
};

export type SelectableLeadProperty = {
  id: string;
  title?: string | null;
  code?: string | null;
  codigo?: string | null;
  reference?: string | null;
  preco?: number | null;
  commission_percentage?: number | null;
};

export type PipelineCacheStage = LeadDetailStage & {
  leads: LeadDetailLead[];
  total_lead_count: number;
  total_value?: number;
  has_more: boolean;
};

export type ReopenStatusConfirmation = {
  leadId: string;
  leadName: string;
  fromStatus: 'won' | 'lost' | string;
};

export type AssigneeScheduleConfirmation = {
  leadId: string;
  userId: string;
  userName: string;
  description: string;
};

export type LeadDetailDialogProps = {
  lead: LeadDetailLead | null;
  stages: LeadDetailStage[];
  onClose: () => void;
  onEdit?: (lead: LeadDetailLead) => void;
  allTags: Tag[];
  allUsers: AppUser[];
};
