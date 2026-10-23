import { getDashboardCreativeSafeUrl } from "@/components/features/dashboard/creative-thumbnail-url";

// Keep this allowlist aligned with next.config.ts. Never rewrite signed CDN URLs.
export function canOptimizeDashboardCreativeImage(value: string | null | undefined) {
  const safe = getDashboardCreativeSafeUrl(value);
  if (!safe) return false;
  const url = new URL(safe);
  return url.port === "" &&
    ["fbcdn.net", "cdninstagram.com"].some((domain) => url.hostname.endsWith(`.${domain}`)) &&
    !/\.(?:svg|gif)$/i.test(url.pathname);
}
