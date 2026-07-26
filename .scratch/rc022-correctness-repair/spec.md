# RC022 Review Repair Specification

**Status:** ready-for-agent

## Problem Statement

RC022 的职位发现与官方来源资格判断存在两个相互放大的范围错误：历史遗留的“全部地点”值可以绕过城市必选约束，而 Pfizer China 的严格来源证明允许仅有印度主地点和 APAC 区域描述的职位通过完整性验证。结果是非中国岗位既可能影响 Stable Company 证据，也可能进入用户可见结果。

同时，Canonical PRD 对 First-launch Gate 的升级未完整从 45 家统一到 55 家，且受审差异仍有一处会使 Git clean-diff gate 失败的尾随空白。修复完成后还必须在私人云端仓库中从候选提交完成一次可追溯构建验收。

## Solution

恢复严格的 City-scoped Search：用户只能选择具体城市，遗留的全地点哨兵在请求进入数据库前即被拒绝，每个合法查询都保留“所选城市 + 全国 + 中国”的既有语义。

收紧 Pfizer China 的来源边界：官方详情必须至少包含一个明确的中国大陆地点才能产生 China-scoped Job 和完整性证明；APAC 描述可作为附加文本，但不能独立证明中国范围。

将所有有效的一期首发、内部预览、正式完成和测试条款统一到 55 个 Stable Companies，清理 diff whitespace，并在不包含秘密的私人云仓流水线中完成安装、生成、类型检查、测试和生产构建。

## User Stories

1. As a 求职者, I want every search to require one concrete city, so that I do not receive unrelated global jobs.
2. As a 求职者, I want nationwide and China-wide jobs to remain visible within my selected city, so that city scoping does not hide genuinely broad China roles.
3. As a 求职者, I want India/APAC-only roles excluded from China search results, so that displayed jobs match the product's mainland-China purpose.
4. As a returning user or legacy client, I want the former all-locations value rejected clearly, so that it cannot silently broaden the query.
5. As a site operator, I want Pfizer China completeness to require explicit mainland location evidence, so that a regional APAC descriptor cannot qualify a foreign role.
6. As a site operator, I want valid Pfizer roles that explicitly include Shanghai or another mainland location to continue qualifying, so that the fix does not suppress real China jobs.
7. As a release owner, I want one canonical 55-company First-launch Gate, so that implementation and QA cannot choose between contradictory thresholds.
8. As a release owner, I want the two-round, no-third-round rule preserved, so that the repair cannot manufacture a passing release.
9. As a maintainer, I want the baseline-to-candidate diff to pass the whitespace gate, so that mechanical CI checks remain trustworthy.
10. As a maintainer, I want regression tests at existing public seams, so that future refactors cannot reintroduce these scope errors.
11. As a maintainer, I want broad source-adapter refactors deferred from this correctness repair, so that behavior fixes remain reviewable and low-risk.
12. As a release owner, I want the repaired candidate built in a private cloud repository, so that cloud acceptance proves the committed artifact without exposing source or credentials.

## Implementation Decisions

- The domain exports one canonical supported-city list, currently 北京、上海、广州, shared by the request contract and discovery interface.
- The search request interface rejects the legacy all-locations sentinel plus national, regional, foreign, and arbitrary unsupported values before any job query runs.
- Every accepted database-backed search applies a concrete-city predicate while retaining nationwide and China-wide fallbacks.
- The discovery interface and demo behavior use the same City-scoped Search contract and do not expose an all-locations option.
- Pfizer's source-bound Workday proof requires at least one explicit mainland China descriptor. Its fetch validator and source-bound replay share a Pfizer-specific parser: an audited mainland city such as `Shanghai` is sufficient without a country suffix, while a descriptor containing a foreign-country conflict is rejected. Other Workday source policies retain their existing country/explicit-alias boundaries. Exact or broad APAC descriptors never substitute for mainland evidence.
- A Pfizer detail with both a foreign primary location and an explicit mainland additional location may qualify; normalized city output derives only from the mainland evidence.
- The canonical product requirements use 55 for every active First-launch Gate, internal-preview boundary, formal Phase 1 completion statement, and matching release test.
- Routine Publication remains per company after first launch and does not regain a global threshold.
- The fixed 60-company roster, authorized exclusions, no-substitution rule, two-round limit, and fail-closed release behavior remain unchanged.
- Only the confirmed correctness, documentation, and clean-diff findings are included. Profile-bound registries, provider-module splitting, and shared transport refactoring remain separate enhancement briefs.
- Cloud acceptance uses a private repository and a commit-bound CI run. No credential, runtime evidence secret, database dump, or local CodeGraph database is committed.

## Testing Decisions

- The search request plus database-backed search is the primary seam for the City-scoped Search contract.
- The discovery interface is tested for absence of the legacy all-locations option and preservation of the canonical supported city choices.
- Domain and public-API tests prove national, regional, foreign, and arbitrary unsupported city values fail before any database job read.
- The source crawl result is the primary seam for Pfizer completeness: an India/APAC-only fixture must fail and emit no jobs; the same fixture with explicit mainland evidence must pass.
- Tests verify observable outcomes and do not assert private helper call order.
- The two confirmed regression tests begin red and must turn green one vertical slice at a time.
- Targeted tests and typechecking run during each slice. The full test suite, production build, Prisma validation/generation path, and Git whitespace check run at completion.
- The cloud workflow uses commit-pinned actions, an exact Node/container image, no persisted checkout credential, and repeats locked dependency installation, Prisma Client generation, typechecking, the full test suite, and production build from the committed candidate.
- Cloud acceptance requires verified private visibility, a successful run tied to the candidate commit, and no secret-bearing artifact in the pushed tree.

## Out of Scope

- Replacing Pfizer or any other roster company
- Treating APAC as equivalent to mainland China
- Adding a global/all-locations public search mode
- Changing post-launch per-company publication semantics
- Lowering the 55-company threshold, combining cross-round successes, or running a third qualification round
- Running a new production qualification or deployment
- Refactoring the full official JSON provider module
- Centralizing all profile-bound source kinds or all HTTP transports
- Resolving the existing dependency audit advisory unless it blocks the build

## Further Notes

- Review baseline: `aef05422bc2cba9282eb21ab2cf182a320fc5aea`.
- Reviewed target: `3d26a3ab89abb15503614ba4873dfe5cfb7e51ab`.
- Initial review produced four Standards findings and three Spec findings. The two P1 Spec findings were reproduced deterministically three times each before this spec was written.
- The locked dependency install reports one existing high-severity advisory; no automatic lockfile mutation is authorized by this specification.
- The cloud build proves buildability of the repaired private repository. It does not claim production deployment, current crawl success, or satisfaction of the 55-company release gate.
