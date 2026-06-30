import { supabase } from '@/integrations/supabase/client'
import { ROUTES, getPublicAppUrl } from '@/config/constants'
import type { TablesUpdate } from '@/integrations/supabase/types'
import { meAPI } from './me'
import { settingsAPI } from './settings'
import { usersAPI } from './users'

type UserProfileUpdate = TablesUpdate<'users'>
type OrganizationUpdate = TablesUpdate<'organizations'>

// Auth API functions
export const authAPI = {
  async login(email: string, password: string) {
    return supabase.auth.signInWithPassword({ email, password })
  },

  async signup(email: string, password: string, name: string) {
    return supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    })
  },

  async logout() {
    return supabase.auth.signOut({ scope: 'global' })
  },

  async resetPassword(email: string) {
    try {
      const redirectUrl = getPublicAppUrl(ROUTES.RESET_PASSWORD);
      console.log('[authAPI] Resetting password for:', email, 'redirectUrl:', redirectUrl);

      const result = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });

      if (result.error) {
        console.error('[authAPI] Reset password error:', result.error);
      }

      return result;
    } catch (err) {
      console.error('[authAPI] Reset password exception:', err);
      throw err;
    }
  },

  async getSession() {
    return supabase.auth.getSession()
  },
}

// User API functions
export const userAPI = {
  async getProfile(userId: string) {
    void userId
    const response = await meAPI.getMe()
    return { data: response.context, error: null }
  },

  async updateProfile(userId: string, data: UserProfileUpdate) {
    void userId
    await settingsAPI.updateProfile(data)
    return { data: null, error: null }
  },

  async getUserOrganizations(userId: string) {
    void userId
    const data = await usersAPI.listUserOrganizations()
    return { data, error: null }
  },
}

// Organization API functions
export const organizationAPI = {
  async getOrganization(orgId: string) {
    const data = await settingsAPI.getSubscription(orgId)
    return { data: data.org, error: null }
  },

  async updateOrganization(orgId: string, data: OrganizationUpdate) {
    await settingsAPI.updateOrganization(data, orgId)
    return { data: null, error: null }
  },

  async switchOrganization(userId: string, orgId: string) {
    await meAPI.getMe(orgId)
    return [{ data: null, error: null }]
  },
}
