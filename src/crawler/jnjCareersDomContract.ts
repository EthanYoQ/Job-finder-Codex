/** Source-local observation identity. These are DOM snapshots, never HTTP responses. */
export const JNJ_DOM_SOURCE = "source-johnson-innovative-medicine-social";
export const JNJ_DOM_COMPANY = "company-johnson-innovative-medicine";
export const JNJ_DOM_CONFIG_SHA256 = "80d9610e77965de2e15efba070735e77227c70efedb543d110bb259f75782cf3";
export const JNJ_DOM_CAPTURE_TOOL = { name: "jnj-browser-ui-dom-observation", version: "1" } as const;
export const JNJ_DOM_OBSERVATION_KIND = "BROWSER_UI_DOM_OBSERVATION_NOT_HTTP";
export const JNJ_DOM_LIST_LOCATOR = "jnj-ui-dom-list-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP";
export const JNJ_DOM_DETAIL_LOCATOR = "jnj-ui-dom-detail-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP";

/** Structural DTO allowance only. Source/plan/content authority is checked by
 * replayJnjCareersDomEvidence and again by the bound atomic/A certificate gates. */
export function isJnjDomListArtifact(tool: { name: string; version: string }, artifact: {
  kind: string; logicalKey: string; extractorLocator: string; bodyRepresentation?: string | undefined;
  requestedUrl?: unknown; finalUrl?: unknown; httpStatus?: unknown; contentType?: unknown;
  channelId?: unknown; rawBodySha256?: unknown; redactionDescriptors?: unknown;
}): boolean {
  return tool.name === JNJ_DOM_CAPTURE_TOOL.name && tool.version === JNJ_DOM_CAPTURE_TOOL.version &&
    artifact.kind === "COMMAND_OUTPUT" && /^jnj-dom-list-\d{4}$/u.test(artifact.logicalKey) &&
    artifact.extractorLocator === JNJ_DOM_LIST_LOCATOR && artifact.bodyRepresentation === "EXACT" &&
    [artifact.requestedUrl, artifact.finalUrl, artifact.httpStatus, artifact.contentType, artifact.channelId,
      artifact.rawBodySha256, artifact.redactionDescriptors].every(value => value === undefined);
}
