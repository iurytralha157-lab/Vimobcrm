import { useQuery } from "@tanstack/react-query";
import { publicSiteAPI } from "@/lib/api/public-site";

export interface PublicSiteConfig {
  id: string;
  is_active: boolean;
  subdomain: string | null;
  custom_domain: string | null;
  site_title: string;
  site_description: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  whatsapp: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  instagram: string | null;
  facebook: string | null;
  youtube: string | null;
  linkedin: string | null;
  about_title: string | null;
  about_text: string | null;
  about_image_url: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string | null;
  google_analytics_id: string | null;
  // Hero fields
  hero_image_url: string | null;
  hero_title: string | null;
  hero_subtitle: string | null;
  page_banner_url: string | null;
  // Logo size fields
  logo_width: number | null;
  logo_height: number | null;
  // Watermark fields
  watermark_enabled: boolean | null;
  watermark_opacity: number | null;
  watermark_logo_url: string | null;
  watermark_size: number | null;
  watermark_position: string | null;
  organization_name: string;
  // Theme fields
  site_theme: string;
  background_color: string;
  text_color: string;
  card_color: string;
  // About on home
  show_about_on_home: boolean;
  // About page customization
  about_subtitle: string | null;
  about_stats: { value: string; label: string }[] | null;
  about_checkmarks: string[] | null;
  about_features: { title: string; description: string; icon: string }[] | null;
  // Tracking & scripts
  gtm_id?: string | null;
  meta_pixel_id?: string | null;
  google_ads_id?: string | null;
  head_scripts?: string | null;
  body_scripts?: string | null;
}

export interface PublicProperty {
  id: string;
  codigo: string;
  titulo: string;
  descricao: string | null;
  tipo_imovel: string | null;
  valor_venda: number | null;
  valor_aluguel: number | null;
  quartos: number | null;
  suites: number | null;
  banheiros: number | null;
  vagas: number | null;
  area_total: number | null;
  area_construida: number | null;
  endereco: string | null;
  public_address_visibility?: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  imagem_principal: string | null;
  fotos: string[] | null;
  destaque: boolean;
  status: string;
}

function getVisitorSessionId() {
  if (typeof window === 'undefined') return null;

  let sessionId = window.localStorage.getItem('vimob_session_id');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    window.localStorage.setItem('vimob_session_id', sessionId);
  }

  return sessionId;
}

export function usePublicSiteConfig(organizationId: string | null) {
  return useQuery({
    queryKey: ['public-site-config', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;

      const data = await publicSiteAPI.resolve(window.location.hostname);
      if (!data?.found) return null;
      return data.site_config as PublicSiteConfig;
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function usePublicProperties(organizationId: string | null, filters?: {
  page?: number;
  limit?: number;
  search?: string;
  tipo?: string;
  finalidade?: string;
  minPrice?: number;
  maxPrice?: number;
  quartos?: number;
  suites?: number;
  banheiros?: number;
  vagas?: number;
  cidade?: string;
  bairro?: string;
  mobilia?: string;
}) {
  return useQuery({
    queryKey: ['public-properties', organizationId, filters],
    queryFn: async () => {
      if (!organizationId) return { properties: [], total: 0, page: 1, limit: 12, totalPages: 0 };

      const params = new URLSearchParams({
        organization_id: organizationId,
        endpoint: 'properties',
        page: String(filters?.page || 1),
        limit: String(filters?.limit || 12),
      });

      if (filters?.search) params.append('search', filters.search);
      if (filters?.tipo) params.append('tipo', filters.tipo);
      if (filters?.finalidade) params.append('finalidade', filters.finalidade);
      if (filters?.minPrice) params.append('min_price', String(filters.minPrice));
      if (filters?.maxPrice) params.append('max_price', String(filters.maxPrice));
      if (filters?.quartos) params.append('quartos', String(filters.quartos));
      if (filters?.suites) params.append('suites', String(filters.suites));
      if (filters?.banheiros) params.append('banheiros', String(filters.banheiros));
      if (filters?.vagas) params.append('vagas', String(filters.vagas));
      if (filters?.cidade) params.append('cidade', filters.cidade);
      if (filters?.bairro) params.append('bairro', filters.bairro);
      if (filters?.mobilia) params.append('mobilia', filters.mobilia);

      return publicSiteAPI.getData(Object.fromEntries(params.entries()));
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 2, // 2min - cache while navigating
    gcTime: 1000 * 60 * 10,
    placeholderData: (prev) => prev, // keep previous page visible during refetch
  });
}

export function usePublicProperty(organizationId: string | null, propertyCode: string | null) {
  return useQuery({
    queryKey: ['public-property', organizationId, propertyCode],
    queryFn: async () => {
      if (!organizationId || !propertyCode) return null;

      const params = new URLSearchParams({
        organization_id: organizationId,
        endpoint: 'property',
        property_code: propertyCode,
      });

      const data = await publicSiteAPI.getData<{ property: PublicProperty | null }>(Object.fromEntries(params.entries()));
      return data.property as PublicProperty;
    },
    enabled: !!organizationId && !!propertyCode,
    staleTime: 1000 * 60 * 5, // 5min
    gcTime: 1000 * 60 * 15,
  });
}

export function useFeaturedProperties(organizationId: string | null) {
  return useQuery({
    queryKey: ['public-featured-properties', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const params = new URLSearchParams({
        organization_id: organizationId,
        endpoint: 'featured',
      });

      const data = await publicSiteAPI.getData<{ properties: PublicProperty[] }>(Object.fromEntries(params.entries()));
      return data.properties as PublicProperty[];
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  });
}

export function useExclusiveProperties(organizationId: string | null) {
  return useQuery({
    queryKey: ['public-exclusive-properties', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const params = new URLSearchParams({
        organization_id: organizationId,
        endpoint: 'exclusive',
      });

      const data = await publicSiteAPI.getData<{ properties: PublicProperty[] }>(Object.fromEntries(params.entries()));
      return data.properties as PublicProperty[];
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  });
}

export function usePropertyTypes(organizationId: string | null) {
  return useQuery({
    queryKey: ['public-property-types', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const params = new URLSearchParams({
        organization_id: organizationId,
        endpoint: 'property-types',
      });

      const data = await publicSiteAPI.getData<{ types: string[] }>(Object.fromEntries(params.entries()));
      return data.types as string[];
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });
}

export function usePublicCities(organizationId: string | null) {
  return useQuery({
    queryKey: ['public-cities', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const params = new URLSearchParams({
        organization_id: organizationId,
        endpoint: 'cities',
      });

      const data = await publicSiteAPI.getData<{ cities: string[] }>(Object.fromEntries(params.entries()));
      return data.cities as string[];
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });
}

export function usePublicNeighborhoods(organizationId: string | null, cidade?: string) {
  return useQuery({
    queryKey: ['public-neighborhoods', organizationId, cidade],
    queryFn: async () => {
      if (!organizationId) return [];

      const params = new URLSearchParams({
        organization_id: organizationId,
        endpoint: 'neighborhoods',
      });
      if (cidade) params.append('cidade', cidade);

      const data = await publicSiteAPI.getData<{ neighborhoods: string[] }>(Object.fromEntries(params.entries()));
      return data.neighborhoods as string[];
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });
}

export function usePublicHomeData(organizationId: string | null) {
  return useQuery({
    queryKey: ['public-home-data', organizationId],
    queryFn: async () => {
      if (!organizationId) return { featured: [], exclusive: [], latest: [], types: [], cities: [] };

      const params = new URLSearchParams({
        organization_id: organizationId,
        endpoint: 'home',
      });

      return publicSiteAPI.getData<{
        featured: PublicProperty[];
        exclusive: PublicProperty[];
        latest: PublicProperty[];
        types: string[];
        cities: string[];
      }>(Object.fromEntries(params.entries()));
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  });
}

export async function submitContactForm(data: {
  organization_id: string;
  name: string;
  email?: string;
  phone: string;
  message?: string;
  property_id?: string;
  property_code?: string;
  session_id?: string | null;
}) {
  return publicSiteAPI.submitContact({
    ...data,
    session_id: data.session_id ?? getVisitorSessionId(),
  });
}
