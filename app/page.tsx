import { generatePublicSiteMetadata, renderPublicSiteRoute } from "@/components/features/public-site";

export async function generateMetadata() {
  return await generatePublicSiteMetadata({
    route: { kind: "home" },
  });
}

export default async function HomePage() {
  return await renderPublicSiteRoute({
    missing: "redirect-login",
    route: { kind: "home" },
  });
}
