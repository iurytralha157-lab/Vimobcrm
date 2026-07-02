import { generatePublicSiteMetadata, parsePublicSitePath, renderPublicSiteRoute } from "@/components/features/public-site";

type PageProps = Readonly<{
  params: Promise<{ slug: string; path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export async function generateMetadata({ params, searchParams }: PageProps) {
  const [{ slug, path }, query] = await Promise.all([params, searchParams]);
  const route = parsePublicSitePath(path);

  return await generatePublicSiteMetadata({
    domain: slug,
    route: route.kind === "properties" ? { ...route, query } : route,
  });
}

export default async function PublishedSitePage({
  params,
  searchParams,
}: PageProps) {
  const [{ slug, path }, query] = await Promise.all([params, searchParams]);
  const route = parsePublicSitePath(path);

  return await renderPublicSiteRoute({
    basePath: `/sites/${slug}`,
    domain: slug,
    missing: "unavailable",
    route: route.kind === "properties" ? { ...route, query } : route,
  });
}
