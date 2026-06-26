import React, { useState, useEffect, ReactNode } from 'react';
import { PublicSiteConfig } from '@/hooks/use-public-site';
import { PublicSiteUnavailable } from '@/components/public/PublicSiteUnavailable';
import { publicSiteAPI } from '@/lib/api/public-site';

export interface PublicContextType {
  organizationId: string | null;
  siteConfig: PublicSiteConfig | null;
  isLoading: boolean;
  error: string | null;
}

export const PublicContext = React.createContext<PublicContextType | undefined>(undefined);

export function usePublicContext() {
  const context = React.useContext(PublicContext);

  if (!context) {
    throw new Error('usePublicContext must be used within a PublicSiteProvider');
  }

  return context;
}

export function mapSiteDataToConfig(data: PublicSiteConfig, orgName: string): PublicSiteConfig {
  return {
    id: data.id,
    is_active: data.is_active ?? true,
    subdomain: data.subdomain,
    custom_domain: data.custom_domain,
    site_title: data.site_title || 'Site Imobiliário',
    site_description: data.site_description,
    primary_color: data.primary_color || '#F97316',
    secondary_color: data.secondary_color || '#1E293B',
    accent_color: data.accent_color || '#F97316',
    logo_url: data.logo_url,
    favicon_url: data.favicon_url,
    email: data.email,
    phone: data.phone,
    whatsapp: data.whatsapp,
    address: data.address,
    city: data.city,
    state: data.state,
    facebook: data.facebook,
    instagram: data.instagram,
    linkedin: data.linkedin,
    youtube: data.youtube,
    about_title: data.about_title,
    about_text: data.about_text,
    about_image_url: data.about_image_url,
    seo_title: data.seo_title,
    seo_description: data.seo_description,
    seo_keywords: data.seo_keywords,
    google_analytics_id: data.google_analytics_id,
    hero_image_url: data.hero_image_url,
    hero_title: data.hero_title,
    hero_subtitle: data.hero_subtitle,
    page_banner_url: data.page_banner_url,
    logo_width: data.logo_width,
    logo_height: data.logo_height,
    watermark_enabled: data.watermark_enabled,
    watermark_opacity: data.watermark_opacity,
    watermark_logo_url: data.watermark_logo_url,
    watermark_size: data.watermark_size ?? 80,
    watermark_position: data.watermark_position ?? 'bottom-right',
    organization_name: orgName,
    site_theme: data.site_theme || 'dark',
    background_color: data.background_color || '#0D0D0D',
    text_color: data.text_color || '#FFFFFF',
    card_color: data.card_color || '#FFFFFF',
    show_about_on_home: data.show_about_on_home ?? false,
    about_subtitle: data.about_subtitle || null,
    about_stats: data.about_stats || null,
    about_checkmarks: data.about_checkmarks || null,
    about_features: data.about_features || null,
    gtm_id: data.gtm_id || null,
    meta_pixel_id: data.meta_pixel_id || null,
    google_ads_id: data.google_ads_id || null,
    head_scripts: data.head_scripts || null,
    body_scripts: data.body_scripts || null,
  };
}

export function PublicSiteProvider({ children }: { children: ReactNode }) {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [siteConfig, setSiteConfig] = useState<PublicSiteConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBlocked] = useState(false);

  useEffect(() => {
    const resolveSite = async () => {
      try {
        const hostname = window.location.hostname;

        // Skip for localhost and main app domains
        if (
          hostname === 'localhost' ||
          hostname === 'vimobe.lovable.app' ||
          hostname.includes('lovable.app') ||
          hostname.includes('lovable.dev') ||
          hostname.includes('lovableproject.com')
        ) {
          setIsLoading(false);
          return;
        }

        const data = await publicSiteAPI.resolve(hostname);
        if (data.found && data.site_config) {
          const site = data.site_config as PublicSiteConfig & { organization_id?: string };
          const config = {
            ...site,
            site_theme: site.site_theme || 'dark',
            background_color: site.background_color || '#0D0D0D',
            text_color: site.text_color || '#FFFFFF',
            card_color: site.card_color || '#FFFFFF',
            watermark_size: site.watermark_size ?? 80,
            watermark_position: site.watermark_position ?? 'bottom-right',
          };
          setOrganizationId(site.organization_id || null);
          setSiteConfig(config);

          sessionStorage.setItem(`site_config_${hostname}`, JSON.stringify({
            organization_id: site.organization_id || null,
            site_config: config
          }));
        } else {
          setError('Site não encontrado');
        }
      } catch (err) {
        console.error('Error resolving site:', err);
        setError('Erro ao carregar site');
      } finally {
        setIsLoading(false);
      }
    };

    resolveSite();
  }, []);

  const contextValue: PublicContextType = {
    organizationId,
    siteConfig,
    isLoading,
    error,
  };

  return isBlocked ? (
    <PublicSiteUnavailable />
  ) : (
    <PublicContext.Provider value={contextValue}>
      {children}
    </PublicContext.Provider>
  );
}

// Re-export usePublicContext for backward compatibility
export { usePublicContext as usePublicSiteContext };
