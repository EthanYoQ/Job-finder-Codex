import { runP0CrawlCommand, type RunP0CrawlCommandDeps } from "./p0CrawlCommand";
import {
  resolveCurrentStagedScheduleAuthority,
  type StagedScheduleAuthorityDb
} from "./stagedScheduleAuthority";

export interface RunCurrentStagedScheduledCrawlDeps {
  db: RunP0CrawlCommandDeps["db"] & StagedScheduleAuthorityDb;
  fetch: RunP0CrawlCommandDeps["fetch"];
  now: RunP0CrawlCommandDeps["now"];
  force?: boolean;
  syncPlannedSourcesToDb: RunP0CrawlCommandDeps["syncPlannedSourcesToDb"];
  createRuntimeDeps: RunP0CrawlCommandDeps["createRuntimeDeps"];
  runP0CrawlBatch: RunP0CrawlCommandDeps["runP0CrawlBatch"];
}

export async function runCurrentStagedScheduledCrawl(
  deps: RunCurrentStagedScheduledCrawlDeps
) {
  const authority = await resolveCurrentStagedScheduleAuthority(deps.db);
  const result = await runP0CrawlCommand({
    plans: authority.plans,
    companies: authority.companies,
    options: { help: false, sourceIds: [], force: deps.force === true },
    identity: authority.identity,
    db: deps.db,
    fetch: deps.fetch,
    now: deps.now,
    syncPlannedSourcesToDb: deps.syncPlannedSourcesToDb,
    createRuntimeDeps: deps.createRuntimeDeps,
    runP0CrawlBatch: deps.runP0CrawlBatch
  });
  const identity = structuredClone(authority.identity);
  Object.freeze(identity.expectedPlannedSourceIds);
  Object.freeze(identity);
  return { ...result, identity };
}
