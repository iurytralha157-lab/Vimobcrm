import { generatePublicSiteMetadata, renderPublicSiteRoute } from "@/components/features/public-site";

export async function generateMetadata() {
  return await generatePublicSiteMetadata({
    route: { kind: "about" },
  });
}

export default async function PublicAboutPage() {
  return await renderPublicSiteRoute({
    missing: "unavailable",
    route: { kind: "about" },
  });
}
