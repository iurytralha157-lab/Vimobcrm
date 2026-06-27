'use client';

/* eslint-disable react/no-unescaped-entities */

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { useOrganizationSite, useCreateOrganizationSite, useUpdateOrganizationSite, type OrganizationSite } from "@/hooks/use-organization-site";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Globe, Palette, Phone, Share2, Search, ExternalLink, Copy, Check, Loader2, Maximize2, Droplets, Menu, Info } from "lucide-react";
import { AnimatedIcon } from "@/components/shared/icons/AnimatedIcon";
import GLOBE_JSON from "@/components/shared/icons/globe-icon.json";
import { MenuTab } from "@/components/features/site/MenuTab";
import { SearchFiltersTab } from "@/components/features/site/SearchFiltersTab";
import { AboutTab } from "@/components/features/site/AboutTab";
import { Slider } from "@/components/ui/slider";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { DnsVerificationStatus } from "@/components/features/site/DnsVerificationStatus";
import { ImageUpload } from "@/components/ui/image-upload";
import { cn } from "@/lib/utils";

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
    description: 'Status, domínio e dados básicos',
    icon: Globe,
  },
  {
    value: 'appearance',
    label: 'Aparência',
    description: 'Logo, tema, cores e imagens',
    icon: Palette,
  },
  {
    value: 'menu',
    label: 'Menu e busca',
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
  const { profile } = useAuth();
  const { data: site, isLoading } = useOrganizationSite();
  const createSite = useCreateOrganizationSite();
  const updateSite = useUpdateOrganizationSite();


  const [formData, setFormData] = useState<SiteFormData>({
    is_active: false,
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
  const [copied, setCopied] = useState(false);
  const [copiedWorker, setCopiedWorker] = useState(false);
  const siteActiveTab = normalizeSiteTab(searchParams.get('tab'));
  const setSiteActiveTab = (value: string) => {
    router.replace(value === 'general' ? '/settings/site' : `/settings/site?tab=${value}`);
  };
  const selectedSection = siteSections.find(section => section.value === siteActiveTab) || siteSections[0];

  useEffect(() => {
    if (!site) return;

    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setFormData({
        is_active: site.is_active,
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


  const getPublishedSiteUrl = () => {
    if (formData.custom_domain && site?.domain_verified) {
      return `https://${formData.custom_domain}`;
    }
    if (formData.subdomain) {
      return `https://vimob.vettercompany.com.br/sites/${formData.subdomain}`;
    }
    return null;
  };

  const copyPublishedLink = () => {
    const url = getPublishedSiteUrl();
    if (url) {
      navigator.clipboard.writeText(url);
      toast.success('Link copiado!');
    }
  };

  const getWorkerCode = () => {
    return `const BOT_AGENTS = [
  'facebookexternalhit',
  'whatsapp',
  'telegrambot',
  'twitterbot',
  'linkedinbot',
  'googlebot',
  'bingbot',
  'slackbot',
  'discordbot',
  'pinterestbot',
  'applebot',
  'redditbot',
  'embedly',
  'quora',
  'skypeuripreview',
  'facebot',
  'outbrain',
  'vkshare',
  'tumblr'
];

function isBot(userAgent) {
  const lower = (userAgent || '').toLowerCase();
  return BOT_AGENTS.some((bot) => lower.includes(bot));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const hostname = url.hostname;

    const configResponse = await fetch(
      'https://api.vimobcrm.com.br/v1/public/site/resolve?domain=' + encodeURIComponent(hostname),
      {
        method: 'GET'
      }
    );

    if (!configResponse.ok) {
      return new Response('Site não encontrado', { status: 404 });
    }

    const configEnvelope = await configResponse.json();
    if (!configEnvelope.found || !configEnvelope.site_config) {
      return new Response('Site não encontrado', { status: 404 });
    }

    const config = configEnvelope.site_config;
    const userAgent = request.headers.get('user-agent') || '';

    if (isBot(userAgent)) {
      const ssrUrl =
        'https://vimobcrm.com.br' + url.pathname + url.search;

      const ssrResponse = await fetch(ssrUrl);

      if (ssrResponse.ok) {
        return new Response(ssrResponse.body, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=300'
          }
        });
      }
    }

    const targetUrl = new URL(request.url);
    targetUrl.hostname = config.target || 'vimobe.lovable.app';

    const headers = new Headers(request.headers);
    headers.set('X-Forwarded-Host', hostname);

    const proxyRequest = new Request(targetUrl.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'follow'
    });

    return fetch(proxyRequest);
  }
};`;
  };

  const copyWorkerCode = () => {
    navigator.clipboard.writeText(getWorkerCode());
    setCopiedWorker(true);
    setTimeout(() => setCopiedWorker(false), 2000);
    toast.success('Código do Worker copiado!');
  };

  const copyDnsInstructions = () => {
    const instructions = `Configuração de Domínio Próprio via Cloudflare Workers para ${formData.custom_domain}:

1. Crie uma conta gratuita em https://cloudflare.com
2. Adicione seu domínio (${formData.custom_domain}) no Cloudflare
3. Altere os nameservers no seu registrador para os fornecidos pelo Cloudflare
4. No Cloudflare, vá em Workers and Routes > Create Worker
5. Cole o código do Worker gerado pelo sistema
6. Configure a rota: ${formData.custom_domain}/* → seu Worker

Código do Worker:
${getWorkerCode()}`;

    navigator.clipboard.writeText(instructions);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Instruções copiadas!');
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

  const isAdmin = profile?.role === 'admin';

  return (
    <AppLayout title="Configurações do Site">
      <div className="space-y-6">
        {!site && (
          <Card className="app-card mb-6">
            <CardContent className="p-6 text-center">
              <AnimatedIcon icon={GLOBE_JSON} size={48} trigger="loop" className="mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Crie seu site imobiliário</h2>
              <p className="text-muted-foreground mb-4">
                Configure seu site público para exibir seus imóveis e captar leads automaticamente.
              </p>
              <Button onClick={() => createSite.mutateAsync({ is_active: false })}>
                Começar Configuração
              </Button>
            </CardContent>
          </Card>
        )}

        {site && (
          <Tabs value={siteActiveTab} onValueChange={setSiteActiveTab} className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
              <aside className="app-card h-fit overflow-hidden xl:sticky xl:top-24">
                <div className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Site público</p>
                      <h2 className="mt-1 text-lg font-semibold">
                        {formData.site_title || 'Site imobiliário'}
                      </h2>
                    </div>
                    <div className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      formData.is_active
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {formData.is_active ? 'Ativo' : 'Inativo'}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Organize as informações públicas da imobiliária e publique seu catálogo de imóveis.
                  </p>
                </div>

                <div className="grid gap-2 p-2 sm:grid-cols-2 xl:grid-cols-1">
                  {siteSections.map((section) => {
                    const Icon = section.icon;
                    const isActive = siteActiveTab === section.value;

                    return (
                      <button
                        key={section.value}
                        type="button"
                        onClick={() => setSiteActiveTab(section.value)}
                        className={cn(
                          "flex min-h-[68px] items-center gap-3 rounded-[6px] px-3 py-3 text-left transition-colors",
                          isActive
                            ? "bg-[#FF4529] text-white"
                            : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                        )}
                      >
                        <span className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px]",
                          isActive ? "bg-white/15" : "bg-[var(--app-surface-soft)]"
                        )}>
                          {section.value === 'general' ? (
                            <AnimatedIcon icon={GLOBE_JSON} size={20} trigger="hover" />
                          ) : (
                            <Icon className="h-4 w-4" />
                          )}
                        </span>
                        <span className="min-w-0">
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

                <div className="space-y-2 p-4 pt-2">
                  <a
                    href={getPublishedSiteUrl() || `/site/preview?org=${profile?.organization_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <Button variant="outline" size="sm" className="w-full justify-center">
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Preview
                    </Button>
                  </a>
                  {getPublishedSiteUrl() && site?.is_active && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" onClick={copyPublishedLink}>
                        <Copy className="w-4 h-4 mr-2" />
                        Copiar
                      </Button>
                      <a href={getPublishedSiteUrl()!} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" className="w-full">
                          <ExternalLink className="w-4 h-4 mr-2" />
                          Visitar
                        </Button>
                      </a>
                    </div>
                  )}
                </div>
              </aside>

              <div className="min-w-0 space-y-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-[#FF4529]">{selectedSection.label}</p>
                    <h2 className="text-2xl font-semibold">{selectedSection.description}</h2>
                  </div>
                  {isAdmin && (
                    <Button onClick={handleSave} disabled={isSaving}>
                      {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Salvar alterações
                    </Button>
                  )}
                </div>

            <TabsContent value="general" className="mt-0 space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <Card className="app-card h-full">
                <CardHeader>
                  <CardTitle>Status do Site</CardTitle>
                  <CardDescription>Ative ou desative seu site público</CardDescription>
                </CardHeader>
                <CardContent className="px-4 md:px-6 pb-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Site Ativo</Label>
                      <p className="text-sm text-muted-foreground">
                        Quando ativo, seu site estará acessível publicamente
                      </p>
                    </div>
                    <Switch
                      checked={formData.is_active}
                      onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                      disabled={!isAdmin}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="app-card">
                <CardHeader>
                  <CardTitle>Domínio</CardTitle>
                  <CardDescription>Configure o endereço do seu site</CardDescription>
                </CardHeader>
                <CardContent className="px-4 md:px-6 pb-5 space-y-6">
                  {/* Link do Site Publicado */}
                  {formData.subdomain && site?.is_active && (
                    <Card className="app-card-soft border-emerald-500/20 bg-emerald-500/10">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-medium text-green-800 dark:text-green-200 flex items-center gap-2">
                              <Check className="w-4 h-4" />
                              Site Publicado
                            </h4>
                            <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                              Seu site está online e acessível
                            </p>
                            <a
                              href={getPublishedSiteUrl()!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-green-600 dark:text-green-400 hover:underline font-mono mt-2 block"
                            >
                              {getPublishedSiteUrl()}
                            </a>
                          </div>
                          <Button variant="outline" size="sm" onClick={copyPublishedLink} className="shrink-0">
                            <Copy className="w-4 h-4 mr-2" />
                            Copiar
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <div className="space-y-2">
                    <Label>Slug do Site</Label>
                    <p className="text-sm text-muted-foreground mb-2">
                      Identificador único do seu site (usado na URL)
                    </p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="sua-imobiliaria"
                        value={formData.subdomain}
                        onChange={(e) => setFormData({ ...formData, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                        disabled={!isAdmin}
                      />
                    </div>
                    {formData.subdomain && (
                      <p className="text-sm text-muted-foreground mt-1">
                        URL: <span className="font-mono">
                          {formData.custom_domain && site?.domain_verified
                            ? `https://${formData.custom_domain}`
                            : `https://vimob.vettercompany.com.br/sites/${formData.subdomain}`}
                        </span>
                      </p>
                    )}
                  </div>

                  <div className="border-t border-white/[0.055] pt-6 space-y-4">
                    <div className="space-y-2">
                      <Label>Domínio Próprio</Label>
                      <Input
                        placeholder="www.suaimobiliaria.com.br"
                        value={formData.custom_domain}
                        onChange={(e) => setFormData({ ...formData, custom_domain: e.target.value.toLowerCase() })}
                        disabled={!isAdmin}
                      />
                      <DnsVerificationStatus
                        domain={formData.custom_domain}
                        isVerified={site?.domain_verified || false}
                        verifiedAt={site?.domain_verified_at}
                      />
                    </div>

                    {formData.custom_domain && !site?.domain_verified && (
                      <Card className="app-card-soft">
                        <CardContent className="p-4 space-y-4">
                          <div className="flex items-start justify-between">
                            <h4 className="font-medium">Configurar via Cloudflare Workers</h4>
                            <Button variant="outline" size="sm" onClick={copyDnsInstructions}>
                              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </Button>
                          </div>

                          <div className="space-y-3 text-sm">
                            <div className="flex gap-3">
                              <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                              <p>Crie uma conta gratuita em <a href="https://cloudflare.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">cloudflare.com</a></p>
                            </div>
                            <div className="flex gap-3">
                              <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                              <p>Adicione seu domínio (<strong>{formData.custom_domain}</strong>) e altere os nameservers no seu registrador para os fornecidos pelo Cloudflare</p>
                            </div>
                            <div className="flex gap-3">
                              <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                              <p>No painel do Cloudflare, vá em <strong>Workers and Routes</strong> → <strong>Create Worker</strong></p>
                            </div>
                            <div className="flex gap-3">
                              <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">4</span>
                              <div className="flex-1">
                                <p className="mb-2">Cole o código abaixo no editor do Worker:</p>
                                <div className="relative">
                                  <pre className="bg-background p-3 rounded text-xs overflow-auto max-h-80 border text-left whitespace-pre">{getWorkerCode()}</pre>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={copyWorkerCode}
                                    className="absolute top-2 right-2"
                                  >
                                    {copiedWorker ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                  </Button>
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-3">
                              <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">5</span>
                              <div className="flex-1 space-y-2">
                                <p>Configure a Rota para o seu domínio acessar o Worker:</p>
                                <ul className="list-disc pl-5 space-y-1">
                                  <li>No menu do site, vá em <strong>Workers Routes</strong> → <strong>Add Route</strong></li>
                                  <li>Em Route, coloque exato: <code className="bg-background px-1 py-0.5 rounded text-xs">{`${formData.custom_domain}/*`}</code></li>
                                  <li>Em Worker, selecione o worker criado no passo 3.</li>
                                  <li>Se quiser com www, crie outra rota: <code className="bg-background px-1 py-0.5 rounded text-xs">{`www.${formData.custom_domain}/*`}</code></li>
                                </ul>
                                <div className="mt-2 text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-2 rounded text-xs border border-amber-200 dark:border-amber-900 border-l-2">
                                  <strong>⚠️ Importante:</strong> Se você abrir o botão "Visualizar" no Cloudflare (link `.workers.dev`), ele vai mostrar <strong>"Site não encontrado"</strong>. Isso é perfeitamente <strong>normal</strong> e indica que o código está funcionando! O sistema só reconhece o site quando acessado pelo seu domínio real configurado na rota.
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="bg-background rounded p-3 text-xs text-muted-foreground space-y-1">
                            <p>✅ SSL automático e gratuito pelo Cloudflare</p>
                            <p>✅ Plano gratuito: 100.000 requests/dia</p>
                            <p>✅ Propagação de DNS pode levar até 72h</p>
                            <p>
                              🔗 Verifique em{' '}
                              <a href="https://dnschecker.org" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                                dnschecker.org
                              </a>
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </CardContent>
              </Card>
              </div>

              <Card className="app-card">
                <CardHeader>
                  <CardTitle>Informações Básicas</CardTitle>
                </CardHeader>
                <CardContent className="px-4 md:px-6 pb-5 space-y-4">
                  <div className="space-y-2">
                    <Label>Título do Site</Label>
                    <Input
                      placeholder="Nome da sua imobiliária"
                      value={formData.site_title}
                      onChange={(e) => setFormData({ ...formData, site_title: e.target.value })}
                      disabled={!isAdmin}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição</Label>
                    <Textarea
                      placeholder="Uma breve descrição da sua imobiliária..."
                      value={formData.site_description}
                      onChange={(e) => setFormData({ ...formData, site_description: e.target.value })}
                      rows={3}
                      disabled={!isAdmin}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="appearance" className="space-y-6">
              <Card className="app-card">
                <CardHeader>
                  <CardTitle>Logo e Favicon</CardTitle>
                </CardHeader>
                <CardContent className="px-4 md:px-6 pb-5 space-y-6">
                  <div className="grid sm:grid-cols-2 gap-6">
                    <ImageUpload
                      label="Logo"
                      description="PNG ou JPG recomendado"
                      value={site?.logo_url}
                      onChange={async (url) => {
                        if (url) {
                          await updateSite.mutateAsync({ logo_url: url });
                        } else {
                          await updateSite.mutateAsync({ logo_url: null });
                        }
                      }}
                      bucket="site-images"
                      path="sites"
                      assetType="logo"
                      disabled={!isAdmin}
                      aspectRatio="banner"
                    />

                    <ImageUpload
                      label="Favicon"
                      description="Ícone do navegador (ICO ou PNG)"
                      value={site?.favicon_url}
                      onChange={async (url) => {
                        if (url) {
                          await updateSite.mutateAsync({ favicon_url: url });
                        } else {
                          await updateSite.mutateAsync({ favicon_url: null });
                        }
                      }}
                      bucket="site-images"
                      path="sites"
                      assetType="favicon"
                      disabled={!isAdmin}
                      aspectRatio="square"
                      className="max-w-[180px]"
                    />
                  </div>

                </CardContent>
              </Card>

              {/* Logo Size Controls */}
              <Card className="app-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Maximize2 className="h-5 w-5" />
                    Tamanho da Logo no Site
                  </CardTitle>
                  <CardDescription>
                    Ajuste as dimensões da logo exibida no site público (em pixels)
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-4 md:px-6 pb-5">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Left: Sliders */}
                    <div className="space-y-4">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label>Largura Máxima</Label>
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
                        <div className="flex items-center justify-between">
                          <Label>Altura Máxima</Label>
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

                    {/* Right: Preview */}
                    {site?.logo_url && (
                      <div className="p-4 bg-white/[0.045] rounded-lg flex flex-col">
                        <Label className="text-xs text-muted-foreground mb-2 block">Pré-visualização</Label>
                        <div className="flex items-center justify-center h-[96px] bg-black/20 rounded border border-white/[0.055] overflow-hidden">
                          <Image
                            src={site.logo_url}
                            alt="Preview"
                            width={Math.min(site.logo_width || 160, 180)}
                            height={Math.min(site.logo_height || 50, 64)}
                            className="object-contain"
                            unoptimized
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="app-card">
                <CardHeader>
                  <CardTitle>Tema e Cores</CardTitle>
                  <CardDescription>Personalize o tema e as cores do seu site</CardDescription>
                </CardHeader>
                <CardContent className="px-4 md:px-6 pb-5 space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Left: Settings */}
                    <div className="space-y-6">
                      {/* Theme Selector */}
                      <div className="space-y-3">
                        <Label>Tema do Site</Label>
                        <div className="flex gap-3">
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
                            className="flex-1"
                          >
                            🌙 Escuro
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
                            className="flex-1"
                          >
                            ☀️ Claro
                          </Button>
                        </div>
                      </div>

                      {/* Background & Text Colors */}
                      <div className="grid sm:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <Label>Cor de Fundo</Label>
                          <div className="flex gap-2">
                            <input
                              type="color"
                              value={formData.background_color}
                              onChange={(e) => setFormData({ ...formData, background_color: e.target.value })}
                              className="w-12 h-10 rounded border cursor-pointer"
                              disabled={!isAdmin}
                            />
                            <Input
                              value={formData.background_color}
                              onChange={(e) => setFormData({ ...formData, background_color: e.target.value })}
                              className="flex-1"
                              disabled={!isAdmin}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Cor da Fonte</Label>
                          <div className="flex gap-2">
                            <input
                              type="color"
                              value={formData.text_color}
                              onChange={(e) => setFormData({ ...formData, text_color: e.target.value })}
                              className="w-12 h-10 rounded border cursor-pointer"
                              disabled={!isAdmin}
                            />
                            <Input
                              value={formData.text_color}
                              onChange={(e) => setFormData({ ...formData, text_color: e.target.value })}
                              className="flex-1"
                              disabled={!isAdmin}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Cor dos Cards</Label>
                        <div className="flex gap-2">
                          <input
                            type="color"
                            value={formData.card_color}
                            onChange={(e) => setFormData({ ...formData, card_color: e.target.value })}
                            className="w-12 h-10 rounded border cursor-pointer"
                            disabled={!isAdmin}
                          />
                          <Input
                            value={formData.card_color}
                            onChange={(e) => setFormData({ ...formData, card_color: e.target.value })}
                            className="flex-1"
                            disabled={!isAdmin}
                          />
                        </div>
                      </div>

                      {/* Brand Colors */}
                      <div className="grid sm:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>Cor Principal</Label>
                          <div className="flex gap-2">
                            <input
                              type="color"
                              value={formData.primary_color}
                              onChange={(e) => setFormData({ ...formData, primary_color: e.target.value })}
                              className="w-12 h-10 rounded border cursor-pointer"
                              disabled={!isAdmin}
                            />
                            <Input
                              value={formData.primary_color}
                              onChange={(e) => setFormData({ ...formData, primary_color: e.target.value })}
                              className="flex-1"
                              disabled={!isAdmin}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Cor Secundária</Label>
                          <div className="flex gap-2">
                            <input
                              type="color"
                              value={formData.secondary_color}
                              onChange={(e) => setFormData({ ...formData, secondary_color: e.target.value })}
                              className="w-12 h-10 rounded border cursor-pointer"
                              disabled={!isAdmin}
                            />
                            <Input
                              value={formData.secondary_color}
                              onChange={(e) => setFormData({ ...formData, secondary_color: e.target.value })}
                              className="flex-1"
                              disabled={!isAdmin}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Cor de Destaque</Label>
                          <div className="flex gap-2">
                            <input
                              type="color"
                              value={formData.accent_color}
                              onChange={(e) => setFormData({ ...formData, accent_color: e.target.value })}
                              className="w-12 h-10 rounded border cursor-pointer"
                              disabled={!isAdmin}
                            />
                            <Input
                              value={formData.accent_color}
                              onChange={(e) => setFormData({ ...formData, accent_color: e.target.value })}
                              className="flex-1"
                              disabled={!isAdmin}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right: Preview */}
                    <div className="p-4 bg-white/[0.045] rounded-lg flex flex-col">
                      <p className="text-sm text-muted-foreground mb-3">Pré-visualização:</p>
                      <div
                        className="p-6 rounded-lg flex-1"
                        style={{ backgroundColor: formData.background_color, color: formData.text_color }}
                      >
                        <p className="text-lg font-semibold mb-2">Texto do site</p>
                        <p className="text-sm opacity-70 mb-4">Subtítulo ou descrição do conteúdo</p>
                        <div
                          className="p-4 rounded-xl mb-4"
                          style={{ backgroundColor: formData.card_color }}
                        >
                          <p className="text-sm font-semibold" style={{ color: '#1A1A1A' }}>Exemplo de Card</p>
                          <p className="text-xs mt-1" style={{ color: '#6B7280' }}>Conteúdo dentro do card</p>
                        </div>
                        <div className="flex gap-3 flex-wrap">
                          <div
                            className="px-4 py-2 rounded-full text-white text-sm font-medium"
                            style={{ backgroundColor: formData.primary_color }}
                          >
                            Botão Principal
                          </div>
                          <div
                            className="px-4 py-2 rounded-full text-white text-sm font-medium"
                            style={{ backgroundColor: formData.secondary_color }}
                          >
                            Secundário
                          </div>
                          <div
                            className="px-4 py-2 rounded-full text-white text-sm font-medium"
                            style={{ backgroundColor: formData.accent_color }}
                          >
                            Destaque
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="app-card">
                <CardHeader>
                  <CardTitle>Hero (Banner Principal)</CardTitle>
                  <CardDescription>Configure a imagem e textos da página inicial</CardDescription>
                </CardHeader>
                <CardContent className="px-4 md:px-6 pb-5 space-y-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <ImageUpload
                      label="Imagem do Hero (Tela Inicial)"
                      description="PNG, JPG ou WEBP até 10MB"
                      value={site?.hero_image_url}
                      onChange={async (url) => {
                        await updateSite.mutateAsync({ hero_image_url: url });
                      }}
                      bucket="site-images"
                      path="sites"
                      assetType="hero"
                      maxSizeInMB={10}
                      aspectRatio="video"
                      disabled={!isAdmin}
                    />

                    <ImageUpload
                      label="Banner das Páginas Internas"
                      description="Exibido no topo das páginas de listagem e contato"
                      value={site?.page_banner_url}
                      onChange={async (url) => {
                        await updateSite.mutateAsync({ page_banner_url: url });
                      }}
                      bucket="site-images"
                      path="sites"
                      assetType="banner"
                      maxSizeInMB={10}
                      aspectRatio="banner"
                      disabled={!isAdmin}
                    />
                  </div>


                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Título do Hero</Label>
                      <Input
                        placeholder="Transformando seus sonhos em realidade!"
                        value={formData.hero_title}
                        onChange={(e) => setFormData({ ...formData, hero_title: e.target.value })}
                        disabled={!isAdmin}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Subtítulo do Hero</Label>
                      <Input
                        placeholder="Encontre o imóvel perfeito para você"
                        value={formData.hero_subtitle}
                        onChange={(e) => setFormData({ ...formData, hero_subtitle: e.target.value })}
                        disabled={!isAdmin}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="app-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Droplets className="h-5 w-5" />
                    Marca d'Água
                  </CardTitle>
                  <CardDescription>
                    Adicione uma marca d'água sutil nas fotos dos imóveis para proteger seu conteúdo
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-4 md:px-6 pb-5 space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Ativar marca d'água</Label>
                      <p className="text-sm text-muted-foreground">
                        Quando ativo, a logo será exibida sobre as fotos dos imóveis
                      </p>
                    </div>
                    <Switch
                      checked={site?.watermark_enabled || false}
                      onCheckedChange={(checked) => updateSite.mutate({ watermark_enabled: checked })}
                      disabled={!isAdmin}
                    />
                  </div>

                  {site?.watermark_enabled && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Left: Settings */}
                      <div className="space-y-6">
                        <div className="grid sm:grid-cols-2 gap-6">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
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
                            <p className="text-xs text-muted-foreground">
                              Valores menores = mais sutil. Recomendado: 15-25%
                            </p>
                          </div>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <Label>Tamanho (largura)</Label>
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
                            <p className="text-xs text-muted-foreground">
                              Ajuste o tamanho da logo na exibição
                            </p>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <Label>Posição da marca d'água</Label>
                          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                            {[
                              { value: 'top-left', label: '↖ Sup. Esq.' },
                              { value: 'top-right', label: '↗ Sup. Dir.' },
                              { value: 'center', label: '⊕ Centro' },
                              { value: 'bottom-left', label: '↙ Inf. Esq.' },
                              { value: 'bottom-right', label: '↘ Inf. Dir.' },
                            ].map(({ value, label }) => (
                              <Button
                                key={value}
                                variant={(site?.watermark_position || 'bottom-right') === value ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => updateSite.mutate({ watermark_position: value })}
                                disabled={!isAdmin}
                                className="text-xs"
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
                          disabled={!isAdmin}
                        />

                      </div>

                      {/* Right: Preview */}
                      {(site?.watermark_logo_url || site?.logo_url) && (
                        <div className="p-4 bg-white/[0.045] rounded-lg flex flex-col">
                          <Label className="text-xs text-muted-foreground mb-2 block">Pré-visualização (como aparece no site)</Label>
                          <div className="relative flex-1 min-h-[200px] bg-gradient-to-br from-gray-300 to-gray-400 rounded overflow-hidden">
                            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
                              Foto do Imóvel
                            </div>
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
                                alt="Watermark preview"
                                width={Math.max(40, Math.min((site?.watermark_size || 80) * 1, 120))}
                                height={Math.max(24, Math.min((site?.watermark_size || 80) * 0.4, 60))}
                                className="object-contain"
                                unoptimized
                              />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            💡 No download, a marca d'água será aplicada em padrão repetido para proteção
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="contact" className="space-y-6">
              <Card className="app-card">
                <CardHeader>
                  <CardTitle>Informações de Contato</CardTitle>
                  <CardDescription>Esses dados aparecerão no site e nos formulários</CardDescription>
                </CardHeader>
                <CardContent className="px-4 md:px-6 pb-5 space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
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
                  <div className="space-y-2">
                    <Label>Endereço</Label>
                    <Input
                      placeholder="Rua, número, complemento"
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      disabled={!isAdmin}
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
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
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="social" className="space-y-6">
              <Card className="app-card">
                <CardHeader>
                  <CardTitle>Redes Sociais</CardTitle>
                  <CardDescription>Links para suas redes sociais</CardDescription>
                </CardHeader>
                <CardContent className="px-4 md:px-6 pb-5 space-y-4">
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
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="seo" className="space-y-6">
              <Card className="app-card">
                <CardHeader>
                  <CardTitle>SEO e Metatags</CardTitle>
                  <CardDescription>Otimize seu site para mecanismos de busca</CardDescription>
                </CardHeader>
                <CardContent className="px-4 md:px-6 pb-5 space-y-4">
                  <div className="space-y-2">
                    <Label>Título SEO</Label>
                    <Input
                      placeholder="Sua Imobiliária - Os Melhores Imóveis da Cidade"
                      value={formData.seo_title}
                      onChange={(e) => setFormData({ ...formData, seo_title: e.target.value })}
                      disabled={!isAdmin}
                    />
                    <p className="text-xs text-muted-foreground">
                      Máximo recomendado: 60 caracteres ({formData.seo_title.length}/60)
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição SEO</Label>
                    <Textarea
                      placeholder="Encontre o imóvel dos seus sonhos. Casas, apartamentos e terrenos..."
                      value={formData.seo_description}
                      onChange={(e) => setFormData({ ...formData, seo_description: e.target.value })}
                      rows={3}
                      disabled={!isAdmin}
                    />
                    <p className="text-xs text-muted-foreground">
                      Máximo recomendado: 160 caracteres ({formData.seo_description.length}/160)
                    </p>
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
                    <p className="text-xs text-muted-foreground">
                      Ex: GTM-TTH333RS
                    </p>
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
                </CardContent>
              </Card>

              <Card className="app-card">
                <CardHeader>
                  <CardTitle>Scripts Personalizados</CardTitle>
                  <CardDescription>Cole aqui scripts de rastreamento, chatbots, etc. que serão injetados no site</CardDescription>
                </CardHeader>
                <CardContent className="px-4 md:px-6 pb-5 space-y-4">
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
                    <p className="text-xs text-muted-foreground">
                      Scripts JavaScript, tags de rastreamento, etc. que serão inseridos no &lt;head&gt;
                    </p>
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
                    <p className="text-xs text-muted-foreground">
                      Tags &lt;noscript&gt;, chatbots, widgets, etc. que serão inseridos no &lt;body&gt;
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="menu" className="space-y-6">
              <MenuTab />
              <SearchFiltersTab />
            </TabsContent>

            <TabsContent value="about" className="space-y-6">
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
            </div>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}
