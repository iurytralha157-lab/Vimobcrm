const SETUP_GUIDE_ROUTE_ORIGIN = "https://setup-guide.vimob.invalid";
const SETUP_GUIDE_STEP_PATTERN = /^[a-z][a-z0-9_]*$/;

function normalizePathname(pathname: string) {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

export function buildSetupGuideHref(route: string, stepId: string) {
  if (!route.startsWith("/") || route.startsWith("//")) {
    throw new Error("A rota do guia deve ser interna.");
  }
  if (!SETUP_GUIDE_STEP_PATTERN.test(stepId)) {
    throw new Error("A etapa do guia é inválida.");
  }

  const url = new URL(route, SETUP_GUIDE_ROUTE_ORIGIN);
  if (url.origin !== SETUP_GUIDE_ROUTE_ORIGIN) {
    throw new Error("A rota do guia deve permanecer no CRM.");
  }

  url.searchParams.set("setupGuide", stepId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function setupGuidePathMatches(pathname: string | null, expectedPath: string) {
  if (!pathname || !expectedPath.startsWith("/")) return false;
  return normalizePathname(pathname) === normalizePathname(expectedPath);
}
