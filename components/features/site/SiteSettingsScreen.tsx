'use client';

/* eslint-disable react/no-unescaped-entities */

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { useOrganizationSite, useCreateOrganizationSite, useUpdateOrganizationSite, type OrganizationSite } from "@/hooks/use-organization-site";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { AlertCircle, Globe, Palette, Phone, Share2, Search, ExternalLink, Loader2, Menu, Info, RefreshCw, Save } from "lucide-react";
import { AnimatedIcon } from "@/components/shared/icons/AnimatedIcon";
import GLOBE_JSON from "@/components/shared/icons/globe-icon.json";
import { MenuTab } from "@/components/features/site/MenuTab";
import { SearchFiltersTab } from "@/components/features/site/SearchFiltersTab";
import { AboutTab } from "@/components/features/site/AboutTab";
import {
  DomainConnectionGuide,
  SiteGeneralDashboard,
  type SiteGeneralValues,
} from "@/components/features/site";
import { Slider } from "@/components/ui/slider";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { ImageUpload } from "@/components/ui/image-upload";
import { cn } from "@/lib/utils";
import { canManageOrganization } from "@/lib/access/organization";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { getCloudflareWorkerCode } from "@/lib/site/cloudflare-worker";
import { getSitePublicUrl } from "@/lib/site/site-publication";

type AboutStat = {
  value: string;
  label: string;
};

type AboutFeature = {
  title: string;
  description: string;
  icon: string;
};

type SiteFormData = {
  is_active: boolean;
  maintenance_mode: boolean;
  maintenance_message: string;
  subdomain: string;
  custom_domain: string;
  site_title: string;
  site_description: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  site_theme: string;
  background_color: string;
  text_color: string;
  card_color: string;
  whatsapp: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  instagram: string;
  facebook: string;
  youtube: string;
  linkedin: string;
  about_title: string;
  about_text: string;
  about_subtitle: string;
  about_stats: AboutStat[];
  about_checkmarks: string[];
  about_features: AboutFeature[];
  seo_title: string;
  seo_description: string;
  seo_keywords: string;
  google_analytics_id: string;
  gtm_id: string;
  meta_pixel_id: string;
  google_ads_id: string;
  head_scripts: string;
  body_scripts: string;
  hero_title: string;
  hero_subtitle: string;
  show_about_on_home: boolean;
};

type ExtendedOrganizationSite = OrganizationSite & {
  about_subtitle?: string | null;
  about_stats?: AboutStat[] | null;
  about_checkmarks?: string[] | null;
  about_features?: AboutFeature[] | null;
  gtm_id?: string | null;
  meta_pixel_id?: string | null;
  google_ads_id?: string | null;
  head_scripts?: string | null;
  body_scripts?: string | null;
};

type OrganizationSiteSaveData = Partial<ExtendedOrganizationSite>;

const siteSections = [
  {
    value: 'general',
    label: 'Geral',
    description: 'Status, logo e domínio',
    icon: Globe,
  },
  {
    value: 'appearance',
    label: 'Aparência',
    description: 'Tema, cores e imagens',
    icon: Palette,
  },
  {
    value: 'menu',
    label: 'Menu',
    description: 'Links do site e filtros públicos',
    icon: Menu,
  },
  {
    value: 'about',
    label: 'Sobre',
    description: 'História, diferenciais e imagem',
    icon: Info,
  },
  {
    value: 'contact',
    label: 'Contato',
    description: 'Telefone, WhatsApp e endereço',
    icon: Phone,
  },
  {
    value: 'social',
    label: 'Social',
    description: 'Redes sociais da imobiliária',
    icon: Share2,
  },
  {
    value: 'seo',
    label: 'SEO',
    description: 'Metatags, pixels e scripts',
    icon: Search,
  },
] as const;

const siteSectionValues = siteSections.map(section => section.value);

function normalizeSiteTab(value: string | null) {
  return siteSectionValues.includes(value as (typeof siteSectionValues)[number])
    ? value!
    : 'general';
}

function normalizeGeneralView(value: string | null) {
  return value === 'domain-guide' ? 'domain-guide' : 'dashboard';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

export default function SiteSettings() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, isSuperAdmin, organization, userOrganizations } = useAuth();
  const { hasPermission } = useUserPermissions();
  const {
    data: site,
    isLoading,
    isError: isSiteError,
    refetch: refetchSite,
  } = useOrganizationSite();
  const createSite = useCreateOrganizationSite();
  const updateSite = useUpdateOrganizationSite();
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const isAdmin =
    canManageOrganization({ isSuperAdmin, memberRole: activeMemberRole }) ||
    hasPermission('settings_site');


  const [formData, setFormData] = useState<SiteFormData>({
    is_active: false,
    maintenance_mode: false,
    maintenance_message: '',
    subdomain: '',
    custom_domain: '',
    site_title: '',
    site_description: '',
    primary_color: '#F97316',
    secondary_color: '#1E293B',
    accent_color: '#3B82F6',
    site_theme: 'dark',
    background_color: '#0D0D0D',
    text_color: '#FFFFFF',
    card_color: '#FFFFFF',
    whatsapp: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    instagram: '',
    facebook: '',
    youtube: '',
    linkedin: '',
    about_title: '',
    about_text: '',
    about_subtitle: '',
    about_stats: [
      { value: '500+', label: 'Imóveis Vendidos' },
      { value: '98%', label: 'Clientes Satisfeitos' },
      { value: '15+', label: 'Anos de Experiência' },
      { value: '50+', label: 'Parceiros' },
    ],
    about_checkmarks: ['Atendimento personalizado', 'Imóveis verificados', 'Suporte completo'],
    about_features: [
      { title: 'Imóveis Selecionados', description: 'Curadoria dos melhores imóveis da região com critérios rigorosos de qualidade', icon: 'building' },
      { title: 'Atendimento Personalizado', description: 'Equipe dedicada e treinada para encontrar o imóvel ideal para você', icon: 'users' },
      { title: 'Experiência no Mercado', description: 'Anos de experiência e centenas de clientes satisfeitos no setor imobiliário', icon: 'award' },
      { title: 'Compromisso', description: 'Seu sonho é a nossa prioridade e trabalhamos para realizá-lo', icon: 'heart' },
    ],
    seo_title: '',
    seo_description: '',
    seo_keywords: '',
    google_analytics_id: '',
    gtm_id: '',
    meta_pixel_id: '',
    google_ads_id: '',
    head_scripts: '',
    body_scripts: '',
    // New hero fields
    hero_title: '',
    hero_subtitle: '',
    show_about_on_home: false,
  });

  const [isSaving, setIsSaving] = useState(false);
  const siteActiveTab = normalizeSiteTab(searchParams.get('tab'));
  const generalView = normalizeGeneralView(searchParams.get('view'));
  const setSiteActiveTab = (value: string) => {
    router.replace(value === 'general' ? '/settings/site' : `/settings/site?tab=${value}`);
  };
  const setGeneralView = (view: 'dashboard' | 'domain-guide') => {
    router.replace(view === 'dashboard' ? '/settings/site' : '/settings/site?view=domain-guide');
  };
  const publicUrl = getSitePublicUrl({
    customDomain: formData.custom_domain,
    domainVerified: site?.domain_verified,
    subdomain: formData.subdomain,
  });
  const previewUrl = formData.is_active ? publicUrl : null;
  const workerCode = site?.domain_verification_token
    ? getCloudflareWorkerCode(site.domain_verification_token)
    : '';

  useEffect(() => {
    if (!site) return;

    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setFormData({
        is_active: site.is_active,
        maintenance_mode: site.maintenance_mode,
        maintenance_message: site.maintenance_message || '',
        subdomain: site.subdomain || '',
        custom_domain: site.custom_domain || '',
        site_title: site.site_title || '',
        site_description: site.site_description || '',
        primary_color: site.primary_color || '#F97316',
        secondary_color: site.secondary_color || '#1E293B',
        accent_color: site.accent_color || '#3B82F6',
        site_theme: site.site_theme || 'dark',
        background_color: site.background_color || '#0D0D0D',
        text_color: site.text_color || '#FFFFFF',
        card_color: site.card_color || '#FFFFFF',
        whatsapp: site.whatsapp || '',
        phone: site.phone || '',
        email: site.email || '',
        address: site.address || '',
        city: site.city || '',
        state: site.state || '',
        instagram: site.instagram || '',
        facebook: site.facebook || '',
        youtube: site.youtube || '',
        linkedin: site.linkedin || '',
        about_title: site.about_title || '',
        about_text: site.about_text || '',
        about_subtitle: (site as ExtendedOrganizationSite).about_subtitle || '',
        about_stats: (site as ExtendedOrganizationSite).about_stats || [
          { value: '500+', label: 'Imóveis Vendidos' },
          { value: '98%', label: 'Clientes Satisfeitos' },
          { value: '15+', label: 'Anos de Experiência' },
          { value: '50+', label: 'Parceiros' },
        ],
        about_checkmarks: (site as ExtendedOrganizationSite).about_checkmarks || ['Atendimento personalizado', 'Imóveis verificados', 'Suporte completo'],
        about_features: (site as ExtendedOrganizationSite).about_features || [
          { title: 'Imóveis Selecionados', description: 'Curadoria dos melhores imóveis da região com critérios rigorosos de qualidade', icon: 'building' },
          { title: 'Atendimento Personalizado', description: 'Equipe dedicada e treinada para encontrar o imóvel ideal para você', icon: 'users' },
          { title: 'Experiência no Mercado', description: 'Anos de experiência e centenas de clientes satisfeitos no setor imobiliário', icon: 'award' },
          { title: 'Compromisso', description: 'Seu sonho é a nossa prioridade e trabalhamos para realizá-lo', icon: 'heart' },
        ],
        seo_title: site.seo_title || '',
        seo_description: site.seo_description || '',
        seo_keywords: site.seo_keywords || '',
        google_analytics_id: site.google_analytics_id || '',
        gtm_id: (site as ExtendedOrganizationSite).gtm_id || '',
        meta_pixel_id: (site as ExtendedOrganizationSite).meta_pixel_id || '',
        google_ads_id: (site as ExtendedOrganizationSite).google_ads_id || '',
        head_scripts: (site as ExtendedOrganizationSite).head_scripts || '',
        body_scripts: (site as ExtendedOrganizationSite).body_scripts || '',
        hero_title: site.hero_title || '',
        hero_subtitle: site.hero_subtitle || '',
        show_about_on_home: site.show_about_on_home ?? false,
      });
    });

    return () => {
      isActive = false;
    };
  }, [site]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Convert empty strings to null for unique-constrained fields
      const dataToSave: OrganizationSiteSaveData = {
        ...formData,
        subdomain: formData.subdomain?.trim() || null,
        custom_domain: formData.custom_domain?.trim() || null,
        gtm_id: formData.gtm_id?.trim() || null,
        meta_pixel_id: formData.meta_pixel_id?.trim() || null,
        google_ads_id: formData.google_ads_id?.trim() || null,
        head_scripts: formData.head_scripts?.trim() || null,
        body_scripts: formData.body_scripts?.trim() || null,
      };

      if (site) {
        await updateSite.mutateAsync(dataToSave);
      } else {
        await createSite.mutateAsync(dataToSave);
      }
    } catch (error: unknown) {
      // If error is about unknown columns, retry without those fields (migration not yet applied)
      const errMsg = getErrorMessage(error);
      if (errMsg.includes('head_scripts') || errMsg.includes('body_scripts') || errMsg.includes('column')) {
        try {
          const rest: Omit<SiteFormData, 'head_scripts' | 'body_scripts'> = {
            ...formData,
          };
          delete (rest as Partial<SiteFormData>).head_scripts;
          delete (rest as Partial<SiteFormData>).body_scripts;
          const safeSave: OrganizationSiteSaveData = {
            ...rest,
            subdomain: formData.subdomain?.trim() || null,
            custom_domain: formData.custom_domain?.trim() || null,
            gtm_id: formData.gtm_id?.trim() || null,
            meta_pixel_id: formData.meta_pixel_id?.trim() || null,
            google_ads_id: formData.google_ads_id?.trim() || null,
          };
          if (site) {
            await updateSite.mutateAsync(safeSave);
          } else {
            await createSite.mutateAsync(safeSave);
          }
          toast.info('Scripts personalizados serão salvos após atualização do banco de dados.');
        } catch (retryError) {
          console.error('Error saving site (retry):', retryError);
        }
      } else {
        console.error('Error saving site:', error);
      }
    } finally {
      setIsSaving(false);
    }
  };


  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-6 space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-[600px] w-full" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout title="Configurações">
        <Card className="app-card">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-muted-foreground">
                <Globe className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Acesso restrito</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  As configurações do site estão disponíveis apenas para administradores.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  if (isSiteError) {
    return (
      <AppLayout title="Configurações do Site">
        <Card className="app-card">
          <CardContent className="flex flex-col items-center px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Não foi possível carregar seu site</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Seu site não foi removido. Tivemos um problema ao consultar as configurações agora.
            </p>
            <Button className="mt-5" variant="outline" onClick={() => void refetchSite()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Configurações do Site">
      <div className="space-y-6">
        {!site && (
          <Card data-tour="site-create-card" className="app-card mb-6">
            <CardContent className="p-6 text-center">
              <AnimatedIcon icon={GLOBE_JSON} size={48} trigger="loop" className="mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Crie seu site imobiliário</h2>
              <p className="text-muted-foreground mb-4">
                Configure seu site público para exibir seus imóveis e captar leads automaticamente.
              </p>
              <Button data-tour="site-create-button" onClick={() => createSite.mutateAsync({ is_active: false })}>
                Começar Configuração
              </Button>
            </CardContent>
          </Card>
        )}

        {site && (
          <Tabs data-tour="site-settings" value={siteActiveTab} onValueChange={setSiteActiveTab} className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <nav data-tour="site-settings-menu" className="app-card app-scrollbar flex w-full min-w-0 flex-nowrap gap-1.5 overflow-x-auto overflow-y-hidden p-1.5 lg:w-fit lg:max-w-[calc(100%-288px)]">
                <div className="flex flex-nowrap gap-1.5">
                  {siteSections.map((section) => {
                    const Icon = section.icon;
                    const isActive = siteActiveTab === section.value;

                    return (
                      <button
                        key={section.value}
                        data-tour={`site-tab-${section.value}`}
                        type="button"
                        title={`${section.label} - ${section.description}`}
                        onClick={() => setSiteActiveTab(section.value)}
                        className={cn(
                          "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] transition-colors",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground"
                        )}
                      >
                        <span className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px]",
                          isActive ? "bg-white/15" : "bg-[var(--app-surface-soft)]"
                        )}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="sr-only">
                          <span className="block text-sm font-medium">{section.label}</span>
                          <span className={cn(
                            "mt-0.5 line-clamp-2 block text-xs leading-snug",
                            isActive ? "text-white/75" : "text-muted-foreground"
                          )}>
                            {section.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

              </nav>

              <div className="flex shrink-0 items-center gap-2">
                {previewUrl ? (
                  <a data-tour="site-preview" href={previewUrl} target="_blank" rel="noopener noreferrer">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-4 text-foreground hover:bg-[var(--app-surface-hover)]"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Preview
                    </Button>
                  </a>
                ) : (
                  <Button
                    data-tour="site-preview"
                    type="button"
                    variant="ghost"
                    disabled
                    title="Publique o site e defina um slug para liberar a pré-visualização."
                    className="h-11 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-4"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Preview
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    data-tour="site-save-button"
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="h-11 min-w-0 rounded-[6px] px-4"
                  >
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Salvar alterações
                  </Button>
                )}
              </div>
            </div>

            <div className="min-w-0 space-y-6">
            <TabsContent data-tour="site-general-settings" value="general" className="mt-0">
              {generalView === 'domain-guide' ? (
                <DomainConnectionGuide
                  site={site}
                  domain={formData.custom_domain}
                  canManage={isAdmin}
                  workerCode={workerCode}
                  onDomainChange={(customDomain) => setFormData((current) => ({
                    ...current,
                    custom_domain: customDomain,
                  }))}
                  onBack={() => setGeneralView('dashboard')}
                />
              ) : (
                <SiteGeneralDashboard
                  site={site}
                  values={{
                    is_active: formData.is_active,
                    maintenance_mode: formData.maintenance_mode,
                    maintenance_message: formData.maintenance_message,
                    subdomain: formData.subdomain,
                    custom_domain: formData.custom_domain,
                    site_title: formData.site_title,
                    site_description: formData.site_description,
                  } satisfies SiteGeneralValues}
                  canManage={isAdmin}
                  publicUrl={publicUrl}
                  previewUrl={previewUrl}
                  onChange={(patch) => setFormData((current) => ({ ...current, ...patch }))}
                  onOpenDomainGuide={() => setGeneralView('domain-guide')}
                  onUploadLogo={async (url) => {
                    await updateSite.mutateAsync({ logo_url: url || null });
                  }}
                  onUploadFavicon={async (url) => {
                    await updateSite.mutateAsync({ favicon_url: url || null });
                  }}
                />
              )}
            </TabsContent>

            <TabsContent data-tour="site-appearance-settings" value="appearance" className="mt-0">
              <Card className="app-card">
                <CardHeader>
                  <CardTitle className="text-lg">Aparência</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 px-4 pb-5 md:px-6">
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                    <div className="app-card-soft border-0 p-4">
                      <h3 className="mb-4 text-sm font-medium">Logo no site</h3>
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                        <div className="space-y-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <Label>Largura máxima</Label>
                              <span className="text-sm font-medium text-muted-foreground">{site?.logo_width || 160}px</span>
                            </div>
                            <Slider
                              value={[site?.logo_width || 160]}
                              onValueChange={(value) => updateSite.mutate({ logo_width: value[0] })}
                              min={60}
                              max={800}
                              step={10}
                              className="w-full"
                              disabled={!isAdmin}
                            />
                          </div>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <Label>Altura máxima</Label>
                              <span className="text-sm font-medium text-muted-foreground">{site?.logo_height || 50}px</span>
                            </div>
                            <Slider
                              value={[site?.logo_height || 50]}
                              onValueChange={(value) => updateSite.mutate({ logo_height: value[0] })}
                              min={20}
                              max={200}
                              step={5}
                              className="w-full"
                              disabled={!isAdmin}
                            />
                          </div>
                        </div>

                        <div className="flex min-h-[112px] items-center justify-center rounded-[6px] bg-background p-4">
                          {site?.logo_url ? (
                            <Image
                              src={site.logo_url}
                              alt="Preview da logo"
                              width={Math.min(site.logo_width || 160, 190)}
                              height={Math.min(site.logo_height || 50, 72)}
                              className="object-contain"
                              unoptimized
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">Sem logo</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="app-card-soft border-0 p-4">
                      <h3 className="mb-4 text-sm font-medium">Tema e cores</h3>
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>Tema do site</Label>
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                type="button"
                                variant={formData.site_theme === 'dark' ? 'default' : 'outline'}
                                onClick={() => {
                                  setFormData({
                                    ...formData,
                                    site_theme: 'dark',
                                    background_color: '#0D0D0D',
                                    text_color: '#FFFFFF',
                                  });
                                }}
                                disabled={!isAdmin}
                                className="rounded-[6px]"
                              >
                                Escuro
                              </Button>
                              <Button
                                type="button"
                                variant={formData.site_theme === 'light' ? 'default' : 'outline'}
                                onClick={() => {
                                  setFormData({
                                    ...formData,
                                    site_theme: 'light',
                                    background_color: '#FFFFFF',
                                    text_color: '#1A1A1A',
                                  });
                                }}
                                disabled={!isAdmin}
                                className="rounded-[6px]"
                              >
                                Claro
                              </Button>
                            </div>
                          </div>

                          <div className="grid gap-4 sm:grid-cols-2">
                            {[
                              { label: 'Fundo', value: formData.background_color, key: 'background_color' },
                              { label: 'Fonte', value: formData.text_color, key: 'text_color' },
                              { label: 'Cards', value: formData.card_color, key: 'card_color' },
                              { label: 'Principal', value: formData.primary_color, key: 'primary_color' },
                              { label: 'Secundária', value: formData.secondary_color, key: 'secondary_color' },
                              { label: 'Destaque', value: formData.accent_color, key: 'accent_color' },
                            ].map((color) => (
                              <div key={color.key} className="space-y-2">
                                <Label>{color.label}</Label>
                                <div className="flex gap-2">
                                  <input
                                    type="color"
                                    value={color.value}
                                    onChange={(e) => setFormData({ ...formData, [color.key]: e.target.value })}
                                    className="h-10 w-12 cursor-pointer rounded-[6px] border"
                                    disabled={!isAdmin}
                                  />
                                  <Input
                                    value={color.value}
                                    onChange={(e) => setFormData({ ...formData, [color.key]: e.target.value })}
                                    className="min-w-0 flex-1"
                                    disabled={!isAdmin}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div
                          className="flex min-h-[220px] flex-col rounded-[6px] p-4"
                          style={{ backgroundColor: formData.background_color, color: formData.text_color }}
                        >
                          <p className="text-base font-semibold">Texto do site</p>
                          <p className="mt-1 text-sm opacity-70">Subtítulo do conteúdo</p>
                          <div className="mt-4 rounded-[6px] p-3" style={{ backgroundColor: formData.card_color }}>
                            <p className="text-sm font-semibold" style={{ color: '#1A1A1A' }}>Card do imóvel</p>
                            <p className="mt-1 text-xs" style={{ color: '#6B7280' }}>Resumo visual</p>
                          </div>
                          <div className="mt-auto flex flex-wrap gap-2 pt-4">
                            <span className="rounded-[6px] px-3 py-1.5 text-xs font-medium text-white" style={{ backgroundColor: formData.primary_color }}>Principal</span>
                            <span className="rounded-[6px] px-3 py-1.5 text-xs font-medium text-white" style={{ backgroundColor: formData.secondary_color }}>Secundária</span>
                            <span className="rounded-[6px] px-3 py-1.5 text-xs font-medium text-white" style={{ backgroundColor: formData.accent_color }}>Destaque</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="app-card-soft border-0 p-4">
                    <h3 className="mb-4 text-sm font-medium">Hero e banners</h3>
                    <div className="space-y-4">
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Título do hero</Label>
                          <Input
                            placeholder="Transformando seus sonhos em realidade!"
                            value={formData.hero_title}
                            onChange={(e) => setFormData({ ...formData, hero_title: e.target.value })}
                            disabled={!isAdmin}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Subtítulo do hero</Label>
                          <Input
                            placeholder="Encontre o imóvel perfeito para você"
                            value={formData.hero_subtitle}
                            onChange={(e) => setFormData({ ...formData, hero_subtitle: e.target.value })}
                            disabled={!isAdmin}
                          />
                        </div>
                      </div>

                      <div className="grid items-start gap-4 lg:grid-cols-2">
                        <ImageUpload
                          label="Imagem do hero"
                          description="Prévia preenchida como fundo da tela inicial"
                          value={site?.hero_image_url}
                          onChange={async (url) => {
                            await updateSite.mutateAsync({ hero_image_url: url });
                          }}
                          bucket="site-images"
                          path="sites"
                          assetType="hero"
                          maxSizeInMB={10}
                          aspectRatio="video"
                          previewFit="cover"
                          disabled={!isAdmin}
                        />

                        <ImageUpload
                          label="Banner das páginas internas"
                          description="Prévia preenchida como faixa larga do site"
                          value={site?.page_banner_url}
                          onChange={async (url) => {
                            await updateSite.mutateAsync({ page_banner_url: url });
                          }}
                          bucket="site-images"
                          path="sites"
                          assetType="banner"
                          maxSizeInMB={10}
                          aspectRatio="banner"
                          previewFit="cover"
                          disabled={!isAdmin}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="app-card-soft border-0 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <h3 className="text-sm font-medium">Marca d'água</h3>
                      <div className="flex items-center gap-3">
                        <span className={cn(
                          "rounded-[6px] px-2.5 py-1 text-xs font-medium",
                          site?.watermark_enabled ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
                        )}>
                          {site?.watermark_enabled ? 'Ativa' : 'Inativa'}
                        </span>
                        <Switch
                          checked={site?.watermark_enabled || false}
                          onCheckedChange={(checked) => updateSite.mutate({ watermark_enabled: checked })}
                          disabled={!isAdmin}
                        />
                      </div>
                    </div>

                    {site?.watermark_enabled && (
                      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.65fr)]">
                        <div className="space-y-4">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between gap-3">
                                <Label>Opacidade</Label>
                                <span className="text-sm font-medium text-muted-foreground">{site?.watermark_opacity || 20}%</span>
                              </div>
                              <Slider
                                value={[site?.watermark_opacity || 20]}
                                onValueChange={(value) => updateSite.mutate({ watermark_opacity: value[0] })}
                                min={5}
                                max={50}
                                step={5}
                                className="w-full"
                                disabled={!isAdmin}
                              />
                            </div>
                            <div className="space-y-3">
                              <div className="flex items-center justify-between gap-3">
                                <Label>Tamanho</Label>
                                <span className="text-sm font-medium text-muted-foreground">{site?.watermark_size || 80}px</span>
                              </div>
                              <Slider
                                value={[site?.watermark_size || 80]}
                                onValueChange={(value) => updateSite.mutate({ watermark_size: value[0] })}
                                min={40}
                                max={200}
                                step={10}
                                className="w-full"
                                disabled={!isAdmin}
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label>Posição</Label>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                              {[
                                { value: 'top-left', label: 'Sup. esq.' },
                                { value: 'top-right', label: 'Sup. dir.' },
                                { value: 'center', label: 'Centro' },
                                { value: 'bottom-left', label: 'Inf. esq.' },
                                { value: 'bottom-right', label: 'Inf. dir.' },
                              ].map(({ value, label }) => (
                                <Button
                                  key={value}
                                  type="button"
                                  variant={(site?.watermark_position || 'bottom-right') === value ? 'default' : 'outline'}
                                  size="sm"
                                  onClick={() => updateSite.mutate({ watermark_position: value })}
                                  disabled={!isAdmin}
                                  className="rounded-[6px] text-xs"
                                >
                                  {label}
                                </Button>
                              ))}
                            </div>
                          </div>

                          <ImageUpload
                            label="Logo da marca d'água"
                            description="Deixe em branco para usar a logo principal do site"
                            value={site?.watermark_logo_url}
                            onChange={async (url) => {
                              await updateSite.mutateAsync({ watermark_logo_url: url });
                            }}
                            bucket="site-images"
                            path="sites"
                            assetType="watermark"
                            aspectRatio="banner"
                            disabled={!isAdmin}
                          />
                        </div>

                        <div className="flex flex-col rounded-[6px] bg-background p-4">
                          <Label className="mb-2 block text-xs text-muted-foreground">Pré-visualização</Label>
                          <div className="relative min-h-[220px] overflow-hidden rounded-[6px] bg-gradient-to-br from-gray-300 to-gray-400">
                            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
                              Foto do imóvel
                            </div>
                            {(site?.watermark_logo_url || site?.logo_url) && (
                              <div
                                className={`absolute pointer-events-none ${
                                  (site?.watermark_position || 'bottom-right') === 'top-left' ? 'top-3 left-3' :
                                  (site?.watermark_position || 'bottom-right') === 'top-right' ? 'top-3 right-3' :
                                  (site?.watermark_position || 'bottom-right') === 'bottom-left' ? 'bottom-3 left-3' :
                                  (site?.watermark_position || 'bottom-right') === 'center' ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' :
                                  'bottom-3 right-3'
                                }`}
                                style={{ opacity: (site?.watermark_opacity || 20) / 100 }}
                              >
                                <Image
                                  src={site?.watermark_logo_url || site?.logo_url || ''}
                                  alt="Preview da marca d'água"
                                  width={Math.max(40, Math.min((site?.watermark_size || 80) * 1, 120))}
                                  height={Math.max(24, Math.min((site?.watermark_size || 80) * 0.4, 60))}
                                  className="object-contain"
                                  unoptimized
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent data-tour="site-contact-settings" value="contact" className="mt-0">
              <Card className="app-card">
                <CardHeader>
                  <CardTitle className="text-lg">Contato</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 px-4 pb-5 md:px-6">
                  <div className="app-card-soft border-0 p-4">
                    <h3 className="mb-4 text-sm font-medium">Canais de atendimento</h3>
                    <div className="grid gap-4 lg:grid-cols-3">
                      <div className="space-y-2">
                        <Label>WhatsApp</Label>
                        <Input
                          placeholder="(11) 99999-9999"
                          value={formData.whatsapp}
                          onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Telefone</Label>
                        <Input
                          placeholder="(11) 3333-3333"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>E-mail</Label>
                        <Input
                          type="email"
                          placeholder="contato@suaimobiliaria.com.br"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="app-card-soft border-0 p-4">
                    <h3 className="mb-4 text-sm font-medium">Endereço</h3>
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_120px]">
                      <div className="space-y-2">
                        <Label>Endereço</Label>
                        <Input
                          placeholder="Rua, número, complemento"
                          value={formData.address}
                          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Cidade</Label>
                        <Input
                          placeholder="São Paulo"
                          value={formData.city}
                          onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Estado</Label>
                        <Input
                          placeholder="SP"
                          value={formData.state}
                          onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent data-tour="site-social-settings" value="social" className="mt-0">
              <Card className="app-card">
                <CardHeader>
                  <CardTitle className="text-lg">Social</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 px-4 pb-5 md:px-6">
                  <div className="app-card-soft border-0 p-4">
                    <h3 className="mb-4 text-sm font-medium">Redes sociais</h3>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Instagram</Label>
                        <Input
                          placeholder="https://instagram.com/suaimobiliaria"
                          value={formData.instagram}
                          onChange={(e) => setFormData({ ...formData, instagram: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Facebook</Label>
                        <Input
                          placeholder="https://facebook.com/suaimobiliaria"
                          value={formData.facebook}
                          onChange={(e) => setFormData({ ...formData, facebook: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>YouTube</Label>
                        <Input
                          placeholder="https://youtube.com/@suaimobiliaria"
                          value={formData.youtube}
                          onChange={(e) => setFormData({ ...formData, youtube: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>LinkedIn</Label>
                        <Input
                          placeholder="https://linkedin.com/company/suaimobiliaria"
                          value={formData.linkedin}
                          onChange={(e) => setFormData({ ...formData, linkedin: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent data-tour="site-seo-settings" value="seo" className="mt-0">
              <Card className="app-card">
                <CardHeader>
                  <CardTitle className="text-lg">SEO</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 px-4 pb-5 md:px-6">
                  <div className="app-card-soft border-0 p-4">
                    <h3 className="mb-4 text-sm font-medium">Metatags</h3>
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="space-y-2">
                        <Label>Título SEO</Label>
                        <Input
                          placeholder="Sua Imobiliária - Os Melhores Imóveis da Cidade"
                          value={formData.seo_title}
                          onChange={(e) => setFormData({ ...formData, seo_title: e.target.value })}
                          disabled={!isAdmin}
                        />
                        <p className="text-xs text-muted-foreground">{formData.seo_title.length}/60</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Palavras-chave</Label>
                        <Input
                          placeholder="imóveis, casas, apartamentos, aluguel, venda"
                          value={formData.seo_keywords}
                          onChange={(e) => setFormData({ ...formData, seo_keywords: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="space-y-2 lg:col-span-2">
                        <Label>Descrição SEO</Label>
                        <Textarea
                          placeholder="Encontre o imóvel dos seus sonhos. Casas, apartamentos e terrenos..."
                          value={formData.seo_description}
                          onChange={(e) => setFormData({ ...formData, seo_description: e.target.value })}
                          rows={3}
                          disabled={!isAdmin}
                        />
                        <p className="text-xs text-muted-foreground">{formData.seo_description.length}/160</p>
                      </div>
                    </div>
                  </div>

                  <div className="app-card-soft border-0 p-4">
                    <h3 className="mb-4 text-sm font-medium">Rastreamento</h3>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Google Analytics ID</Label>
                        <Input
                          placeholder="G-XXXXXXXXXX"
                          value={formData.google_analytics_id}
                          onChange={(e) => setFormData({ ...formData, google_analytics_id: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Google Tag Manager (GTM) ID</Label>
                        <Input
                          placeholder="GTM-XXXXXXXX"
                          value={formData.gtm_id}
                          onChange={(e) => setFormData({ ...formData, gtm_id: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Meta Pixel ID</Label>
                        <Input
                          placeholder="123456789012345"
                          value={formData.meta_pixel_id}
                          onChange={(e) => setFormData({ ...formData, meta_pixel_id: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Google Ads ID</Label>
                        <Input
                          placeholder="AW-XXXXXXXXX"
                          value={formData.google_ads_id}
                          onChange={(e) => setFormData({ ...formData, google_ads_id: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="app-card-soft border-0 p-4">
                    <h3 className="mb-4 text-sm font-medium">Scripts personalizados</h3>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Scripts no &lt;head&gt;</Label>
                        <Textarea
                          placeholder="Cole aqui scripts que devem ir no <head> do site (ex: GTM, pixels, etc.)"
                          value={formData.head_scripts}
                          onChange={(e) => setFormData({ ...formData, head_scripts: e.target.value })}
                          rows={6}
                          disabled={!isAdmin}
                          className="font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Scripts no &lt;body&gt;</Label>
                        <Textarea
                          placeholder="Cole aqui scripts que devem ir no <body> do site (ex: noscript do GTM, chatbots, etc.)"
                          value={formData.body_scripts}
                          onChange={(e) => setFormData({ ...formData, body_scripts: e.target.value })}
                          rows={6}
                          disabled={!isAdmin}
                          className="font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent data-tour="site-menu-settings" value="menu" className="mt-0">
              <Card className="app-card">
                <CardHeader>
                  <CardTitle className="text-lg">Menu</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 px-4 pb-5 md:px-6">
                  <MenuTab />
                  <SearchFiltersTab />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent data-tour="site-about-settings" value="about" className="mt-0">
              <AboutTab
                formData={formData}
                setFormData={setFormData}
                site={site}
                isAdmin={isAdmin}
                onImageChange={async (url) => {
                  await updateSite.mutateAsync({ about_image_url: url });
                }}
              />

            </TabsContent>

            </div>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}
