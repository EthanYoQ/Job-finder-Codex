/** Read-only pin for the reviewed, already committed historical public snapshot.
 * Never registers Sanofi as an A-grade issuer or supplies current source content. */
export const SANOFI_HISTORICAL_PUBLIC_RECEIPT = {
  "currentChineseConfigSha256": "2925884ffb70805a106c730a5b24a8992b0d13ce0348de28639e27d1bbfeacee",
  "companyId": "company-sanofi-china",
  "binding": {
    "batchId": "dot-sanofi-a-20261003T0445Z-b181c52",
    "sourceId": "source-sanofi-china-social",
    "sourceResultId": "dot-sanofi-a-20261003T0445Z-b181c52--source-sanofi-china-social",
    "releaseCandidateId": "dot-cloud-db-started-b181c52-20261003",
    "sourceConfigSha256": "106fb80ad4e6c953d41a2dd67156f42e1bc4416766c98912a60ad59722df97c3"
  },
  "certificateSha256": "a6319a660ac5f719c9a5129842a2439d6e1ebfe830defa6c999552a9e55edbbe",
  "output": {
    "canonicalJobSetSha256": "5cf809dfe743193dfd92376ee9a3b69ca97a6b0cf2055f2a66735ba5a59484f8",
    "collisionLedgerSha256": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "adapterReconciliationSha256": "c87edc7936e5f52edb98474fe10526336305a1f3a57ccb8285b5afe9776dbf90"
  },
  "adapterVersion": "2b299ef0c5be7032281a2f0c1d742b9d88c0e0ffb580ae5c54487ac1f13926cb",
  "startedAt": "2026-10-03T04:45:38.586Z",
  "finishedAt": "2026-10-03T04:47:14.374Z",
  "observedAt": "2026-10-03T04:45:45.970Z",
  "batch": {
    "id": "dot-sanofi-a-20261003T0445Z-b181c52",
    "kind": "SCHEDULED",
    "status": "SUCCESS",
    "commitSha": "b181c5212295590573f6d12396239a08c879fea3",
    "startedAt": "2026-10-03T04:45:38.586Z",
    "finishedAt": "2026-10-03T04:48:05.002Z",
    "rosterSha256": "ac44a7c7077e23ffa5367dc4bb8a11b254feebc8a190ae7c27481c7269a5a659",
    "sourcePlanSha256": "331cc04ae9fb82aeb8001df41c720d0a308dc1402f63b612dcc924276438e1fc",
    "releaseCandidateId": "dot-cloud-db-started-b181c52-20261003",
    "sourceConfigSha256": "3b5cce94ddb98f1577f87508bc8e30b2bed468dcabd086b143ec76dba46fefba",
    "adapterBundleSha256": "cd779d51efa32a35a7795b617b51ae579c3c07880461ca35772b02334a5cc9fb"
  }
} as const;
