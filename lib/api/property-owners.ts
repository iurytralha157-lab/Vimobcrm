import { vimobAPIRequest } from './vimob-client'

export type PropertyOwnerProperty = {
  id: string
  code: string | null
  title: string | null
  tipo_de_negocio: string | null
  bairro: string | null
  cidade: string | null
}

export type PropertyOwner = {
  id: string
  organization_id: string
  name: string
  phone_residential: string | null
  phone_commercial: string | null
  cellphone: string | null
  email: string | null
  media_source: string | null
  notify_email: boolean
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  property_count?: number
  properties?: PropertyOwnerProperty[]
}

export type PropertyOwnerInput = {
  name: string
  phone_residential?: string
  phone_commercial?: string
  cellphone?: string
  email?: string
  media_source?: string
  notify_email?: boolean
  notes?: string
}

type ListResponse<T> = {
  data: T[]
}

type ItemResponse<T> = {
  data: T
}

export const propertyOwnersAPI = {
  async getOwners(organizationId: string) {
    return vimobAPIRequest<ListResponse<PropertyOwner>>('/v1/property-owners', {
      organizationId,
    })
  },

  async createOwner(organizationId: string, owner: PropertyOwnerInput) {
    return vimobAPIRequest<ItemResponse<PropertyOwner>>('/v1/property-owners', {
      method: 'POST',
      organizationId,
      body: owner,
    })
  },

  async updateOwner(organizationId: string, ownerId: string, owner: PropertyOwnerInput) {
    return vimobAPIRequest<ItemResponse<PropertyOwner>>(`/v1/property-owners/${ownerId}`, {
      method: 'PATCH',
      organizationId,
      body: owner,
    })
  },
}
