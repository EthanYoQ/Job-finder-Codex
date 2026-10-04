/** A one-active-job (or exact zero) projection of the invented native-chain fixture. */
import { createNovoSyntheticFixture, NOVO_SYNTHETIC_ENDPOINT } from "./novoSyntheticFixture";
import type { OfficialJsonHttpClient } from "../../src/crawler/officialJsonSourceFetch";

export function createNovoSingleJobHttp(capturedAt: string, options: {zero?: boolean; invalidTitle?: boolean} = {}): OfficialJsonHttpClient {
  const fixture = createNovoSyntheticFixture();
  const envelope = JSON.parse(fixture.body);
  // Row 1 has an active application and intentionally differing list/detail/application titles.
  envelope.data.jobs = options.zero ? [] : options.invalidTitle ? envelope.data.jobs.slice(1, 3) : [envelope.data.jobs[1]];
  envelope.data.totalMatches = envelope.data.jobs.length;
  if (options.invalidTitle) envelope.data.jobs[1].jobTitle = "";
  const body = JSON.stringify(envelope);
  return async request => {
    if ((request.method ?? "GET") !== "GET" || request.body) throw Error("SYNTHETIC_NOVO_UNEXPECTED_REQUEST");
    if (request.url === NOVO_SYNTHETIC_ENDPOINT) {
      return {status: 200, body, finalUrl: request.url, contentType: "application/json; charset=utf-8", capturedAt};
    }
    const capture = fixture.captures[request.url];
    if (!capture) throw Error("SYNTHETIC_NOVO_UNEXPECTED_URL_NO_NETWORK_FALLBACK");
    return {status: 200, ...capture, capturedAt};
  };
}
