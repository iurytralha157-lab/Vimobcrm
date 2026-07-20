import { supabase } from '@/integrations/supabase/client'
import { ROUTES, getPublicAppUrl } from '@/config/constants'
import { meAPI } from './me'
import { settingsAPI } from './settings'
import type { UpdateOrganizationInput, UpdateProfileInput } from './settings'
import { usersAPI } from './users'
import { entityIdSchema, loginSchema, parseDomainInput, resetPasswordSchema, signUpSchema } from '@/lib/validation'

// Auth API functions
export const authAPI = {
  async login(email: string, password: string) {
    const credentials = parseDomainInput(loginSchema, { email, password }, 'auth.login')
    return supabase.auth.signInWithPassword(credentials)
  },

  async signup(email: string, password: string, name: string) {
    const credentials = parseDomainInput(signUpSchema, { email, password, name }, 'auth.signup')
    return supabase.auth.signUp({
      email: credentials.email,
      password: credentials.password,
      options: { data: { name: credentials.name } },
    })
  },

  async logout() {
    return supabase.auth.signOut({ scope: 'global' })
  },

  async resetPassword(email: string) {
    try {
      const input = parseDomainInput(resetPasswordSchema, { email }, 'auth.reset-password')
      const redirectUrl = getPublicAppUrl(ROUTES.RESET_PASSWORD);
      console.log('[authAPI] Resetting password for:', email, 'redirectUrl:', redirectUrl);

      const result = await supabase.auth.resetPasswordForEmail(input.email, {
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
    parseDomainInput(entityIdSchema, userId, 'auth.profile.get.user-id')
    const response = await meAPI.getMe()
    return { data: response.context, error: null }
  },

  async updateProfile(userId: string, data: UpdateProfileInput) {
    parseDomainInput(entityIdSchema, userId, 'auth.profile.update.user-id')
    await settingsAPI.updateProfile(data)
    return { data: null, error: null }
  },

  async getUserOrganizations(userId: string) {
    parseDomainInput(entityIdSchema, userId, 'auth.organizations.list.user-id')
    const data = await usersAPI.listUserOrganizations()
    return { data, error: null }
  },
}

// Organization API functions
export const organizationAPI = {
  async getOrganization(orgId: string) {
    parseDomainInput(entityIdSchema, orgId, 'auth.organization.get.id')
    const data = await settingsAPI.getSubscription(orgId)
    return { data: data.org, error: null }
  },

  async updateOrganization(orgId: string, data: UpdateOrganizationInput) {
    parseDomainInput(entityIdSchema, orgId, 'auth.organization.update.id')
    await settingsAPI.updateOrganization(data, orgId)
    return { data: null, error: null }
  },

  async switchOrganization(userId: string, orgId: string) {
    parseDomainInput(entityIdSchema, userId, 'auth.organization.switch.user-id')
    parseDomainInput(entityIdSchema, orgId, 'auth.organization.switch.organization-id')
    await meAPI.getMe(orgId)
    return [{ data: null, error: null }]
  },
}
