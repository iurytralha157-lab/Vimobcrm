export type PropertyLocationsProps = {
  initialTab?: 'cities' | 'neighborhoods' | 'condominiums' | 'owners'
}

export type PropertyLocationsTab = NonNullable<PropertyLocationsProps['initialTab']>

export type CityFormState = {
  name: string
  uf: string
}

export type NeighborhoodFormState = {
  name: string
  city_id: string
}

export type CondominiumFormState = {
  name: string
  city_id: string
  neighborhood_id: string
  address: string
  photo_url: string
  cep: string
  number: string
  complement: string
  default_condominium_fee: string
  has_concierge: boolean
  concierge_type: string
  notes: string
}

export type OwnerFormState = {
  name: string
  phone_residential: string
  phone_commercial: string
  cellphone: string
  email: string
  media_source: string
  notify_email: boolean
  notes: string
}

export type PropertyAssignmentPayload = {
  city_id?: string | null
  cidade?: string | null
  uf?: string | null
  neighborhood_id?: string | null
  bairro?: string | null
  owner_id?: string | null
  owner_name?: string | null
  owner_phone_residential?: string | null
  owner_phone_commercial?: string | null
  owner_cellphone?: string | null
  owner_email?: string | null
  owner_media_source?: string | null
  owner_notify_email?: boolean
}

export type AssignmentTarget = {
  type: PropertyLocationsTab
  id: string
  title: string
  subtitle?: string
  payload: PropertyAssignmentPayload
}

export type LocationDeletionTarget = {
  type: 'city' | 'neighborhood' | 'condominium' | 'owner'
  id: string
  name: string
  expected_updated_at: string
}

export type CatalogLocation = {
  catalog_source?: 'catalog' | 'property'
  property_count?: number
}

export type PropertyAssignmentSummary = {
  succeededIds: string[]
  failedIds: string[]
}

export type PropertyAssignmentInvalidationKey = readonly unknown[]

type CityAssignmentSource = {
  id: string
  name: string
  uf: string | null
}

type NeighborhoodAssignmentSource = {
  id: string
  name: string
  city_id: string | null
  city?: {
    name: string
    uf: string | null
  } | null
}

type OwnerAssignmentSource = {
  id: string
  name: string
  phone_residential: string | null
  phone_commercial: string | null
  cellphone: string | null
  email: string | null
  media_source: string | null
  notify_email: boolean
}

type OwnerFormSource = OwnerAssignmentSource & {
  notes: string | null
}

type CityFormSource = {
  name: string
  uf: string | null
}

type NeighborhoodFormSource = {
  name: string
  city_id: string | null
}

type CondominiumFormSource = {
  name: string
  city_id: string | null
  neighborhood_id: string | null
  address: string | null
  photo_url: string | null
  cep: string | null
  number: string | null
  complement: string | null
  default_condominium_fee: number | null
  has_concierge: boolean | null
  concierge_type: string | null
  notes: string | null
}

type OwnerContactSource = {
  cellphone: string | null
  phone_residential: string | null
  phone_commercial: string | null
}

type OwnerPropertyCountSource = {
  property_count?: number
  properties?: readonly unknown[]
}

export type CreateCondominiumPayload = {
  name: string
  city_id?: string
  neighborhood_id?: string
  address?: string
  photo_url?: string
  cep?: string
  number?: string
  complement?: string
  default_condominium_fee?: number
  has_concierge: boolean
  concierge_type?: string
  notes?: string
}

export type UpdateCondominiumPayload = {
  name: string
  city_id: string | null
  neighborhood_id: string | null
  address: string | null
  photo_url: string | null
  cep: string | null
  number: string | null
  complement: string | null
  default_condominium_fee: number | null
  has_concierge: boolean
  concierge_type: string | null
  notes: string | null
}

export const EMPTY_CITY_FORM: CityFormState = {
  name: '',
  uf: '',
}

export const EMPTY_NEIGHBORHOOD_FORM: NeighborhoodFormState = {
  name: '',
  city_id: '',
}

export const EMPTY_OWNER_FORM: OwnerFormState = {
  name: '',
  phone_residential: '',
  phone_commercial: '',
  cellphone: '',
  email: '',
  media_source: '',
  notify_email: false,
  notes: '',
}

export const EMPTY_CONDOMINIUM_FORM: CondominiumFormState = {
  name: '',
  city_id: '',
  neighborhood_id: '',
  address: '',
  photo_url: '',
  cep: '',
  number: '',
  complement: '',
  default_condominium_fee: '',
  has_concierge: false,
  concierge_type: '',
  notes: '',
}

export const UF_OPTIONS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
] as const

export function parseCurrencyInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed
  const amount = Number(normalized)

  return Number.isFinite(amount) && amount >= 0 ? amount : undefined
}

export function buildCondominiumPayload(
  form: CondominiumFormState,
  condominiumFee: number | undefined,
): CreateCondominiumPayload {
  return {
    name: form.name.trim(),
    city_id: form.city_id || undefined,
    neighborhood_id: form.neighborhood_id || undefined,
    address: form.address.trim() || undefined,
    photo_url: form.photo_url.trim() || undefined,
    cep: form.cep.trim() || undefined,
    number: form.number.trim() || undefined,
    complement: form.complement.trim() || undefined,
    default_condominium_fee: condominiumFee,
    has_concierge: form.has_concierge,
    concierge_type: form.concierge_type.trim() || undefined,
    notes: form.notes.trim() || undefined,
  }
}

export function buildCondominiumUpdatePayload(
  form: CondominiumFormState,
  condominiumFee: number | undefined,
): UpdateCondominiumPayload {
  return {
    name: form.name.trim(),
    city_id: form.city_id || null,
    neighborhood_id: form.neighborhood_id || null,
    address: form.address.trim() || null,
    photo_url: form.photo_url.trim() || null,
    cep: form.cep.trim() || null,
    number: form.number.trim() || null,
    complement: form.complement.trim() || null,
    default_condominium_fee: condominiumFee ?? null,
    has_concierge: form.has_concierge,
    concierge_type: form.concierge_type.trim() || null,
    notes: form.notes.trim() || null,
  }
}

export function cityFormFromCity(city?: CityFormSource | null): CityFormState {
  if (!city) return EMPTY_CITY_FORM

  return {
    name: city.name || '',
    uf: city.uf || '',
  }
}

export function neighborhoodFormFromNeighborhood(
  neighborhood?: NeighborhoodFormSource | null,
): NeighborhoodFormState {
  if (!neighborhood) return EMPTY_NEIGHBORHOOD_FORM

  return {
    name: neighborhood.name || '',
    city_id: neighborhood.city_id || '',
  }
}

export function condominiumFormFromCondominium(
  condominium?: CondominiumFormSource | null,
): CondominiumFormState {
  if (!condominium) return EMPTY_CONDOMINIUM_FORM

  return {
    name: condominium.name || '',
    city_id: condominium.city_id || '',
    neighborhood_id: condominium.neighborhood_id || '',
    address: condominium.address || '',
    photo_url: condominium.photo_url || '',
    cep: condominium.cep || '',
    number: condominium.number || '',
    complement: condominium.complement || '',
    default_condominium_fee:
      condominium.default_condominium_fee == null
        ? ''
        : String(condominium.default_condominium_fee),
    has_concierge: !!condominium.has_concierge,
    concierge_type: condominium.concierge_type || '',
    notes: condominium.notes || '',
  }
}

export function getOwnerContact(owner: OwnerContactSource) {
  return owner.cellphone || owner.phone_residential || owner.phone_commercial || ''
}

export function getOwnerPropertyCount(owner: OwnerPropertyCountSource) {
  return owner.property_count ?? owner.properties?.length ?? 0
}

export function ownerFormFromOwner(owner?: OwnerFormSource | null): OwnerFormState {
  if (!owner) return EMPTY_OWNER_FORM

  return {
    name: owner.name || '',
    phone_residential: owner.phone_residential || '',
    phone_commercial: owner.phone_commercial || '',
    cellphone: owner.cellphone || '',
    email: owner.email || '',
    media_source: owner.media_source || '',
    notify_email: !!owner.notify_email,
    notes: owner.notes || '',
  }
}

export function isLegacyCatalogValue(location: CatalogLocation) {
  return location.catalog_source === 'property'
}

export function catalogLocationsOnly<T extends CatalogLocation>(
  locations: readonly T[],
) {
  return locations.filter((location) => !isLegacyCatalogValue(location))
}

export function catalogLocationIdForMutation<
  T extends CatalogLocation & { id: string },
>(locations: readonly T[], locationId: string) {
  if (!locationId) return ''

  const selectedLocation = locations.find(({ id }) => id === locationId)
  return selectedLocation && isLegacyCatalogValue(selectedLocation)
    ? ''
    : locationId
}

export function summarizePropertyAssignmentResults(
  propertyIds: readonly string[],
  results: readonly PromiseSettledResult<unknown>[],
): PropertyAssignmentSummary {
  return propertyIds.reduce<PropertyAssignmentSummary>(
    (summary, propertyId, index) => {
      if (results[index]?.status === 'fulfilled') {
        summary.succeededIds.push(propertyId)
      } else {
        summary.failedIds.push(propertyId)
      }
      return summary
    },
    { succeededIds: [], failedIds: [] },
  )
}

export function propertyAssignmentInvalidationKeys(
  organizationId: string,
  succeededIds: readonly string[],
): PropertyAssignmentInvalidationKey[] {
  return [
    ['properties'],
    ['properties-infinite'],
    ['property-owners'],
    ['property-cities'],
    ['property-neighborhoods'],
    ['property-condominiums'],
    ['property-workspace', organizationId],
    ...succeededIds.flatMap((propertyId) => [
      ['property', organizationId, propertyId],
      ['property-history', organizationId, propertyId],
    ]),
  ]
}

export function createCityAssignment(city: CityAssignmentSource): AssignmentTarget {
  return {
    type: 'cities',
    id: city.id,
    title: city.name,
    subtitle: city.uf ? `Cidade - ${city.uf}` : 'Cidade',
    payload: {
      city_id: city.id,
      cidade: city.name,
      uf: city.uf || null,
    },
  }
}

export function createNeighborhoodAssignment(
  neighborhood: NeighborhoodAssignmentSource,
): AssignmentTarget {
  return {
    type: 'neighborhoods',
    id: neighborhood.id,
    title: neighborhood.name,
    subtitle: neighborhood.city?.name || 'Bairro',
    payload: {
      neighborhood_id: neighborhood.id,
      bairro: neighborhood.name,
      city_id: neighborhood.city_id || null,
      cidade: neighborhood.city?.name || null,
      uf: neighborhood.city?.uf || null,
    },
  }
}

export function createOwnerAssignment(owner: OwnerAssignmentSource): AssignmentTarget {
  return {
    type: 'owners',
    id: owner.id,
    title: owner.name,
    subtitle: 'Proprietário',
    payload: {
      owner_id: owner.id,
      owner_name: owner.name,
      owner_phone_residential: owner.phone_residential,
      owner_phone_commercial: owner.phone_commercial,
      owner_cellphone: owner.cellphone,
      owner_email: owner.email,
      owner_media_source: owner.media_source,
      owner_notify_email: owner.notify_email,
    },
  }
}

export function propertyLocationsHref(
  tab: PropertyLocationsTab,
  currentSearch: string,
) {
  const params = new URLSearchParams(currentSearch)
  params.delete('tab')

  let pathname = '/properties/locations'
  if (tab === 'neighborhoods') params.set('tab', 'neighborhoods')
  if (tab === 'condominiums') pathname = '/properties/condominiums'
  if (tab === 'owners') pathname = '/properties/owners'

  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}
