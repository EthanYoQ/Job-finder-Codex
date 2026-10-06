/** Exact, source-local native navigation profiles. No query normalization or alias invention. */
export const JNJ_DOM_ORIGIN = "https://www.careers.jnj.com";
export const JNJ_DOM_MANUAL_ENTRY = `${JNJ_DOM_ORIGIN}/en/jobs/?country=China&origin=global#results`;
export const JNJ_DOM_URL_PROFILES = ["legacy-origin-global-v1", "native-pagesize20-v2"] as const;
export type JnjDomUrlProfile = typeof JNJ_DOM_URL_PROFILES[number];
export function jnjDomListUrl(profile: JnjDomUrlProfile, page: number): string {
  if (!Number.isSafeInteger(page) || page < 1 || page > 20) throw Error("JNJ_DOM_PAGE_OUT_OF_RANGE");
  const scope = profile === "legacy-origin-global-v1" ? "origin=global" : "pagesize=20";
  return `${JNJ_DOM_ORIGIN}/en/jobs/?${page === 1 ? "" : `page=${page}&`}country=China&${scope}#results`;
}
export function jnjDomObservedUrlProfile(url: string, page: number): JnjDomUrlProfile | null {
  for (const profile of JNJ_DOM_URL_PROFILES) {
    if (url === jnjDomListUrl(profile, page)) return profile;
    if (page === 1 && url === (profile === "legacy-origin-global-v1"
      ? `${JNJ_DOM_ORIGIN}/en/jobs/?search=&country=China&origin=global`
      : `${JNJ_DOM_ORIGIN}/en/jobs/?search=&country=China&pagesize=20#results`)) return profile;
  }
  return null;
}
export function jnjDomCaptureTool(profile: JnjDomUrlProfile) {
  return { name: "jnj-browser-ui-dom-observation", version: profile === "legacy-origin-global-v1" ? "1" : "2" } as const;
}
export function jnjDomCaptureProfile(tool: { name: string; version: string }): JnjDomUrlProfile | null {
  if (tool.name !== "jnj-browser-ui-dom-observation") return null;
  return tool.version === "1" ? "legacy-origin-global-v1" : tool.version === "2" ? "native-pagesize20-v2" : null;
}
