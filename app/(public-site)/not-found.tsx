import { renderPublicSiteRoute } from "@/components/features/public-site";

export default async function PublicSiteNotFoundPage() {
  return await renderPublicSiteRoute({
    missing: "unavailable",
    route: { kind: "not-found" },
  });
}
