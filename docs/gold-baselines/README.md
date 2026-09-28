# Human-verified recruitment workbooks

This backup preserves the two dated calibration snapshots used by the crawler code at `b5a426a498255d4f2ffaf1677f74ace9e6acb8d7`. The business code is unchanged from the tested `75c202067052f332530c1a10c6291315541539b3`; the later commits only archived GitHub workflows.

| Snapshot | Contents | SHA-256 |
| --- | --- | --- |
| `round-1/医药公司招聘网址与职位数量_2026-08-25-人工核实.xlsx` | 41 human-verified launch companies; recovered from the 2026-09-02 documentation snapshot | `a325c6009b5f3bfd2308c0a38fcdd783d81b8fcf8c9072ea1c07357b0f31715d` |
| `round-2/医药公司招聘网址与职位数量_2026-08-25-人工核实.xlsx` | The same 41 rows followed by 10 human-verified future-crawl rows | `5902708167f55a0d07ef489a642c8b637b7dbf5c7917089e36d7900166d3eeb6` |

The first 41 rows of the second workbook match the first workbook cell for cell. Their human counts match all 41 entries in `src/data/humanVerifiedRecruitmentBaseline.ts`; the 10 added counts match `src/data/futureCrawlExpansionCandidates.ts`. The crawler corrections and their limits are recorded in `docs/2026-09-02-human-crawler-reconciliation.md` and `docs/2026-09-03-future-crawl-expansion-qualification.md`.

These workbooks are dated calibration evidence, not current job totals or direct crawler inputs. The 10 added companies are future-crawl candidates and do not change the frozen 41-company launch cohort. The legacy 60-company candidate registry remains in this code snapshot.
