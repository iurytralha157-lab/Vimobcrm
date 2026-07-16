/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import {
  Award,
  Bath,
  BedDouble,
  Building2,
  Car,
  ChevronDown,
  CheckCircle2,
  Home,
  House,
  KeyRound,
  Mail,
  MapPin,
  Maximize2,
  Phone,
  Search,
  ShieldCheck,
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
import { PublicFavoritesClient } from "./PublicFavoritesClient";
import {
  DEFAULT_HERO_IMAGE,
  buildSiteHref,
  formatPrice,
  getPropertyCode,
  getPropertyLocation,
  getPropertyPrice,
  getPropertyTitle,
  getSiteTitle,
  getThemeTokens,
} from "./public-site-utils";
import { PublicContactLeadDialog } from "./PublicContactLeadDialog";

const defaultStats = [
  { value: "500+", label: "Imóveis negociados" },
  { value: "98%", label: "Clientes satisfeitos" },
  { value: "15+", label: "Anos de experiência" },
  { value: "50+", label: "Parceiros" },
];

const defaultCheckmarks = ["Atendimento personalizado", "Imóveis verificados", "Suporte completo"];

const defaultFeatures = [
  {
    icon: "building",
    title: "Curadoria de imóveis",
    description: "Opções selecionadas para quem quer comprar, vender ou alugar com tranquilidade.",
  },
  {
    icon: "users",
    title: "Atendimento consultivo",
    description: "Equipe preparada para entender o seu momento e indicar o caminho mais seguro.",
  },
  {
    icon: "award",
    title: "Experiência de mercado",
    description: "Processo claro desde o primeiro contato até a conclusão da negociação.",
  },
  {
    icon: "shield",
    title: "Segurança no processo",
    description: "Informações organizadas e acompanhamento próximo em cada etapa.",
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
  { label: "Casas", href: "/imoveis?tipo=Casa", icon: House, match: ["casa", "sobrado"] },
  { label: "Apartamentos", href: "/imoveis?tipo=Apartamento", icon: Building2, match: ["apart"] },
  { label: "Coberturas", href: "/imoveis?tipo=Cobertura", icon: SquareStack, match: ["cobertura"] },
  { label: "Studios", href: "/imoveis?tipo=Studio", icon: KeyRound, match: ["studio", "estudio", "flat", "loft"] },
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
  const activeFilters = searchFilters.length > 0
    ? searchFilters
    : [
        { filter_key: "search", label: "Buscar", position: 0 },
        { filter_key: "tipo", label: "Tipo de imóvel", position: 1 },
        { filter_key: "finalidade", label: "Finalidade", position: 2 },
      ];
  const featuredPropertyIds = new Set(data.featured.map((property) => property.id));
  const allHomeProperties = data.latest.filter((property) => !featuredPropertyIds.has(property.id));

  return (
    <>
      <section className="relative min-h-[720px] overflow-hidden lg:min-h-[760px]">
        <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" loading="eager" />
        <div className="absolute inset-0 bg-black/56" />
        <div className="relative z-10 mx-auto flex min-h-[720px] w-full max-w-7xl flex-col items-center justify-center px-4 pb-20 pt-36 text-center text-white sm:px-6 lg:min-h-[760px] lg:px-8">
          <h1 className="mx-auto max-w-3xl text-[30px] font-extralight leading-[1.12] tracking-normal text-white/95 sm:text-[40px] lg:text-[46px]">
            {title}
          </h1>

          <form
            action={buildSiteHref(basePath, "/imoveis")}
            className="mt-10 grid w-full max-w-5xl gap-3 rounded-[14px] bg-[#30332f]/78 p-3 text-left backdrop-blur-xl sm:p-4 md:grid-cols-4"
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

        </div>
      </section>

      <PropertySection
        basePath={basePath}
        eyebrow="Destaques"
        properties={data.featured}
        site={site}
        title="Imóveis de destaque"
      />
      <PropertySection
        basePath={basePath}
        eyebrow="Portfólio"
        properties={allHomeProperties}
        site={site}
        title="Todos os imóveis"
      />

      {site.show_about_on_home ? (
        <AboutContent basePath={basePath} site={site} compact />
      ) : null}

      <HomeCategoryShowcase
        basePath={basePath}
        heroImage={heroImage}
        properties={[...data.featured, ...data.exclusive, ...data.latest]}
      />
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
  const properties = sortFeaturedFirst(data.properties);
  const hasFilters = Boolean(
    stringQuery(query.search) ||
      stringQuery(query.tipo) ||
      stringQuery(query.finalidade) ||
      stringQuery(query.cidade) ||
      stringQuery(query.bairro) ||
      stringQuery(query.condominio) ||
      stringQuery(query.min_price) ||
      stringQuery(query.max_price) ||
      stringQuery(query.quartos) ||
      stringQuery(query.suites) ||
      stringQuery(query.banheiros) ||
      stringQuery(query.vagas) ||
      stringQuery(query.mobilia) ||
      stringQuery(query.area_util_min) ||
      stringQuery(query.area_util_max) ||
      stringQuery(query.area_total_min) ||
      stringQuery(query.area_total_max) ||
      stringQuery(query.aceita_financiamento) ||
      stringQuery(query.aceita_permuta),
  );

  return (
    <>
      <PageHero backgroundImage={banner} eyebrow="Imóveis" title={getPropertiesHeroTitle(query)} />
      <section className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[290px_1fr] lg:px-8">
        <PublicPropertiesFilterSidebar basePath={basePath} data={data} query={query} site={site} />

        <div className="min-w-0">
          <div className="mb-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-medium opacity-70" style={{ color: tokens.foreground }}>
                {data.total} imóveis encontrados
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

          {properties.length > 0 ? (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {properties.map((property) => (
                <PublicPropertyCard key={property.id} basePath={basePath} property={property} site={site} />
              ))}
            </div>
          ) : (
            <EmptyState site={site} title="Nenhum imóvel encontrado" description="Tente ajustar os filtros ou fale com a equipe." />
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
  const inputClass = "public-site-filter-field h-11 w-full rounded-[10px] border-0 px-3 text-sm font-light outline-none transition";
  const selectClass = `${inputClass} appearance-none pr-9`;

  return (
    <aside className="h-fit rounded-[14px] p-5 lg:sticky lg:top-32" style={{ backgroundColor: tokens.card, color: tokens.foreground }}>
      <div className="mb-5">
        <h2 className="text-lg font-light">Filtros</h2>
      </div>

      <form action={buildSiteHref(basePath, "/imoveis")} className="space-y-3">
        <label className="block">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-52" />
            <input
              name="search"
              defaultValue={stringQuery(query.search)}
              placeholder="Código, condomínio, bairro ou cidade"
              className={`${inputClass} pl-9`}
            />
          </div>
        </label>

        <FilterSelect className={selectClass} label="Cidade" name="cidade" options={data.cities} placeholder="Selecione sua cidade" value={stringQuery(query.cidade)} />
        <FilterSelect className={selectClass} label="Bairro" name="bairro" options={data.neighborhoods} placeholder="Selecione seu bairro" value={stringQuery(query.bairro)} />
        <FilterSelect className={selectClass} label="Tipo de imóvel" name="tipo" options={data.types} placeholder="Tipo de imóvel" value={stringQuery(query.tipo)} />
        <FilterSelect className={selectClass} label="Finalidade" name="finalidade" options={buildPurposeOptions(data.purposes)} placeholder="Finalidade" value={stringQuery(query.finalidade)} />

        <div className="grid grid-cols-2 gap-3">
          <input name="min_price" defaultValue={stringQuery(query.min_price)} placeholder="Valor mínimo" className={inputClass} inputMode="numeric" />
          <input name="max_price" defaultValue={stringQuery(query.max_price)} placeholder="Valor máximo" className={inputClass} inputMode="numeric" />
        </div>

        <details className="group">
          <summary className="public-site-filter-field flex h-11 cursor-pointer list-none items-center gap-2 rounded-[10px] px-3 text-sm font-light transition hover:brightness-105">
            Mais filtros
            <ChevronDown className="ml-auto h-4 w-4 opacity-55 transition group-open:rotate-180" />
          </summary>
          <div className="mt-3 space-y-3">
            <FilterSelect className={selectClass} label="Condomínio" name="condominio" options={data.condominiums || []} placeholder="Condomínio" value={stringQuery(query.condominio)} />
            <FilterSelect className={selectClass} label="Quartos" name="quartos" options={numericOptions} placeholder="Quartos" value={stringQuery(query.quartos)} />
            <FilterSelect className={selectClass} label="Suites" name="suites" options={numericOptions} placeholder="Suites" value={stringQuery(query.suites)} />
            <FilterSelect className={selectClass} label="Banheiros" name="banheiros" options={numericOptions} placeholder="Banheiros" value={stringQuery(query.banheiros)} />
            <FilterSelect className={selectClass} label="Vagas" name="vagas" options={numericOptions} placeholder="Vagas" value={stringQuery(query.vagas)} />
            <FilterSelect
              className={selectClass}
              label="Mobília"
              name="mobilia"
              options={[
                { value: "mobiliado", label: "Mobiliado" },
                { value: "nao", label: "Sem mobília" },
              ]}
              placeholder="Mobília"
              value={stringQuery(query.mobilia)}
            />
            <div className="grid grid-cols-2 gap-3">
              <input name="area_util_min" defaultValue={stringQuery(query.area_util_min)} placeholder="Área útil mín." className={inputClass} inputMode="numeric" />
              <input name="area_util_max" defaultValue={stringQuery(query.area_util_max)} placeholder="Área útil máx." className={inputClass} inputMode="numeric" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input name="area_total_min" defaultValue={stringQuery(query.area_total_min)} placeholder="Área total mín." className={inputClass} inputMode="numeric" />
              <input name="area_total_max" defaultValue={stringQuery(query.area_total_max)} placeholder="Área total máx." className={inputClass} inputMode="numeric" />
            </div>
            <FilterSelect
              className={selectClass}
              label="Financiamento"
              name="aceita_financiamento"
              options={[
                { value: "true", label: "Aceita financiamento" },
                { value: "false", label: "Não aceita financiamento" },
              ]}
              placeholder="Financiamento"
              value={stringQuery(query.aceita_financiamento)}
            />
            <FilterSelect
              className={selectClass}
              label="Permuta"
              name="aceita_permuta"
              options={[
                { value: "true", label: "Aceita permuta" },
                { value: "false", label: "Não aceita permuta" },
              ]}
              placeholder="Permuta"
              value={stringQuery(query.aceita_permuta)}
            />
          </div>
        </details>

        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] text-sm font-semibold text-white transition hover:brightness-110"
          style={{ backgroundColor: tokens.primary }}
        >
          <Search className="h-4 w-4" />
          Buscar imóveis
        </button>
      </form>
      <style>{`
        .public-site-filter-field {
          background: color-mix(in srgb, var(--site-fg) 7%, transparent);
          color: var(--site-fg);
        }
        .public-site-filter-field::placeholder {
          color: color-mix(in srgb, var(--site-fg) 52%, transparent);
        }
        .public-site-filter-field:focus {
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
      <div className="relative">
        <select name={name} defaultValue={value} className={className} aria-label={label}>
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
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
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
  basePath,
  property,
  relatedProperties = [],
  site,
}: Readonly<{
  basePath: string;
  property: PublicProperty;
  relatedProperties?: PublicProperty[];
  site: PublicSiteConfig;
}>) {
  const tokens = getThemeTokens(site);
  const title = getPropertyTitle(property);
  const code = getPropertyCode(property);
  const location = getPropertyLocation(property);
  const mapSrc = location ? `https://www.google.com/maps?q=${encodeURIComponent(location)}&output=embed` : "";
  const videoEmbedUrl = getYouTubeEmbedUrl(property.video_imovel || property.tour_virtual || "");
  const valueItems = buildPropertyValueItems(property);
  const extraDetails = buildPropertyExtraDetails(property);
  const propertyStats = buildPropertyStats(property);
  const proximities = normalizeStringList(property.proximidades);
  const relatedSearches = buildRelatedSearches(property, basePath);
  const images = Array.from(
    new Set([
      property.imagem_principal,
      ...(property.fotos || []),
      ...(property.image_urls || []),
    ].filter(Boolean)),
  ) as string[];
  const contactMessage = `Olá, vim pelo site e tenho interesse no imóvel ${title}${code ? ` (ref. ${code})` : ""}. Gostaria de receber mais informações.`;
  const privacyHref = buildSiteHref(basePath, "/politica-de-privacidade");

  return (
    <article>
      <PublicPropertyCarousel backgroundColor={tokens.background} images={images} title={title} />

      <section className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-9 sm:px-6 lg:grid-cols-[1fr_380px] lg:px-8">
        <div className="space-y-6">
          <div className="rounded-[14px] p-6" style={{ backgroundColor: tokens.card }}>
            <p className="inline-flex rounded-[8px] px-3 py-1 text-xs font-medium uppercase tracking-wide text-white" style={{ backgroundColor: tokens.primary }}>
              Ref: {code}
            </p>
            <h1 className="mt-4 text-2xl font-normal leading-snug sm:text-[28px] lg:text-[30px]" style={{ color: tokens.foreground }}>
              {title}
            </h1>
            {location ? (
              <p className="mt-3 flex items-center gap-2 text-sm opacity-68" style={{ color: tokens.foreground }}>
                <MapPin className="h-5 w-5" />
                {location}
              </p>
            ) : null}
          </div>

          <div className="rounded-[14px] p-6" style={{ backgroundColor: tokens.card }}>
            <h2 className="text-xl font-normal" style={{ color: tokens.foreground }}>
              Detalhes do imóvel
            </h2>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {propertyStats.map((stat) => (
                <FeatureStat
                  icon={stat.icon}
                  key={stat.label}
                  label={stat.label}
                  site={site}
                  value={stat.value}
                />
              ))}
            </div>

            {extraDetails.length > 0 ? (
              <div className="mt-6">
                <h3 className="text-sm font-normal opacity-70" style={{ color: tokens.foreground }}>
                  Detalhes extras do imóvel
                </h3>
                <TagList items={extraDetails} primaryColor={tokens.primary} />
              </div>
            ) : null}
          </div>

          <div className="rounded-[14px] p-6" style={{ backgroundColor: tokens.card }}>
            <h2 className="text-xl font-normal" style={{ color: tokens.foreground }}>
              Descrição
            </h2>
            <p className="mt-4 whitespace-pre-wrap leading-7 opacity-75" style={{ color: tokens.foreground }}>
              {property.descricao || "Entre em contato para saber mais detalhes sobre este imóvel."}
            </p>
          </div>

          {videoEmbedUrl ? (
            <div className="overflow-hidden rounded-[14px]" style={{ backgroundColor: tokens.card }}>
              <iframe
                src={videoEmbedUrl}
                title={`Vídeo do imóvel ${title}`}
                className="aspect-video w-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
              />
            </div>
          ) : null}

          {mapSrc ? (
            <div className="overflow-hidden rounded-[14px]" style={{ backgroundColor: tokens.card }}>
              <div className="px-6 py-5">
                <h2 className="text-xl font-normal" style={{ color: tokens.foreground }}>
                  Localização
                </h2>
                <p className="mt-2 flex items-center gap-2 text-sm opacity-68" style={{ color: tokens.foreground }}>
                  <MapPin className="h-4 w-4" />
                  {location}
                </p>
              </div>
              <iframe
                src={mapSrc}
                title={`Mapa aproximado de ${location}`}
                className="h-72 w-full border-0 grayscale-[0.1]"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          ) : null}

          {proximities.length > 0 ? (
            <div className="rounded-[14px] p-6" style={{ backgroundColor: tokens.card }}>
              <h2 className="text-xl font-normal" style={{ color: tokens.foreground }}>
                Proximidades
              </h2>
              <TagList items={proximities} primaryColor={tokens.primary} />
            </div>
          ) : null}
        </div>

        <aside className="h-fit rounded-[14px] p-6 lg:sticky lg:top-28" style={{ backgroundColor: tokens.card }}>
          <p className="text-sm font-medium opacity-70" style={{ color: tokens.foreground }}>
            Valor
          </p>
          <p className="mt-1 text-3xl font-light" style={{ color: tokens.primary }}>
            {formatPrice(getPropertyPrice(property))}
          </p>
          {valueItems.length > 0 ? (
            <dl className="mt-5 space-y-3 border-t pt-4" style={{ borderColor: `${tokens.foreground}18`, color: tokens.foreground }}>
              {valueItems.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4 text-sm">
                  <dt className="opacity-62">{item.label}</dt>
                  <dd className="font-normal">{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="mt-6">
            <PublicContactForm
              defaultMessage={contactMessage}
              organizationId={site.organization_id}
              primaryColor={tokens.primary}
              privacyHref={privacyHref}
              propertyCode={getPropertyCode(property)}
              propertyId={property.id}
              siteTitle={getSiteTitle(site)}
            />
          </div>
        </aside>
      </section>

      {relatedProperties.length > 0 ? (
        <PropertySection
          basePath={basePath}
          eyebrow="Relacionados"
          properties={relatedProperties}
          site={site}
          title="Você também pode gostar"
        />
      ) : null}

      {relatedSearches.length > 0 ? (
        <section className="mx-auto w-full max-w-7xl px-4 pb-16 text-center sm:px-6 lg:px-8">
          <h2 className="text-2xl font-normal" style={{ color: tokens.foreground }}>
            Buscas relacionadas
          </h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {relatedSearches.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-full border px-4 py-2 text-sm font-light transition hover:brightness-105"
                style={{ borderColor: `${tokens.foreground}42`, color: tokens.foreground }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

function TagList({ items, primaryColor }: Readonly<{ items: string[]; primaryColor: string }>) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {items.map((item, index) => (
        <span
          key={`${item}-${index}`}
          className="rounded-[8px] px-3 py-1.5 text-xs font-light"
          style={{
            backgroundColor: index % 3 === 0 ? primaryColor : "color-mix(in srgb, var(--site-fg) 8%, transparent)",
            color: index % 3 === 0 ? "#fff" : "var(--site-fg)",
          }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function buildPropertyStats(property: PublicProperty) {
  const stats: Array<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = [];
  const addNumber = (value: number | null | undefined, label: string, icon: React.ReactNode) => {
    if (!value || value <= 0) return;
    stats.push({ icon, label, value: formatMetricNumber(value) });
  };
  const addArea = (value: number | null | undefined, label: string, icon: React.ReactNode) => {
    if (!value || value <= 0) return;
    stats.push({
      icon,
      label,
      value: (
        <>
          {formatMetricNumber(value)}
          <span className="ml-0.5 align-super text-[0.58em] leading-none">m²</span>
        </>
      ),
    });
  };

  addNumber(property.quartos, "Quartos", <BedDouble className="h-5 w-5" />);
  addNumber(property.suites, "Suites", <KeyRound className="h-5 w-5" />);
  addNumber(property.banheiros, "Banheiros", <Bath className="h-5 w-5" />);
  addNumber(property.vagas, "Vagas", <Car className="h-5 w-5" />);
  addArea(property.area_construida, "Área útil", <Maximize2 className="h-5 w-5" />);
  if (property.area_total && property.area_total !== property.area_construida) {
    addArea(property.area_total, "Área total", <SquareStack className="h-5 w-5" />);
  }
  addNumber(property.andar, "Andar", <Building2 className="h-5 w-5" />);

  return stats;
}

function buildPropertyExtraDetails(property: PublicProperty) {
  const items = normalizeStringList(property.detalhes_extras);

  if (property.mobiliado) items.push("Mobiliado");
  if (property.aceita_financiamento) items.push("Aceita financiamento");
  if (property.usou_fgts) items.push("Aceita FGTS");
  if (property.aceita_permuta) items.push("Aceita permuta");
  if (property.exclusividade) items.push("Exclusivo");
  if (property.andar) items.push(`${property.andar} andar`);

  return Array.from(new Set(items.filter(Boolean)));
}

function buildPropertyValueItems(property: PublicProperty) {
  const items = [
    { label: "Condomínio", value: property.valor_condominio },
    { label: "IPTU", value: property.iptu },
    { label: "ITR", value: property.valor_itr },
    { label: "Seguro incendio", value: property.seguro_incendio },
    { label: "Taxa de servico", value: property.taxa_de_servico },
    { label: "Venda avaliada", value: property.valor_venda_avaliado },
    { label: "Locação avaliada", value: property.valor_locacao_avaliado },
  ];

  return items
    .filter((item) => typeof item.value === "number" && item.value > 0)
    .map((item) => ({ label: item.label, value: formatPrice(item.value || null) }));
}

function formatMetricNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
  }).format(value);
}

function buildRelatedSearches(property: PublicProperty, basePath: string) {
  const type = property.tipo_imovel || "Imóvel";
  const city = property.cidade || "";
  const neighborhood = property.bairro || "";
  const rooms = property.quartos ? `${property.quartos} quartos` : "";
  const purpose = getRelatedPurposeLabel(property);
  const labels = [
    [type, rooms, purpose, neighborhood, city].filter(Boolean).join(" - "),
    [type, purpose, city].filter(Boolean).join(" - "),
    neighborhood ? [type, purpose, neighborhood].filter(Boolean).join(" - ") : "",
  ];

  return Array.from(new Set(labels.map((item) => item.trim()).filter(Boolean))).slice(0, 4).map((label) => ({
    label,
    href: buildSiteHref(basePath, `/imoveis?${new URLSearchParams({
      search: label,
      tipo: property.tipo_imovel || "",
      finalidade: property.finalidade || "",
    }).toString()}`),
  }));
}

function getRelatedPurposeLabel(property: PublicProperty) {
  const purpose = normalizePurposeValue(property.finalidade || "");
  if (purpose === "locacao") return "para alugar";
  if (purpose === "temporada") return "para temporada";
  if (purpose === "venda_locacao") return "a venda ou locacao";
  return "a venda";
}

function normalizeStringList(value?: string[] | null) {
  return Array.isArray(value)
    ? value.map((item) => item.trim()).filter(Boolean)
    : [];
}

function getYouTubeEmbedUrl(value: string) {
  const url = value.trim();
  if (!url) return "";

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    let videoId = "";
    if (host === "youtu.be") videoId = parsed.pathname.replace("/", "");
    if (host.endsWith("youtube.com")) {
      if (parsed.pathname.startsWith("/embed/")) videoId = parsed.pathname.split("/")[2] || "";
      if (!videoId) videoId = parsed.searchParams.get("v") || "";
      if (!videoId && parsed.pathname.startsWith("/shorts/")) videoId = parsed.pathname.split("/")[2] || "";
    }
    return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
  } catch {
    return "";
  }
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
  const privacyHref = buildSiteHref(basePath, "/politica-de-privacidade");

  return (
    <>
      <PageHero backgroundImage={banner} eyebrow="Contato" title="Fale com a equipe" />
      <section className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
        <div className="space-y-4">
          <h2 className="text-3xl font-semibold" style={{ color: tokens.foreground }}>
            Vamos encontrar o melhor caminho para você.
          </h2>
          <p className="leading-7 opacity-75" style={{ color: tokens.foreground }}>
            Envie seus dados e conte o que procura. A equipe recebe o lead no CRM e retorna pelo canal informado.
          </p>
          <ContactLine icon={<Phone className="h-5 w-5" />} label="Telefone" site={site} value={site.phone} href={site.phone ? `tel:${site.phone}` : undefined} />
          {site.whatsapp ? (
            <PublicContactLeadDialog
              className="text-[var(--site-fg)]"
              organizationId={site.organization_id}
              primaryColor={tokens.primary}
              privacyHref={privacyHref}
              siteTitle={getSiteTitle(site)}
              triggerLabel={site.whatsapp}
              variant="contact-line"
            />
          ) : null}
          <ContactLine icon={<Mail className="h-5 w-5" />} label="E-mail" site={site} value={site.email} href={site.email ? `mailto:${site.email}` : undefined} />
          <ContactLine icon={<MapPin className="h-5 w-5" />} label="Endereço" site={site} value={[site.address, site.city, site.state].filter(Boolean).join(", ")} />
        </div>

        <div className="rounded-[14px] p-6" style={{ backgroundColor: tokens.card, color: tokens.foreground }}>
          <PublicContactForm organizationId={site.organization_id} primaryColor={tokens.primary} privacyHref={privacyHref} siteTitle={getSiteTitle(site)} />
        </div>
      </section>
    </>
  );
}

export function PublicPrivacyPolicyScreen({
  site,
}: Readonly<{
  site: PublicSiteConfig;
}>) {
  const tokens = getThemeTokens(site);
  const banner = site.page_banner_url || site.hero_image_url || DEFAULT_HERO_IMAGE;
  const siteTitle = getSiteTitle(site);
  const contact = [site.email, site.phone || site.whatsapp].filter(Boolean).join(" | ");
  const address = [site.address, site.city, site.state].filter(Boolean).join(", ");

  return (
    <>
      <PageHero backgroundImage={banner} eyebrow="Privacidade" title="Política de privacidade" />
      <section className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-[14px] p-6 leading-7 sm:p-8" style={{ backgroundColor: tokens.card, color: tokens.foreground }}>
          <p className="text-sm opacity-70">
            Esta política explica como a {siteTitle} trata os dados enviados pelos formulários deste site.
          </p>

          <div className="mt-8 space-y-7">
            <PolicyBlock title="Dados coletados">
              Podemos coletar nome, telefone, e-mail, mensagem enviada, imóvel de interesse, melhor horário para contato e dados técnicos de navegação usados para atendimento e segurança.
            </PolicyBlock>
            <PolicyBlock title="Finalidade do uso">
              Usamos essas informações para responder solicitações, registrar leads no CRM, melhorar o atendimento, acompanhar interesses em imóveis e cumprir obrigações legais.
            </PolicyBlock>
            <PolicyBlock title="Compartilhamento">
              Os dados podem ser acessados pela equipe autorizada da imobiliária e por fornecedores essenciais de tecnologia, sempre com finalidade operacional e proteção adequada.
            </PolicyBlock>
            <PolicyBlock title="Armazenamento e segurança">
              Mantemos os dados pelo tempo necessário para atendimento, relacionamento comercial e cumprimento legal. Aplicamos controles de acesso e medidas técnicas para proteger as informações.
            </PolicyBlock>
            <PolicyBlock title="Seus direitos">
              Você pode solicitar acesso, correção, atualização ou exclusão dos seus dados pessoais pelos canais de contato da imobiliária.
            </PolicyBlock>
            <PolicyBlock title="Contato">
              {contact || address ? (
                <>
                  Para falar sobre privacidade, entre em contato com {siteTitle}
                  {contact ? ` pelo canal ${contact}` : ""}
                  {address ? ` ou no endereço ${address}` : ""}.
                </>
              ) : (
                <>Entre em contato com a imobiliária pelos canais informados neste site.</>
              )}
            </PolicyBlock>
          </div>

          <p className="mt-8 text-xs opacity-55">
            Última atualização: julho de 2026.
          </p>
        </div>
      </section>
    </>
  );
}

function PolicyBlock({ children, title }: Readonly<{ children: React.ReactNode; title: string }>) {
  return (
    <section>
      <h2 className="text-lg font-normal">{title}</h2>
      <div className="mt-2 text-sm leading-7 opacity-72">{children}</div>
    </section>
  );
}

export function PublicFavoritesScreen({
  basePath,
  site,
}: Readonly<{
  basePath: string;
  site: PublicSiteConfig;
}>) {
  return (
    <>
      <PageHero backgroundImage={site.page_banner_url || site.hero_image_url || DEFAULT_HERO_IMAGE} eyebrow="Favoritos" title="Seus imóveis salvos" />
      <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <PublicFavoritesClient basePath={basePath} site={site} />
      </section>
    </>
  );
}

export function PublicNotFoundScreen({
  basePath,
  site,
}: Readonly<{
  basePath: string;
  site: PublicSiteConfig;
}>) {
  const tokens = getThemeTokens(site);
  const backgroundImage = site.page_banner_url || site.hero_image_url || DEFAULT_HERO_IMAGE;

  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-32 text-center text-white sm:px-6">
      <img src={backgroundImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-black/68" />
      <div className="relative z-10 mx-auto max-w-2xl">
        <p className="text-sm font-light uppercase tracking-[0.24em] text-white/72">Ops, algo deu errado</p>
        <h1 className="mt-5 text-[88px] font-extralight leading-none tracking-normal text-white sm:text-[128px]">
          404
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-base font-light leading-7 text-white/76 sm:text-lg">
          Não encontramos essa página. O imóvel pode ter sido atualizado, removido ou o link pode estar incompleto.
        </p>
        <Link
          href={buildSiteHref(basePath, "/")}
          className="mt-8 inline-flex h-11 items-center justify-center rounded-[10px] px-6 text-sm font-light text-white transition hover:brightness-110"
          style={{ backgroundColor: tokens.primary }}
        >
          Voltar à página principal
        </Link>
      </div>
    </section>
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
  const orderedProperties = sortFeaturedFirst(properties);

  if (orderedProperties.length === 0) return null;

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
          Ver todos os imóveis
        </Link>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {orderedProperties.slice(0, 6).map((property) => (
          <PublicPropertyCard key={property.id} basePath={basePath} property={property} site={site} />
        ))}
      </div>
    </section>
  );
}

function HomeCategoryShowcase({
  basePath,
  heroImage,
  properties,
}: Readonly<{
  basePath: string;
  heroImage: string;
  properties: PublicProperty[];
}>) {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {homeCategoryShortcuts.map((item) => {
          const Icon = item.icon;
          const image = findCategoryImage(properties, item.match) || heroImage;

          return (
            <Link
              key={item.href}
              href={buildSiteHref(basePath, item.href)}
              className="group relative min-h-[230px] overflow-hidden rounded-[14px] bg-zinc-900 text-white"
            >
              <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/76 via-black/22 to-black/8" />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-white/14 backdrop-blur-md">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="text-2xl font-light uppercase tracking-wide">{item.label}</h3>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function sortFeaturedFirst(properties: PublicProperty[]) {
  return properties
    .map((property, index) => ({ property, index }))
    .sort((left, right) => {
      const featuredDiff = Number(Boolean(right.property.destaque)) - Number(Boolean(left.property.destaque));
      return featuredDiff || left.index - right.index;
    })
    .map(({ property }) => property);
}

function findCategoryImage(properties: PublicProperty[], terms: string[]) {
  const property = properties.find((item) => {
    const haystack = `${item.tipo_imovel || ""} ${item.titulo || ""}`.toLowerCase();
    return terms.some((term) => haystack.includes(term));
  });

  return property?.imagem_principal || property?.fotos?.[0] || null;
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
            Nossa história
          </p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl" style={{ color: tokens.foreground }}>
            {site.about_subtitle || "Transformando planos em bons negócios imobiliários"}
          </h2>
          <p className="mt-5 whitespace-pre-wrap leading-7 opacity-75" style={{ color: tokens.foreground }}>
            {site.about_text || `${getSiteTitle(site)} nasceu para simplificar a jornada imobiliária com atendimento próximo, informação clara e bons imóveis.`}
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
              Conheça nossa história
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
  site,
  title,
}: Readonly<{
  description: string;
  site: PublicSiteConfig;
  title: string;
}>) {
  const tokens = getThemeTokens(site);

  return (
    <div className="rounded-[14px] p-8 text-center" style={{ backgroundColor: tokens.card, color: tokens.foreground }}>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm opacity-68">{description}</p>
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
    <nav className="mt-10 flex items-center justify-center gap-3" aria-label="Paginação">
      {currentPage > 1 ? (
        <Link href={makeHref(currentPage - 1)} className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-slate-700">
          Anterior
        </Link>
      ) : null}
      <span className="text-sm opacity-70">
        Página {currentPage} de {totalPages}
      </span>
      {currentPage < totalPages ? (
        <Link href={makeHref(currentPage + 1)} className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-slate-700">
          Próxima
        </Link>
      ) : null}
    </nav>
  );
}

function FeatureStat({
  icon,
  label,
  site,
  value,
}: Readonly<{
  icon: React.ReactNode;
  label: string;
  site: PublicSiteConfig;
  value: React.ReactNode;
}>) {
  const tokens = getThemeTokens(site);

  return (
    <div
      className="rounded-[10px] p-4"
      style={{
        backgroundColor: "color-mix(in srgb, var(--site-fg) 5%, transparent)",
        color: tokens.foreground,
      }}
    >
      <div className="flex items-center gap-2" style={{ color: tokens.primary }}>
        {icon}
        <p className="text-2xl font-normal leading-none" style={{ color: tokens.foreground }}>
          {value}
        </p>
      </div>
      <p className="text-sm opacity-65">{label}</p>
    </div>
  );
}

function ContactLine({
  href,
  icon,
  label,
  site,
  value,
}: Readonly<{
  href?: string;
  icon: React.ReactNode;
  label: string;
  site: PublicSiteConfig;
  value?: string | null;
}>) {
  if (!value) return null;
  const tokens = getThemeTokens(site);
  const content = (
    <>
      <span style={{ color: tokens.primary }}>{icon}</span>
      <span>
        <span className="block text-xs font-semibold uppercase tracking-wide opacity-55">{label}</span>
        <span className="font-medium">{value}</span>
      </span>
    </>
  );

  return href ? (
    <a href={href} className="flex items-start gap-3 rounded-[12px] p-4 text-left transition hover:brightness-105" style={{ backgroundColor: tokens.card, color: tokens.foreground }}>
      {content}
    </a>
  ) : (
    <div className="flex items-start gap-3 rounded-[12px] p-4 text-left" style={{ backgroundColor: tokens.card, color: tokens.foreground }}>{content}</div>
  );
}

function stringQuery(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}
