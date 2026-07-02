import { generatePublicSiteMetadata, renderPublicSiteRoute } from "@/components/features/public-site";

export async function generateMetadata() {
  return await generatePublicSiteMetadata({
    route: { kind: "favorites" },
  });
}

export default async function PublicFavoritesPage() {
  return await renderPublicSiteRoute({
    missing: "unavailable",
    route: { kind: "favorites" },
  });
}
