/** Both official social partitions are required; no combined official job total is asserted. */
export const QILU_DUAL_PARTITION_PROFILE = Object.freeze({
    kind: "qilu-dual-official" as const,
    expectedChannelIds: ["qilu-marketing", "qilu-non-marketing"] as const,
    config: Object.freeze({
        marketingEntryUrl: "https://www.qilu-pharma.com/JobPosting_list.html" as const,
        nonMarketingEntryUrl: "https://qilu-pharma.zhiye.com/social/jobs" as const,
        policyVersion: "QILU_REQUIRED_SOCIAL_PARTITIONS_V1" as const,
        pageSize: 15 as const,
        maxPages: 100 as const
    })
});
export type QiluDualPartitionConfig = typeof QILU_DUAL_PARTITION_PROFILE.config;
