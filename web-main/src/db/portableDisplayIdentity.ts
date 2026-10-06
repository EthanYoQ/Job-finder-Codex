import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import logoManifest from "../app/assets/company-logos";
import type { PortablePublicSnapshot } from "./portablePublicSnapshotRepository";
import { ALL_CITIES, publicSearchCities, publicSearchCityProvince, publicSearchProvinces } from "../domain/jobLocation";
import { coverageFromPortableSnapshot, searchPortableSnapshot } from "../server/portablePublicationApi";

export interface PortableSnapshotIdentity {
  /** Legacy identity of the complete snapshot, including its original generatedAt. */
  version: string;
  /** Only query/display data; observation times and freshness do not change it. */
  displayDataVersion: string;
  /** Verified snapshot status, not the response's CURRENT/UPDATING/FAILED state. */
  statusVersion: string;
  /** Complete verification identity, distinct from display and status identity. */
  verificationVersion: string;
  /** Original projection verification time. Never the time an old display is served. */
  verifiedAt: string;
}
const hash = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
// Object insertion order is not display content. Preserve array order and JSON's
// omission/null semantics, while canonicalizing every object key for new domains.
const canonicalIdentityJson = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(
    Object.entries(item).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) : item);
const digest = (domain: string, value: unknown): string => hash(`${domain}\n${canonicalIdentityJson(value)}`);

/** Hash actual sprite bytes and the coordinate mapping, never filenames or mtimes.
 * Source assets ship in the runtime image and are immutable for this process.
 */
export function portableDisplayAssetsVersion(assets: {png: Uint8Array; webp: Uint8Array; manifest: unknown}): string {
  return digest("portable-display-assets-v1", {png: hash(assets.png), webp: hash(assets.webp), manifest: assets.manifest});
}
export const PORTABLE_DISPLAY_ASSETS_VERSION = portableDisplayAssetsVersion({
  png: readFileSync(new NodeURL("../app/assets/company-logos.png", import.meta.url)),
  webp: readFileSync(new NodeURL("../app/assets/company-logos.webp", import.meta.url)),
  manifest: logoManifest
});

/** Use the production projectors to bind every source-scope label, directory URL,
 * sort input and global facet. Retain per-job location inputs as well: aggregate
 * facet counts alone cannot identify arbitrary city/province-filtered results.
 * Status badges, receipt IDs and original observation times belong to statusVersion.
 */
export function portableDisplayDataVersion(snapshot: PortablePublicSnapshot,
  assetsVersion = PORTABLE_DISPLAY_ASSETS_VERSION): string {
  const search = searchPortableSnapshot({city: ALL_CITIES}, snapshot);
  const directory = coverageFromPortableSnapshot({keyword: "", offset: 0, limit: snapshot.companies.length}, snapshot);
  return digest("portable-display-data-v1", {
    assetsVersion,
    companies: directory.companies.map(({id, companyName, sourceScopeNote, officialWebsiteUrl, officialCareersUrl, category}) => ({
      id, companyName, sourceScopeNote, officialWebsiteUrl, officialCareersUrl, category,
      // Pinyin is also a directory search input for companies without public jobs.
      pinyin: snapshot.companies.find(company => company.id === id)!.pinyin
    })),
    publishingSources: snapshot.companies.filter(company => company.required)
      .map(company => ({id: company.id, sourceIds: [...company.publishingSourceIds].sort()}))
      .sort((a, b) => a.id.localeCompare(b.id)),
    search: {
      companies: search.companies.map(company => ({
        id: company.id, companyName: company.companyName, pinyin: company.pinyin, sourceScopeNote: company.sourceScopeNote,
        jobs: company.jobs.map(job => {
          // Search keeps the verified portable locations in its public projection.
          const locations = job as typeof snapshot.companies[number]["jobs"][number];
          return {id: job.id, title: job.title, officialTitle: job.officialTitle,
            officialPublishedAt: job.officialPublishedAt, city: job.city, cities: locations.cities,
            locationRaw: job.locationRaw, cityPending: job.cityPending, category: job.category,
            isNew: job.isNew, officialUrl: job.officialUrl,
            searchCities: publicSearchCities(locations).map(city => ({city, province: publicSearchCityProvince(locations, city)})),
            searchProvinces: publicSearchProvinces(locations)};
        })
      })),
      totalJobs: search.totalJobs, publishedJobSummary: search.publishedJobSummary,
      cityFacets: search.cityFacets, provinceFacets: search.provinceFacets
    }
  });
}

/** Compute only at a completed projection, then carry the result with its owned
 * snapshot through cache reads. serializedSnapshot, when supplied by the cache,
 * must be JSON.stringify(snapshot) from this same synchronous operation.
 */
export function portableSnapshotIdentities(snapshot: PortablePublicSnapshot,
  serializedSnapshot = JSON.stringify(snapshot)): PortableSnapshotIdentity {
  const version = hash(serializedSnapshot);
  const displayDataVersion = portableDisplayDataVersion(snapshot);
  const statusVersion = digest("portable-snapshot-status-v1", {
    policyId: snapshot.policyId, coveragePolicyId: snapshot.coveragePolicyId,
    lastUpdatedAt: snapshot.lastUpdatedAt, coverage: snapshot.coverage,
    sources: snapshot.sources.map(({jobs, ...status}) => ({...status, jobs: jobs.map(job => ({
      id: job.id, sourceId: job.sourceId, sourceResultId: job.sourceResultId,
      lastSeenAt: job.lastSeenAt,
      lastConfirmedObservedAt: (job as typeof job & {lastConfirmedObservedAt?: string}).lastConfirmedObservedAt,
      inGrace: job.inGrace
    }))})),
    companies: snapshot.companies.map(({id, sourceIds, publishingSourceIds, coverage, health, required, exclusionReason}) => ({
      id, sourceIds, publishingSourceIds, coverage, health, required, exclusionReason
    }))
  });
  return {version, displayDataVersion, statusVersion,
    verificationVersion: digest("portable-snapshot-verification-v1", {version, displayDataVersion, statusVersion}),
    verifiedAt: snapshot.generatedAt};
}
