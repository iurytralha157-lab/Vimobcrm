import { generatePublicSiteMetadata, renderPublicSiteRoute } from "@/components/features/public-site";

type PageProps = Readonly<{
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export async function generateMetadata({ params, searchParams }: PageProps) {
  const [{ path }, query] = await Promise.all([params, searchParams]);

  return await generatePublicSiteMetadata({
    route: path?.[0]
      ? { kind: "property", propertyCode: path[0] }
      : { kind: "properties", query },
  });
}

export default async function PublicPropertiesPage({
  params,
  searchParams,
}: PageProps) {
  const [{ path }, query] = await Promise.all([params, searchParams]);

  return await renderPublicSiteRoute({
    missing: "unavailable",
    route: path?.[0]
      ? { kind: "property", propertyCode: path[0] }
      : { kind: "properties", query },
  });
}
