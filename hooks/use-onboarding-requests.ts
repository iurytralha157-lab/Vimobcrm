import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { adminAPI, type AdminJSON } from '@/lib/api/admin';

export interface OnboardingRequestData {
  company_name: string;
  cnpj?: string;
  company_address?: string;
  company_city?: string;
  company_neighborhood?: string;
  company_number?: string;
  company_complement?: string;
  company_phone?: string;
  company_whatsapp?: string;
  company_email?: string;
  segment?: string;
  responsible_name: string;
  responsible_email: string;
  responsible_cpf?: string;
  responsible_phone?: string;
  logo_url?: string;
  favicon_url?: string;
  primary_color?: string;
  secondary_color?: string;
  site_title?: string;
  custom_domain?: string;
  site_seo_description?: string;
  about_text?: string;
  banner_url?: string;
  banner_title?: string;
  instagram?: string;
  facebook?: string;
  youtube?: string;
  linkedin?: string;
  team_size?: string;
  selected_plan_id?: string | null;
  confirmed_value?: number | null;
  billing_cycle?: string | null;
  privacy_policy_accepted?: boolean;
  terms_accepted?: boolean;
  privacy_policy_version?: string | null;
  terms_version?: string | null;
  legal_accepted_at?: string | null;
  onboarding_completed_at?: string | null;
  creci?: string;
}

export interface OnboardingRequest extends OnboardingRequestData {
  id: string;
  user_id: string;
  status: string;
  admin_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

type OnboardingRequestUpdate = Partial<Pick<
  OnboardingRequest,
  'status' | 'admin_notes' | 'reviewed_at' | 'selected_plan_id' | 'confirmed_value' | 'billing_cycle'
>>;

interface ActiveSubscriptionPlan {
  id: string;
  name: string;
  price: number;
  billing_cycle: string | null;
  description: string | null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Check if current user has a pending onboarding request
export function useMyOnboardingRequest() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-onboarding-request', user?.id],
    queryFn: async () => {
      if (!user) return null;
      return adminAPI.myOnboardingRequest<OnboardingRequest | null>();
    },
    enabled: !!user,
  });
}

// Submit onboarding request
export function useSubmitOnboardingRequest() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: OnboardingRequestData) => {
      if (!user) throw new Error('Usuário não autenticado');
      await adminAPI.createOnboardingRequest(data as unknown as AdminJSON);
    },
    onSuccess: () => {
      toast.success('Solicitação enviada com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['my-onboarding-request'] });
    },
    onError: (error: unknown) => {
      toast.error('Erro ao enviar solicitação: ' + getErrorMessage(error));
    },
  });
}

// Admin: list all onboarding requests
export function useAllOnboardingRequests() {
  return useQuery({
    queryKey: ['admin-onboarding-requests'],
    queryFn: async () => {
      return adminAPI.listOnboardingRequestsAdmin<OnboardingRequest>();
    },
  });
}

// Admin: update onboarding request status (with optional plan info)
export function useUpdateOnboardingRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      id: string;
      status: string;
      admin_notes?: string;
      selected_plan_id?: string | null;
      confirmed_value?: number | null;
      billing_cycle?: string | null;
    }) => {
      const updates: OnboardingRequestUpdate = {
        status: params.status,
        admin_notes: params.admin_notes,
        reviewed_at: new Date().toISOString(),
      };
      if (params.selected_plan_id !== undefined) updates.selected_plan_id = params.selected_plan_id;
      if (params.confirmed_value !== undefined) updates.confirmed_value = params.confirmed_value;
      if (params.billing_cycle !== undefined) updates.billing_cycle = params.billing_cycle;

      await adminAPI.updateOnboardingRequestAdmin(params.id, updates as AdminJSON);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-onboarding-requests'] });
    },
    onError: (error: unknown) => {
      toast.error('Erro: ' + getErrorMessage(error));
    },
  });
}

// Admin: list active subscription plans
export function useActiveSubscriptionPlans() {
  return useQuery({
    queryKey: ['active-subscription-plans'],
    queryFn: async () => {
      return adminAPI.listActiveSubscriptionPlans<ActiveSubscriptionPlan>();
    },
  });
}
