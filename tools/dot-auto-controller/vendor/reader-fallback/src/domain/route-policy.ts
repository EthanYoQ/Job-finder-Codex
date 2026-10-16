const PUBLIC_STATIC_ROUTES = new Set(["/", "/privacy", "/terms"]);

function normalizePathname(pathname: string): string {
  const [pathOnly] = pathname.split("?");
  if (!pathOnly || pathOnly === "") return "/";
  return pathOnly.endsWith("/") && pathOnly.length > 1
    ? pathOnly.slice(0, -1)
    : pathOnly;
}

export function canAccessWithoutConsent(pathname: string): boolean {
  return PUBLIC_STATIC_ROUTES.has(normalizePathname(pathname));
}

export function isIndexableRoute(pathname: string): boolean {
  return PUBLIC_STATIC_ROUTES.has(normalizePathname(pathname));
}

export function shouldLoadOperationalAnalytics(
  pathname: string,
  hasConsent: boolean
): boolean {
  if (!hasConsent) return false;
  return !["/privacy", "/terms"].includes(normalizePathname(pathname));
}
