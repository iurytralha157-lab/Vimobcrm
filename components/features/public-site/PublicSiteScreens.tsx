/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import {
  Award,
  Bath,
  BedDouble,
  Building2,
  Car,
  CheckCircle2,
  CircleDollarSign,
  Home,
  House,
  KeyRound,
  Mail,
  MapPin,
  Maximize2,
  Phone,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  SquareStack,
  Users,
} from "lucide-react";

import type {
  PublicHomeData,
  PublicPropertiesData,
  PublicProperty,
  PublicSiteConfig,
  SiteSearchFilter,
} from "@/lib/api/public-site-server";
import { PublicContactForm } from "./PublicContactForm";
import { PublicPropertyCarousel } from "./PublicPropertyCarousel";
import { PublicPropertyCard } from "./PublicPropertyCard";
import {
  DEFAULT_HERO_IMAGE,
  buildSiteHref,
  formatPrice,
  getPropertyCode,
  getPropertyLocation,
  getPropertyPrice,
  getPropertyTitle,
  getSiteDescription,
  getSiteTitle,
  getThemeTokens,
} from "./public-site-utils";

const defaultStats = [
  { value: "500+", label: "Imoveis negociados" },
  { value: "98%", label: "Clientes satisfeitos" },
  { value: "15+", label: "Anos de experiencia" },
  { value: "50+", label: "Parceiros" },
];

const defaultCheckmarks = ["Atendimento personalizado", "Imoveis verificados", "Suporte completo"];

const defaultFeatures = [
  {
    icon: "building",
    title: "Curadoria de imoveis",
    description: "Opcoes selecionadas para quem quer comprar, vender ou alugar com tranquilidade.",
  },
  {
    icon: "users",
    title: "Atendimento consultivo",
    description: "Equipe preparada para entender o seu momento e indicar o caminho mais seguro.",
  },
  {
    icon: "award",
    title: "Experiencia de mercado",
    description: "Processo claro desde o primeiro contato ate a conclusao da negociacao.",
  },
  {
    icon: "shield",
    title: "Seguranca no processo",
    description: "Informacoes organizadas e acompanhamento proximo em cada etapa.",
  },
];

const iconMap = {
  award: Award,
  building: Building2,
  heart: Home,
  shield: ShieldCheck,
  users: Users,
};

const homeCategoryShortcuts = [
  { label: "Casa", href: "/imoveis?tipo=Casa", icon: House },
  { label: "Apartamento", href: "/imoveis?tipo=Apartamento", icon: Building2 },
  { label: "Cobertura", href: "/imoveis?tipo=Cobertura", icon: SquareStack },
  { label: "Estúdio", href: "/imoveis?tipo=Estudio", icon: KeyRound },
];

const purposeOptions = [
  { value: "venda", label: "Venda" },
  { value: "locacao", label: "Locação" },
  { value: "venda_locacao", label: "Venda e locação" },
  { value: "temporada", label: "Temporada" },
];

const numericOptions = [
  { value: "1", label: "1+" },
  { value: "2", label: "2+" },
  { value: "3", label: "3+" },
  { value: "4", label: "4+" },
  { value: "5", label: "5+" },
];

export function PublicHomeScreen({
  basePath,
  data,
  searchFilters,
  site,
}: Readonly<{
  basePath: string;
  data: PublicHomeData;
  searchFilters: SiteSearchFilter[];
  site: PublicSiteConfig;
}>) {
  const tokens = getThemeTokens(site);
  const heroImage = site.hero_image_url || data.featured[0]?.imagem_principal || DEFAULT_HERO_IMAGE;
  const title = "Encontre o imóvel dos seus sonhos com exclusividade";
  const subtitle = site.hero_subtitle || getSiteDescription(site);
  const activeFilters = searchFilters.length > 0
    ? searchFilters
    : [
        { filter_key: "search", label: "Buscar", position: 0 },
        { filter_key: "tipo", label: "Tipo de imovel", position: 1 },
        { filter_key: "finalidade", label: "Finalidade", position: 2 },
      ];

  return (
    <>
      <section className="relative min-h-[calc(100vh-80px)] overflow-hidden">
        <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" loading="eager" />
        <div className="absolute inset-0 bg-black/56" />
        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-80px)] w-full max-w-7xl flex-col items-center justify-center px-4 py-24 text-center text-white sm:px-6 lg:px-8">
          <h1 className="mx-auto max-w-5xl text-4xl font-light leading-tight tracking-normal sm:text-5xl lg:text-6xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-white/78 sm:text-lg">{subtitle}</p>

          <form
            action={buildSiteHref(basePath, "/imoveis")}
            className="site-float mt-10 grid w-full max-w-5xl gap-3 rounded-[14px] bg-black/46 p-3 text-left backdrop-blur-xl sm:p-4 md:grid-cols-4"
          >
            {activeFilters.map((filter) => (
              <SearchFilterField
                key={filter.filter_key}
                filter={filter}
                propertyTypes={data.types}
                cities={data.cities}
              />
            ))}
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-semibold text-white transition hover:brightness-110"
              style={{ backgroundColor: tokens.primary }}
            >
              <Search className="h-4 w-4" />
              Buscar
            </button>
          </form>

          <div className="mt-7 grid w-full max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4">
            {homeCategoryShortcuts.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={buildSiteHref(basePath, item.href)}
                  className="group flex items-center justify-center gap-2 rounded-[12px] bg-white/12 px-3 py-3 text-sm font-medium text-white backdrop-blur-md transition hover:-translate-y-1 hover:bg-white/20"
                >
                  <Icon className="h-4 w-4 transition group-hover:scale-110" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
        <style>{`
          @keyframes site-float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-6px); }
          }
          .site-float {
            animation: site-float 7s ease-in-out infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .site-float { animation: none; }
          }
        `}</style>
      </section>

      <PropertySection
        basePath={basePath}
        eyebrow="Exclusivos"
        properties={data.exclusive}
        site={site}
        title="Imoveis que merecem atencao especial"
      />
      <PropertySection
        basePath={basePath}
        eyebrow="Destaques"
        properties={data.featured}
        site={site}
        title="Selecionados pela equipe"
      />
      <PropertySection
        basePath={basePath}
        eyebrow="Portfolio"
        properties={data.latest}
        site={site}
        title="Todos os imoveis disponiveis"
      />

      {site.show_about_on_home ? (
        <AboutContent basePath={basePath} site={site} compact />
      ) : null}

      <section className="px-4 py-16 sm:px-6 lg:px-8" style={{ backgroundColor: tokens.primary }}>
        <div className="mx-auto max-w-4xl text-center text-white">
          <h2 className="text-3xl font-semibold sm:text-4xl">Nao encontrou o que procura?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-white/82">
            Fale com a equipe e receba indicacoes alinhadas com seu perfil.
          </p>
          <Link
            href={buildSiteHref(basePath, "/contato")}
            className="mt-8 inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold"
            style={{ color: tokens.primary }}
          >
            Fale conosco
          </Link>
        </div>
      </section>
    </>
  );
}

export function PublicPropertiesScreen({
  basePath,
  data,
  query,
  site,
}: Readonly<{
  basePath: string;
  data: PublicPropertiesData;
  query: Record<string, string | string[] | undefined>;
  site: PublicSiteConfig;
}>) {
  const tokens = getThemeTokens(site);
  const banner = site.page_banner_url || site.hero_image_url || DEFAULT_HERO_IMAGE;
  const hasFilters = Boolean(
    stringQuery(query.search) ||
      stringQuery(query.tipo) ||
      stringQuery(query.finalidade) ||
      stringQuery(query.cidade) ||
      stringQuery(query.bairro) ||
      stringQuery(query.min_price) ||
      stringQuery(query.max_price) ||
      stringQuery(query.quartos) ||
      stringQuery(query.suites) ||
      stringQuery(query.banheiros) ||
      stringQuery(query.vagas) ||
      stringQuery(query.mobilia),
  );

  return (
    <>
      <PageHero backgroundImage={banner} eyebrow="Imoveis" title={getPropertiesHeroTitle(query)} />
      <section className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[290px_1fr] lg:px-8">
        <PublicPropertiesFilterSidebar basePath={basePath} data={data} query={query} site={site} />

        <div className="min-w-0">
          <div className="mb-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-medium opacity-70" style={{ color: tokens.foreground }}>
                {data.total} imoveis encontrados
              </p>
              <h2 className="text-2xl font-normal" style={{ color: tokens.foreground }}>
                Resultado da busca
              </h2>
            </div>
            {hasFilters ? (
              <Link href={buildSiteHref(basePath, "/imoveis")} className="text-sm font-semibold" style={{ color: tokens.primary }}>
                Limpar filtros
              </Link>
            ) : null}
          </div>

          {data.properties.length > 0 ? (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {data.properties.map((property) => (
                <PublicPropertyCard key={property.id} basePath={basePath} property={property} site={site} />
              ))}
            </div>
          ) : (
            <EmptyState title="Nenhum imovel encontrado" description="Tente ajustar os filtros ou fale com a equipe." />
          )}

          {data.totalPages > 1 ? (
            <Pagination basePath={basePath} currentPage={data.page} query={query} totalPages={data.totalPages} />
          ) : null}
        </div>
      </section>
    </>
  );
}

function PublicPropertiesFilterSidebar({
  basePath,
  data,
  query,
  site,
}: Readonly<{
  basePath: string;
  data: PublicPropertiesData;
  query: Record<string, string | string[] | undefined>;
  site: PublicSiteConfig;
}>) {
  const tokens = getThemeTokens(site);
  const inputClass = "public-site-filter-field h-11 w-full rounded-[10px] border px-3 text-sm outline-none transition";
  const selectClass = `${inputClass} appearance-none pr-9`;

  return (
    <aside className="h-fit rounded-[14px] p-5 lg:sticky lg:top-32" style={{ backgroundColor: tokens.card, color: tokens.foreground }}>
      <div className="mb-5 flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px]" style={{ backgroundColor: `${tokens.primary}18`, color: tokens.primary }}>
          <SlidersHorizontal className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">Filtros</h2>
          <p className="text-xs opacity-60">Refine por cidade, valor e perfil.</p>
        </div>
      </div>

      <form action={buildSiteHref(basePath, "/imoveis")} className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wide opacity-70">Buscar</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-52" />
            <input
              name="search"
              defaultValue={stringQuery(query.search)}
              placeholder="Codigo, condominio, bairro ou cidade"
              className={`${inputClass} pl-9`}
            />
          </div>
        </label>

        <FilterSelect className={selectClass} label="Cidade" name="cidade" options={data.cities} placeholder="Todas as cidades" value={stringQuery(query.cidade)} />
        <FilterSelect className={selectClass} label="Bairro" name="bairro" options={data.neighborhoods} placeholder="Todos os bairros" value={stringQuery(query.bairro)} />

        <div>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wide opacity-70">Faixa de preço</span>
          <div className="grid grid-cols-2 gap-3">
            <input name="min_price" defaultValue={stringQuery(query.min_price)} placeholder="Minimo" className={inputClass} inputMode="numeric" />
            <input name="max_price" defaultValue={stringQuery(query.max_price)} placeholder="Maximo" className={inputClass} inputMode="numeric" />
          </div>
        </div>

        <div className="rounded-[12px] border border-white/10 p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <CircleDollarSign className="h-4 w-4" style={{ color: tokens.primary }} />
            Mais filtros
          </div>
          <div className="space-y-3">
            <FilterSelect className={selectClass} label="Tipo de imóvel" name="tipo" options={data.types} placeholder="Todos os tipos" value={stringQuery(query.tipo)} />
            <FilterSelect className={selectClass} label="Finalidade" name="finalidade" options={buildPurposeOptions(data.purposes)} placeholder="Todas" value={stringQuery(query.finalidade)} />
            <FilterSelect className={selectClass} label="Quartos" name="quartos" options={numericOptions} placeholder="Quartos" value={stringQuery(query.quartos)} />
            <FilterSelect className={selectClass} label="Suites" name="suites" options={numericOptions} placeholder="Suites" value={stringQuery(query.suites)} />
            <FilterSelect className={selectClass} label="Banheiros" name="banheiros" options={numericOptions} placeholder="Banheiros" value={stringQuery(query.banheiros)} />
            <FilterSelect className={selectClass} label="Vagas" name="vagas" options={numericOptions} placeholder="Vagas" value={stringQuery(query.vagas)} />
            <FilterSelect
              className={selectClass}
              label="Mobilia"
              name="mobilia"
              options={[
                { value: "mobiliado", label: "Mobiliado" },
                { value: "nao", label: "Sem mobilia" },
              ]}
              placeholder="Indiferente"
              value={stringQuery(query.mobilia)}
            />
          </div>
        </div>

        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] text-sm font-semibold text-white transition hover:brightness-110"
          style={{ backgroundColor: tokens.primary }}
        >
          <Search className="h-4 w-4" />
          Buscar imoveis
        </button>
      </form>
      <style>{`
        .public-site-filter-field {
          border-color: color-mix(in srgb, var(--site-fg) 12%, transparent);
          background: color-mix(in srgb, var(--site-fg) 7%, transparent);
          color: var(--site-fg);
        }
        .public-site-filter-field::placeholder {
          color: color-mix(in srgb, var(--site-fg) 52%, transparent);
        }
        .public-site-filter-field:focus {
          border-color: color-mix(in srgb, var(--site-primary) 42%, transparent);
          background: color-mix(in srgb, var(--site-fg) 10%, transparent);
        }
      `}</style>
    </aside>
  );
}

function FilterSelect({
  className,
  label,
  name,
  options,
  placeholder,
  value,
}: Readonly<{
  className: string;
  label: string;
  name: string;
  options: Array<string | { value: string; label: string }>;
  placeholder: string;
  value: string;
}>) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wide opacity-70">{label}</span>
      <div className="relative">
        <select name={name} defaultValue={value} className={className}>
          <option className="text-slate-900" value="">
            {placeholder}
          </option>
          {options.map((option) => {
            const item = typeof option === "string" ? { value: option, label: option } : option;
            return (
              <option className="text-slate-900" key={item.value} value={item.value}>
                {item.label}
              </option>
            );
          })}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-50">v</span>
      </div>
    </label>
  );
}

function getPropertiesHeroTitle(query: Record<string, string | string[] | undefined>) {
  const type = stringQuery(query.tipo);
  const purpose = stringQuery(query.finalidade);

  if (type) {
    const lowerType = type.toLowerCase();
    if (lowerType.includes("apart")) return "Apartamentos";
    if (lowerType.includes("casa")) return "Casas";
    if (lowerType.includes("cobertura")) return "Coberturas";
    if (lowerType.includes("estudio") || lowerType.includes("studio")) return "Estúdios";
    return type;
  }

  if (purpose) {
    const normalizedPurpose = normalizePurposeValue(purpose);
    const option = purposeOptions.find((item) => item.value === normalizedPurpose);
    return option ? option.label : purpose;
  }

  return "Imóveis disponíveis";
}

function buildPurposeOptions(rawPurposes: string[]) {
  const options = new Map(purposeOptions.map((item) => [item.value, item]));

  rawPurposes.forEach((purpose) => {
    const normalized = normalizePurposeValue(purpose);
    if (!options.has(normalized)) {
      options.set(normalized, { value: normalized, label: purpose });
    }
  });

  return Array.from(options.values());
}

function normalizePurposeValue(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["aluguel", "locacao", "locaÃ§Ã£o", "rent"].includes(normalized)) return "locacao";
  if (["venda e aluguel", "venda locacao", "venda/locacao", "venda/aluguel", "venda_locacao"].includes(normalized)) return "venda_locacao";
  if (["temporada", "season"].includes(normalized)) return "temporada";
  if (["venda", "sale"].includes(normalized)) return "venda";
  return normalized || value;
}

export function PublicPropertyDetailScreen({
  property,
  site,
}: Readonly<{
  basePath: string;
  property: PublicProperty;
  site: PublicSiteConfig;
}>) {
  const tokens = getThemeTokens(site);
  const title = getPropertyTitle(property);
  const images = Array.from(new Set([property.imagem_principal, ...(property.fotos || [])].filter(Boolean))) as string[];

  return (
    <article>
      <PublicPropertyCarousel backgroundColor={tokens.background} images={images} title={title} />

      <section className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-9 sm:px-6 lg:grid-cols-[1fr_380px] lg:px-8">
        <div className="space-y-6">
          <div className="rounded-[14px] p-6" style={{ backgroundColor: tokens.card }}>
            <p className="inline-flex rounded-[8px] bg-blue-600 px-3 py-1 text-xs font-medium uppercase tracking-wide text-white">
              Ref: {getPropertyCode(property)}
            </p>
            <h1 className="mt-4 text-3xl font-normal leading-tight sm:text-4xl" style={{ color: tokens.foreground }}>
              {title}
            </h1>
            {getPropertyLocation(property) ? (
              <p className="mt-3 flex items-center gap-2 text-sm opacity-68" style={{ color: tokens.foreground }}>
                <MapPin className="h-5 w-5" />
                {getPropertyLocation(property)}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <FeatureStat icon={<BedDouble className="h-5 w-5" />} label="Quartos" value={property.quartos} site={site} />
            <FeatureStat icon={<Bath className="h-5 w-5" />} label="Banheiros" value={property.banheiros} site={site} />
            <FeatureStat icon={<Car className="h-5 w-5" />} label="Vagas" value={property.vagas} site={site} />
            <FeatureStat icon={<Maximize2 className="h-5 w-5" />} label="Area" value={property.area_construida || property.area_total} suffix="m2" site={site} />
          </div>

          <div className="rounded-[14px] p-6" style={{ backgroundColor: tokens.card }}>
            <h2 className="text-xl font-normal" style={{ color: tokens.foreground }}>
              Descricao
            </h2>
            <p className="mt-4 whitespace-pre-wrap leading-7 opacity-75" style={{ color: tokens.foreground }}>
              {property.descricao || "Entre em contato para saber mais detalhes sobre este imovel."}
            </p>
          </div>
        </div>

        <aside className="h-fit rounded-[14px] p-6 lg:sticky lg:top-28" style={{ backgroundColor: tokens.card }}>
          <p className="text-sm font-medium opacity-70" style={{ color: tokens.foreground }}>
            Valor
          </p>
          <p className="mt-1 text-3xl font-normal" style={{ color: tokens.primary }}>
            {formatPrice(getPropertyPrice(property))}
          </p>
          <div className="mt-6">
            <PublicContactForm
              organizationId={site.organization_id}
              primaryColor={tokens.primary}
              propertyCode={getPropertyCode(property)}
              propertyId={property.id}
            />
          </div>
        </aside>
      </section>
    </article>
  );
}

export function PublicAboutScreen({
  basePath,
  site,
}: Readonly<{
  basePath: string;
  site: PublicSiteConfig;
}>) {
  return <AboutContent basePath={basePath} site={site} />;
}

export function PublicContactScreen({
  basePath,
  site,
}: Readonly<{
  basePath: string;
  site: PublicSiteConfig;
}>) {
  const tokens = getThemeTokens(site);
  const banner = site.page_banner_url || site.hero_image_url || DEFAULT_HERO_IMAGE;

  return (
    <>
      <PageHero backgroundImage={banner} eyebrow="Contato" title="Fale com a equipe" />
      <section className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
        <div className="space-y-4">
          <h2 className="text-3xl font-semibold" style={{ color: tokens.foreground }}>
            Vamos encontrar o melhor caminho para voce.
          </h2>
          <p className="leading-7 opacity-75" style={{ color: tokens.foreground }}>
            Envie seus dados e conte o que procura. A equipe recebe o lead no CRM e retorna pelo canal informado.
          </p>
          <ContactLine icon={<Phone className="h-5 w-5" />} label="Telefone" value={site.phone} href={site.phone ? `tel:${site.phone}` : undefined} />
          <ContactLine icon={<Phone className="h-5 w-5" />} label="WhatsApp" value={site.whatsapp} href={site.whatsapp ? buildSiteHref(basePath, "/contato?origem=whatsapp") : undefined} />
          <ContactLine icon={<Mail className="h-5 w-5" />} label="E-mail" value={site.email} href={site.email ? `mailto:${site.email}` : undefined} />
          <ContactLine icon={<MapPin className="h-5 w-5" />} label="Endereco" value={[site.address, site.city, site.state].filter(Boolean).join(", ")} />
        </div>

        <div className="rounded-[14px] p-6" style={{ backgroundColor: tokens.card, color: tokens.foreground }}>
          <PublicContactForm organizationId={site.organization_id} primaryColor={tokens.primary} />
        </div>
      </section>
    </>
  );
}

export function PublicFavoritesScreen({
  basePath,
  site,
}: Readonly<{
  basePath: string;
  site: PublicSiteConfig;
}>) {
  const tokens = getThemeTokens(site);

  return (
    <>
      <PageHero backgroundImage={site.page_banner_url || site.hero_image_url || DEFAULT_HERO_IMAGE} eyebrow="Favoritos" title="Seus imoveis salvos" />
      <section className="mx-auto w-full max-w-4xl px-4 py-14 text-center sm:px-6 lg:px-8">
        <div className="rounded-lg border p-8" style={{ backgroundColor: tokens.card, borderColor: `${tokens.foreground}18` }}>
          <h2 className="text-2xl font-semibold" style={{ color: tokens.foreground }}>
            Favoritos ficam salvos neste navegador
          </h2>
          <p className="mx-auto mt-3 max-w-2xl leading-7 opacity-75" style={{ color: tokens.foreground }}>
            Abra os imoveis e toque no coracao para salvar. Esta primeira versao preserva seus favoritos localmente e evita qualquer dependencia direta com o banco no site publico.
          </p>
          <Link
            href={buildSiteHref(basePath, "/imoveis")}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold text-white"
            style={{ backgroundColor: tokens.primary }}
          >
            Ver imoveis
          </Link>
        </div>
      </section>
    </>
  );
}

function PropertySection({
  basePath,
  eyebrow,
  properties,
  site,
  title,
}: Readonly<{
  basePath: string;
  eyebrow: string;
  properties: PublicProperty[];
  site: PublicSiteConfig;
  title: string;
}>) {
  const tokens = getThemeTokens(site);

  if (properties.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: tokens.primary }}>
            {eyebrow}
          </p>
          <h2 className="mt-2 text-3xl font-semibold" style={{ color: tokens.foreground }}>
            {title}
          </h2>
        </div>
        <Link href={buildSiteHref(basePath, "/imoveis")} className="text-sm font-semibold" style={{ color: tokens.primary }}>
          Ver todos os imoveis
        </Link>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {properties.slice(0, 6).map((property) => (
          <PublicPropertyCard key={property.id} basePath={basePath} property={property} site={site} />
        ))}
      </div>
    </section>
  );
}

function SearchFilterField({
  cities,
  filter,
  propertyTypes,
}: Readonly<{
  cities: string[];
  filter: SiteSearchFilter;
  propertyTypes: string[];
}>) {
  const commonClass =
    "h-11 rounded-[10px] border-0 bg-white/12 px-3 text-sm text-white outline-none transition placeholder:text-white/58 hover:bg-white/16 focus:bg-white/18 focus:ring-2 focus:ring-white/22";

  if (filter.filter_key === "tipo") {
    return (
      <select name="tipo" className={commonClass} defaultValue="">
        <option className="text-slate-900" value="">{filter.label || "Tipo"}</option>
        {propertyTypes.map((type) => (
          <option className="text-slate-900" key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
    );
  }

  if (filter.filter_key === "finalidade") {
    return (
      <select name="finalidade" className={commonClass} defaultValue="">
        <option className="text-slate-900" value="">{filter.label || "Finalidade"}</option>
        <option className="text-slate-900" value="venda">Venda</option>
        <option className="text-slate-900" value="locacao">Aluguel</option>
      </select>
    );
  }

  if (filter.filter_key === "cidade") {
    return (
      <select name="cidade" className={commonClass} defaultValue="">
        <option className="text-slate-900" value="">{filter.label || "Cidade"}</option>
        {cities.map((city) => (
          <option className="text-slate-900" key={city} value={city}>
            {city}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      name={filter.filter_key === "search" ? "search" : filter.filter_key}
      placeholder={filter.label || "Buscar"}
      className={commonClass}
    />
  );
}

function AboutContent({
  basePath,
  compact = false,
  site,
}: Readonly<{
  basePath: string;
  compact?: boolean;
  site: PublicSiteConfig;
}>) {
  const tokens = getThemeTokens(site);
  const stats = site.about_stats?.length ? site.about_stats : defaultStats;
  const checkmarks = site.about_checkmarks?.length ? site.about_checkmarks : defaultCheckmarks;
  const features = site.about_features?.length ? site.about_features : defaultFeatures;

  return (
    <>
      {!compact ? (
        <PageHero
          backgroundImage={site.page_banner_url || site.hero_image_url || DEFAULT_HERO_IMAGE}
          eyebrow="Sobre"
          title={site.about_title || `Sobre a ${getSiteTitle(site)}`}
        />
      ) : null}

      <section className="border-y px-4 py-10 sm:px-6 lg:px-8" style={{ borderColor: `${tokens.foreground}12`, backgroundColor: tokens.card }}>
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={`${stat.value}-${stat.label}`} className="text-center">
              <p className="text-3xl font-bold sm:text-4xl" style={{ color: tokens.primary }}>
                {stat.value}
              </p>
              <p className="mt-1 text-sm opacity-70" style={{ color: tokens.foreground }}>
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div>
          {site.about_image_url ? (
            <img src={site.about_image_url} alt="" className="h-full max-h-[520px] w-full rounded-lg object-cover" />
          ) : (
            <div className="flex min-h-[360px] items-center justify-center rounded-lg" style={{ backgroundColor: `${tokens.primary}18` }}>
              <Building2 className="h-20 w-20" style={{ color: tokens.primary }} />
            </div>
          )}
        </div>
        <div className="flex flex-col justify-center">
          <p className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: tokens.primary }}>
            Nossa historia
          </p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl" style={{ color: tokens.foreground }}>
            {site.about_subtitle || "Transformando planos em bons negocios imobiliarios"}
          </h2>
          <p className="mt-5 whitespace-pre-wrap leading-7 opacity-75" style={{ color: tokens.foreground }}>
            {site.about_text || `${getSiteTitle(site)} nasceu para simplificar a jornada imobiliaria com atendimento proximo, informacao clara e bons imoveis.`}
          </p>
          <div className="mt-6 space-y-3">
            {checkmarks.map((item) => (
              <p key={item} className="flex items-center gap-3 font-medium" style={{ color: tokens.foreground }}>
                <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: tokens.primary }} />
                {item}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 lg:px-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => {
            const Icon = iconMap[feature.icon as keyof typeof iconMap] || Building2;
            return (
              <div key={feature.title} className="rounded-lg border p-5" style={{ backgroundColor: tokens.card, borderColor: `${tokens.foreground}18` }}>
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg" style={{ backgroundColor: `${tokens.primary}18`, color: tokens.primary }}>
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold" style={{ color: tokens.foreground }}>{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 opacity-70" style={{ color: tokens.foreground }}>{feature.description}</p>
              </div>
            );
          })}
        </div>
        {compact ? (
          <div className="mt-8 text-center">
            <Link href={buildSiteHref(basePath, "/sobre")} className="text-sm font-semibold" style={{ color: tokens.primary }}>
              Conheca nossa historia
            </Link>
          </div>
        ) : null}
      </section>
    </>
  );
}

function PageHero({
  backgroundImage,
  eyebrow,
  title,
}: Readonly<{
  backgroundImage: string;
  eyebrow: string;
  title: string;
}>) {
  return (
    <section className="relative overflow-hidden">
      <img src={backgroundImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-black/62" />
      <div className="relative mx-auto flex min-h-72 w-full max-w-7xl flex-col items-center justify-center px-4 py-20 text-center text-white sm:px-6 lg:px-8">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/62">{eyebrow}</p>
        <h1 className="mt-3 text-4xl font-light sm:text-5xl">{title}</h1>
      </div>
    </section>
  );
}

function EmptyState({
  description,
  title,
}: Readonly<{
  description: string;
  title: string;
}>) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-700">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm">{description}</p>
    </div>
  );
}

function Pagination({
  basePath,
  currentPage,
  query,
  totalPages,
}: Readonly<{
  basePath: string;
  currentPage: number;
  query: Record<string, string | string[] | undefined>;
  totalPages: number;
}>) {
  const makeHref = (page: number) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => params.append(key, item));
      } else if (value) {
        params.set(key, value);
      }
    });
    if (page > 1) params.set("page", String(page));
    else params.delete("page");
    const search = params.toString();
    return `${buildSiteHref(basePath, "/imoveis")}${search ? `?${search}` : ""}`;
  };

  return (
    <nav className="mt-10 flex items-center justify-center gap-3" aria-label="Paginacao">
      {currentPage > 1 ? (
        <Link href={makeHref(currentPage - 1)} className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-slate-700">
          Anterior
        </Link>
      ) : null}
      <span className="text-sm opacity-70">
        Pagina {currentPage} de {totalPages}
      </span>
      {currentPage < totalPages ? (
        <Link href={makeHref(currentPage + 1)} className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-slate-700">
          Proxima
        </Link>
      ) : null}
    </nav>
  );
}

function FeatureStat({
  icon,
  label,
  site,
  suffix = "",
  value,
}: Readonly<{
  icon: React.ReactNode;
  label: string;
  site: PublicSiteConfig;
  suffix?: string;
  value?: number | null;
}>) {
  const tokens = getThemeTokens(site);

  return (
    <div className="rounded-[14px] p-4" style={{ backgroundColor: tokens.card, color: tokens.foreground }}>
      <div style={{ color: tokens.primary }}>{icon}</div>
      <p className="mt-3 text-2xl font-normal">{value ? `${value}${suffix}` : "-"}</p>
      <p className="text-sm opacity-65">{label}</p>
    </div>
  );
}

function ContactLine({
  href,
  icon,
  label,
  value,
}: Readonly<{
  href?: string;
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}>) {
  if (!value) return null;
  const content = (
    <>
      <span className="text-amber-600">{icon}</span>
      <span>
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className="font-medium text-slate-900">{value}</span>
      </span>
    </>
  );

  return href ? (
    <a href={href} className="flex items-start gap-3 rounded-[12px] bg-slate-100 p-4 text-left transition hover:bg-slate-200">
      {content}
    </a>
  ) : (
    <div className="flex items-start gap-3 rounded-[12px] bg-slate-100 p-4 text-left">{content}</div>
  );
}

function stringQuery(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}
