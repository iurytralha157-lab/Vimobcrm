import { generatePublicSiteMetadata, renderPublicSiteRoute } from "@/components/features/public-site";

export async function generateMetadata() {
  return await generatePublicSiteMetadata({
    route: { kind: "contact" },
  });
}

export default async function PublicContactPage() {
  return await renderPublicSiteRoute({
    missing: "unavailable",
    route: { kind: "contact" },
  });
}
