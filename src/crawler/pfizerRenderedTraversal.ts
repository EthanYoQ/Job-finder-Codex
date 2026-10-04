import { createHash } from "node:crypto";
import type { OfficialJsonRenderedRawRow, OfficialJsonRenderedPageCapture } from "./officialJsonRenderedTraversalValidator";
import { irreversibleOfficialJsonEvidenceId } from "./officialJsonEvidence";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
const ENTRY = "https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers";
const COUNTRY = "6cb77610a8a543aea2d6bc10457e35d4";
const CHANNEL = "source:source-pfizer-china-social:default";
const object = (v: unknown): Record<string, any> => { if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Pfizer UI object is invalid"); return v as Record<string, any>; };
const renderedTitleText = (value:string) => value.replace(/&amp;/gu,"&").replace(/&quot;/gu,'"').replace(/&apos;|&#0*39;/gu,"'").replace(/&lt;/gu,"<").replace(/&gt;/gu,">").replace(/\s+/gu," ").trim();
/** Independent path classifies native HTML JSON-LD plus rendered locations, never main API country fields. */
export function replayPfizerRenderedRow(row: OfficialJsonRenderedRawRow, index: number): OfficialJsonRenderedRawRow["scopeDecision"] {
    const raw = object(row.rawPayload);
    if (typeof raw.capturedAt !== "string" || !Number.isFinite(Date.parse(raw.capturedAt)) || new Date(raw.capturedAt).toISOString() !== raw.capturedAt) throw Error("Pfizer UI capturedAt is invalid");
    if (row.recordIndex !== index || typeof raw.officialId !== "string" || !/^\d{7}$/u.test(raw.officialId) || typeof raw.externalPath !== "string" || !/^\/job\/[^?#]+$/u.test(raw.externalPath) ||
        !new RegExp(`_${raw.officialId}(?:-\\d+)?$`, "u").test(raw.externalPath) || typeof raw.title !== "string" || !raw.title.trim() || typeof raw.renderedTitle !== "string" || renderedTitleText(raw.renderedTitle) !== renderedTitleText(raw.title) || raw.renderedId !== raw.officialId || raw.applyEnabled !== true ||
        !Array.isArray(raw.renderedLocations) || raw.renderedLocations.length === 0 || raw.renderedLocations.some((x: unknown) => typeof x !== "string" || !x.trim()) || new Set(raw.renderedLocations).size !== raw.renderedLocations.length)
        throw Error("Pfizer rendered identity or activity mismatch");
    const detailUrl = new URL(raw.detailUrl);
    if (detailUrl.origin !== "https://pfizer.wd1.myworkdayjobs.com" || detailUrl.pathname !== "/en-US/PfizerCareers" + raw.externalPath || detailUrl.search !== `?Location_Country=${COUNTRY}` || detailUrl.hash || detailUrl.username || detailUrl.password)
        throw Error("Pfizer rendered detail URL mismatch");
    if (typeof raw.jsonLd !== "string" || !hasUniqueJsonObjectKeys(raw.jsonLd))
        throw Error("Pfizer rendered JSON-LD is invalid");
    const ld = object(JSON.parse(raw.jsonLd)), address = object(object(ld.jobLocation).address);
    if (ld["@type"] !== "JobPosting" || object(ld.identifier).value !== raw.officialId || typeof ld.title !== "string" || renderedTitleText(ld.title) !== renderedTitleText(raw.title) || typeof ld.datePosted !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(ld.datePosted))
        throw Error("Pfizer JSON-LD identity mismatch");
    const countries = address.addressCountry;
    if (row.scopeMarker !== countries || row.rawEvidenceId !== irreversibleOfficialJsonEvidenceId(raw.officialId) || row.sourceJobId !== `workday:sha256:${createHash("sha256").update(raw.externalPath).digest("hex")}`)
        throw Error("Pfizer rendered row commitment mismatch");
    const locations: string[] = raw.renderedLocations;
    let decision: OfficialJsonRenderedRawRow["scopeDecision"];
    if (countries === "China" && typeof address.addressLocality === "string" && /^(?:CHN|China) - /u.test(address.addressLocality) &&
        locations.some(v => /^(?:China|CHN) - /u.test(v) && !/Hong Kong|Taiwan|Macau|Macao/iu.test(v)))
        decision = "INCLUDED_MAINLAND";
    else if (countries === "India" && typeof address.addressLocality === "string" && /^IND - /u.test(address.addressLocality) && /^India - /u.test(locations[0]!) &&
        locations.every(v => /^India - [A-Za-z ]+$/u.test(v) || ["APAC - Any Pfizer Site", "Europe - Any Pfizer Site", "IDM - Any Pfizer Site"].includes(v)))
        decision = "EXCLUDED_AUDITED";
    else
        throw Error("Pfizer rendered country is unknown or conflicting");
    if (row.scopeDecision !== decision)
        throw Error("Pfizer rendered scope decision mismatch");
    return decision;
}

export function assertPfizerRenderedPage(page: OfficialJsonRenderedPageCapture): void {
    const scope = object(page.rawRows[0]?.rawPayload.listPage);
    const expectedUrl = ENTRY + `?Location_Country=${COUNTRY}`;
    const expectedRange = `${(page.pageNumber - 1) * 20 + 1} - ${Math.min(page.pageNumber * 20, page.declaredTotalJobs)} of ${page.declaredTotalJobs} jobs`;
    if (scope.url !== expectedUrl || scope.title !== "Search for Jobs" || scope.countryFilter !== "China clear filter" ||
        scope.filterCount !== 1 || scope.searchText !== "" || scope.pageLabel !== `Page ${page.pageNumber} of ${page.declaredTotalPages}` ||
        typeof scope.range !== "string" || scope.range.trim() !== expectedRange || scope.totalText !== `${page.declaredTotalJobs} JOBS FOUND` || scope.nextControlPresent !== page.nextControlPresent ||
        typeof scope.capturedAt !== "string" || !Number.isFinite(Date.parse(scope.capturedAt))) throw Error("Pfizer archived rendered page scope mismatch");
}

export async function capturePfizerRenderedTraversal(page: import("playwright-core").Page, signal?: AbortSignal): Promise<OfficialJsonRenderedPageCapture[]> {
    const entry = ENTRY + `?Location_Country=${COUNTRY}`;
    const navigation = await page.goto(entry, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (!navigation || navigation.status() !== 200 || page.url() !== entry)
        throw Error("Pfizer UI entry navigation failed");
    const cards = page.locator('[data-automation-id="jobTitle"]');
    await cards.first().waitFor({ state: "visible", timeout: 60000 });
    await page.getByRole("button", { name: "China clear filter", exact: true }).waitFor({ state: "visible", timeout: 30000 });
    const detail = await page.context().newPage();
    const pages: OfficialJsonRenderedPageCapture[] = [];
    let total: number | undefined, totalPages: number | undefined;
    const seen = new Set<string>();
    try {
        for (let index = 1; index <= 20; index++) {
            signal?.throwIfAborted();
            await page.locator('[data-automation-id="jobFoundText"]').filter({ hasText: /^\d+ JOBS FOUND$/u }).waitFor({ state: "visible", timeout: 60000 });
            const label = await page.locator('ul[aria-label^="Page "]').getAttribute("aria-label");
            const match = /^Page (\d+) of (\d+)$/u.exec(label ?? "");
            const count = Number((await page.locator('[data-automation-id="jobFoundText"]').innerText()).match(/^\d+/u)?.[0]);
            if (!match || Number(match[1]) !== index || !Number.isSafeInteger(count) || count < 1)
                throw Error("Pfizer UI page declaration failed");
            total ??= count;
            totalPages ??= Number(match[2]);
            if (count !== total || Number(match[2]) !== totalPages || totalPages !== Math.ceil(total / 20))
                throw Error("Pfizer UI declared total changed");
            const range = await page.locator('[data-automation-id="jobOutOfText"]').innerText();
            if (range !== `${(index - 1) * 20 + 1} - ${Math.min(index * 20, total)} of ${total} jobs`)
                throw Error("Pfizer UI range is not settled");
            const links = await cards.evaluateAll(es => es.map(e => ({ href: (e as HTMLAnchorElement).href, title: e.textContent?.trim() ?? "" })));
            if (links.length !== Math.min(20, total - (index - 1) * 20))
                throw Error("Pfizer UI card count mismatch");
            const rawRows: OfficialJsonRenderedRawRow[] = [];
            for (const [recordIndex, link] of links.entries()) {
                signal?.throwIfAborted();
                const path = new URL(link.href).pathname.slice("/en-US/PfizerCareers".length), id = /_(\d{7})(?:-\d+)?$/u.exec(path)?.[1];
                if (!id || seen.has(id))
                    throw Error("Pfizer UI duplicate or missing official ID");
                seen.add(id);
                const response = await detail.goto(link.href, { waitUntil: "domcontentloaded", timeout: 60000 });
                if (!response || response.status() !== 200 || detail.url() !== link.href)
                    throw Error("Pfizer UI native detail navigation failed");
                await detail.locator('[data-automation-id="jobPostingHeader"]').waitFor({ state: "visible", timeout: 60000 });
                await detail.getByRole("button", { name: "Apply", exact: true }).waitFor({ state: "visible", timeout: 30000 });
                const jsons = await detail.locator('script[type="application/ld+json"]').allTextContents();
                if (jsons.length !== 1)
                    throw Error("Pfizer native detail has ambiguous JSON-LD");
                const ld = object(JSON.parse(jsons[0]!));
                const rawPayload = { capturedAt: new Date().toISOString(), officialId: id, externalPath: path, title: link.title, detailUrl: link.href,
                    renderedTitle: (await detail.locator('[data-automation-id="jobPostingHeader"]').innerText()).trim(),
                    renderedId: (await detail.locator('[data-automation-id="job-posting-details"] [data-automation-id="requisitionId"] dd').innerText()).trim(),
                    renderedLocations: (await detail.locator('[data-automation-id="job-posting-details"] [data-automation-id="locations"] dd').allTextContents()).map(v => v.trim()),
                    applyEnabled: await detail.getByRole("button", { name: "Apply", exact: true }).isEnabled(), jsonLd: JSON.stringify({"@type":ld["@type"],identifier:ld.identifier,title:ld.title,jobLocation:ld.jobLocation,datePosted:ld.datePosted}), jsonLdRepresentation: "SCOPE_FIELDS", documentTitle: await detail.title() };
                const marker = object(object(ld.jobLocation).address).addressCountry;
                const row: OfficialJsonRenderedRawRow = { sourceJobId: `workday:sha256:${createHash("sha256").update(path).digest("hex")}`, rawEvidenceId: irreversibleOfficialJsonEvidenceId(id), scopeMarker: String(marker), scopeDecision: marker === "China" ? "INCLUDED_MAINLAND" : "EXCLUDED_AUDITED", recordIndex, rawPayload };
                replayPfizerRenderedRow(row, recordIndex);
                rawRows.push(row);
            }
            const next = page.getByRole("button", { name: "next", exact: true });
            const nextPresent = await next.count() === 1 && await next.isVisible() && await next.isEnabled();
            if (nextPresent !== (index < totalPages))
                throw Error("Pfizer UI terminal control contradicts page declaration");
            rawRows[0]!.rawPayload.listPage = { url: page.url(), title: await page.title(), countryFilter: "China clear filter", filterCount: 1,
                searchText: await page.getByRole("textbox").inputValue(), pageLabel: label, range, totalText: `${total} JOBS FOUND`,
                nextControlPresent: nextPresent, capturedAt: new Date().toISOString() };
            await page.getByRole("button", {name:"China clear filter",exact:true}).waitFor({state:"visible"});
            await page.getByRole("button", {name:"Clear All (1)",exact:true}).waitFor({state:"visible"});
            pages.push({ channelId: CHANNEL, pageNumber: index, declaredTotalPages: totalPages, declaredTotalJobs: total, uiRequestCandidateIds: [], rawRows, nextControlPresent: nextPresent });
            if (!nextPresent) {
                if (seen.size !== total)
                    throw Error("Pfizer UI final raw set mismatch");
                return pages;
            }
            await next.click();
            await page.locator(`ul[aria-label="Page ${index + 1} of ${totalPages}"]`).waitFor({ state: "attached", timeout: 60000 });
        }
        throw Error("Pfizer UI safety limit reached without terminal evidence");
    }
    finally {
        await detail.close().catch(() => undefined);
    }
}

/** Wrap actual managed-browser DOM packets in the existing B page model; no main-crawl input is accepted. */
export function pfizerDomPacketsToPages(packets: unknown, originalCaptureSha256: string): OfficialJsonRenderedPageCapture[] {
    if (!/^[a-f0-9]{64}$/u.test(originalCaptureSha256)) throw Error("Pfizer original capture hash is invalid");
    if (!Array.isArray(packets) || packets.length < 1 || packets.length > 20) throw Error("Pfizer DOM packet count is invalid");
    return packets.map(packetValue => {
        const packet = object(packetValue), listPage = object(packet.listPage);
        const label = /^Page (\d+) of (\d+)$/u.exec(String(listPage.pageLabel));
        const total = /^(\d+) JOBS FOUND$/u.exec(String(listPage.totalText));
        if (!label || !total || !Array.isArray(packet.rows) || packet.rows.length < 1) throw Error("Pfizer DOM packet declaration is invalid");
        const rawRows = packet.rows.map((value: unknown, recordIndex: number): OfficialJsonRenderedRawRow => {
            const raw = object(value), ld = object(JSON.parse(String(raw.jsonLd))), country = object(object(ld.jobLocation).address).addressCountry;
            const row: OfficialJsonRenderedRawRow = {
                sourceJobId: `workday:sha256:${createHash("sha256").update(String(raw.externalPath)).digest("hex")}`,
                rawEvidenceId: irreversibleOfficialJsonEvidenceId(raw.officialId), scopeMarker: String(country),
                scopeDecision: country === "China" ? "INCLUDED_MAINLAND" : "EXCLUDED_AUDITED", recordIndex,
                rawPayload: {...raw, ...(recordIndex === 0 ? {listPage} : {})}
            };
            replayPfizerRenderedRow(row, recordIndex);
            return row;
        });
        const page = {channelId: CHANNEL, pageNumber: Number(label[1]), declaredTotalPages: Number(label[2]),
            declaredTotalJobs: Number(total[1]), uiRequestCandidateIds: [], rawRows, nextControlPresent: listPage.nextControlPresent};
        assertPfizerRenderedPage(page);
        // Match the native capture's SCOPE_FIELDS carrier. Validate originals
        // before projection; the complete DOM/JSON-LD stays in the hash-bound
        // private capture, while every field used by B replay remains here.
        const scopeFields = ["capturedAt", "officialId", "externalPath", "title", "detailUrl", "renderedTitle", "renderedId", "renderedLocations", "applyEnabled", "documentTitle"];
        const pageFields = ["url", "title", "countryFilter", "filterCount", "searchText", "pageLabel", "range", "totalText", "nextControlPresent", "capturedAt"];
        const scopePage = Object.fromEntries(pageFields.map(key => [key, listPage[key]]));
        page.rawRows = rawRows.map((row, recordIndex) => {
            const raw = object(packet.rows[recordIndex]), ld = object(JSON.parse(raw.jsonLd));
            const rawPayload = {
                ...Object.fromEntries(scopeFields.filter(key => raw[key] !== undefined).map(key => [key, raw[key]])),
                jsonLd: JSON.stringify({"@type": ld["@type"], identifier: ld.identifier, title: ld.title, jobLocation: ld.jobLocation, datePosted: ld.datePosted}),
                jsonLdRepresentation: "SCOPE_FIELDS", originalCaptureSha256,
                originalRowSha256: createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
                ...(recordIndex === 0 ? {listPage: {...scopePage,
                    originalListPageSha256: createHash("sha256").update(JSON.stringify(listPage)).digest("hex")}} : {})
            };
            const projected = {...row, rawPayload};
            replayPfizerRenderedRow(projected, recordIndex);
            return projected;
        });
        assertPfizerRenderedPage(page);
        return page;
    });
}
