import type { PropertyFormData } from './property-form-model'

type CityChoice = { id: string; name: string; uf?: string | null }
type NeighborhoodChoice = {
  id: string
  name: string
  city?: CityChoice | null
}
type CondominiumChoice = {
  id: string
  city?: CityChoice | null
  neighborhood?: { id: string; name: string } | null
  address?: string | null
  cep?: string | null
  default_condominium_fee?: number | null
}

function sameLocationCity(previous: PropertyFormData, city: CityChoice) {
  const normalizeName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR')
  return normalizeName(previous.cidade) === normalizeName(city.name)
    && previous.uf.trim().toUpperCase() === (city.uf || previous.uf).trim().toUpperCase()
}

export function selectLocationCondominium(previous: PropertyFormData, condominium: CondominiumChoice | null): PropertyFormData {
  const changesCity = Boolean(condominium?.city?.id
    && condominium.city.id !== previous.city_id && !sameLocationCity(previous, condominium.city))
  const cepDigits = condominium?.cep?.replace(/\D/g, '').slice(0, 8)
  return {
    ...previous,
    condominium_id: condominium?.id || '',
    city_id: condominium?.city?.id || previous.city_id,
    neighborhood_id: condominium?.neighborhood?.id || (changesCity ? '' : previous.neighborhood_id),
    cidade: condominium?.city?.name || previous.cidade,
    uf: condominium?.city?.uf || previous.uf,
    bairro: condominium?.neighborhood?.name || (changesCity ? '' : previous.bairro),
    endereco: condominium?.address || (changesCity ? '' : previous.endereco),
    cep: cepDigits ? cepDigits.replace(/^(\d{5})(\d)/, '$1-$2') : changesCity ? '' : previous.cep,
    condominio: condominium?.default_condominium_fee != null
      ? String(condominium.default_condominium_fee).replace('.', ',') : previous.condominio,
  }
}

export function setManualLocationField(
  previous: PropertyFormData,
  field: 'cep' | 'uf' | 'cidade' | 'bairro' | 'city_id' | 'neighborhood_id',
  value: string,
): PropertyFormData {
  if (field === 'cep') {
    const oldDigits = previous.cep.replace(/\D/g, '')
    const newDigits = value.replace(/\D/g, '')
    return oldDigits === newDigits
      ? { ...previous, cep: value }
      : {
        ...previous, cep: value, endereco: '', uf: '', cidade: '', bairro: '',
        city_id: '', neighborhood_id: '', condominium_id: '',
      }
  }
  if (field === 'uf') {
    return previous.uf.trim().toUpperCase() === value.trim().toUpperCase()
      ? { ...previous, uf: value }
      : {
        ...previous, uf: value, cep: '', endereco: '', cidade: '', bairro: '',
        city_id: '', neighborhood_id: '', condominium_id: '',
      }
  }
  if (field === 'cidade') {
    return previous.cidade.trim().toLocaleLowerCase('pt-BR') === value.trim().toLocaleLowerCase('pt-BR')
      ? { ...previous, cidade: value }
      : {
        ...previous, cidade: value, cep: '', endereco: '', city_id: '',
        bairro: '', neighborhood_id: '', condominium_id: '',
      }
  }
  if (field === 'bairro') {
    return previous.bairro.trim().toLocaleLowerCase('pt-BR') === value.trim().toLocaleLowerCase('pt-BR')
      ? { ...previous, bairro: value }
      : { ...previous, bairro: value, neighborhood_id: '', condominium_id: '' }
  }
  if (field === 'city_id') {
    return { ...previous, city_id: value, neighborhood_id: '', condominium_id: '' }
  }
  return { ...previous, neighborhood_id: value, condominium_id: '' }
}

export function selectLocationCity(previous: PropertyFormData, city: CityChoice): PropertyFormData {
  if (city.id === previous.city_id) {
    return { ...previous, cidade: city.name, uf: city.uf || previous.uf }
  }
  const samePlace = sameLocationCity(previous, city)
  if (samePlace) {
    return {
      ...previous,
      city_id: city.id,
      cidade: city.name,
      uf: city.uf || previous.uf,
      neighborhood_id: '',
      condominium_id: '',
    }
  }
  return {
    ...previous,
    city_id: city.id,
    cidade: city.name,
    uf: city.uf || previous.uf,
    cep: '',
    endereco: '',
    bairro: '',
    neighborhood_id: '',
    condominium_id: '',
  }
}

export function selectLocationNeighborhood(
  previous: PropertyFormData,
  neighborhood: NeighborhoodChoice,
): PropertyFormData {
  const sameCityText = Boolean(neighborhood.city
    && previous.cidade.trim().toLocaleLowerCase('pt-BR')
      === neighborhood.city.name.trim().toLocaleLowerCase('pt-BR')
    && previous.uf.trim().toUpperCase()
      === (neighborhood.city.uf || previous.uf).trim().toUpperCase())
  const changesCity = Boolean(neighborhood.city?.id
    && neighborhood.city.id !== previous.city_id && !sameCityText)
  return {
    ...previous,
    neighborhood_id: neighborhood.id,
    bairro: neighborhood.name,
    city_id: neighborhood.city?.id || previous.city_id,
    cidade: neighborhood.city?.name || previous.cidade,
    uf: neighborhood.city?.uf || previous.uf,
    cep: changesCity ? '' : previous.cep,
    endereco: changesCity ? '' : previous.endereco,
    condominium_id: neighborhood.id === previous.neighborhood_id && !changesCity
      ? previous.condominium_id : '',
  }
}
