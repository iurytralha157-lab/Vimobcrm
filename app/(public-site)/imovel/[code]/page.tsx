import { generatePublicSiteMetadata, renderPublicSiteRoute } from "@/components/features/public-site";

type PageProps = Readonly<{
  params: Promise<{ code: string }>;
}>;

export async function generateMetadata({ params }: PageProps) {
  const { code } = await params;

  return await generatePublicSiteMetadata({
    route: { kind: "property", propertyCode: code },
  });
}

export default async function PublicPropertyAliasPage({ params }: PageProps) {
  const { code } = await params;

  return await renderPublicSiteRoute({
    missing: "unavailable",
    route: { kind: "property", propertyCode: code },
  });
}
