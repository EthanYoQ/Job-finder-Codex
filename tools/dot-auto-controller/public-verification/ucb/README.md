# Pure UCB public verification port

Target: `https://job.orz.md/`, `company-ucb-china`, 优时比中国, reader coordinate `E6`. The official source card points to `https://careers.ucb.com/global/zh/search-results?keywords=China`.

This directory imports no tool, native parser, database, network or filesystem in its runtime modules. Tool binding is disabled by default. The original AX/consent/deadline/fresh-index/reload state machine is retained.

The public reader has no native sourceJobId field. `createCuaBrowserPort` therefore requires receipt-verified expected public data. It takes one frozen snapshot and joins the exact observed href to an unambiguous expected URL-to-ID table. Observed titles and URLs are never filled from expected data. Native Phenom IDs use `official-json:sha256:SHA256(JSON.stringify(rawId))`, and the independent `reqId` in a fallback URL is never treated as that ID. All visible links in UCB's job container are collected; no `/global/en/job/` URL-prefix filter can silently discard a legitimate native `applyUrl`.

Unknown or ambiguous URL/ID joins HOLD. Verified zero is accepted only with a ready absent/empty company and the correct source card's visible UTC minute. Detail verification stays `UNKNOWN`; application verification stays `NOT_TESTED`; production qualification stays false.

Tests replay the existing shared AX grammar with synthetic UCB labels and DOM data. That is not a real-site observation or an application check.
