# Job Finder

Job Finder discovers and publishes auditable official pharmaceutical-company jobs for people searching within mainland China. Its domain separates roster coverage, source qualification, first-launch gating, and routine per-company publication.

## Language

**Roster Company**:
One of the fixed 60 Phase 1 pharmaceutical companies that must remain visible in the company directory regardless of publishing state.
_Avoid_: Replaceable company, optional company

**China-scoped Job**:
A job whose audited official location explicitly names mainland China, China nationwide, or a mainland city. A regional label such as APAC does not establish China scope by itself.
_Avoid_: APAC job, potentially China job

**City-scoped Search**:
A job-discovery query anchored to one concrete selected city from the product's canonical supported-city list (currently 北京、上海、广州). It may also include jobs explicitly marked nationwide or China-wide as fallbacks, but those broad labels are never valid selected-city inputs and never mean all locations.
_Avoid_: All-locations search, global job search

**Stable Company**:
A Roster Company whose current official social-recruitment source has two latest consecutive successful stable observations and a truthful public job projection derived from current records.
_Avoid_: Reachable company, configured company, historically green company

**First-launch Gate**:
The requirement that at least 55 Stable Companies pass record-derived readiness before the first external launch or formal Phase 1 completion.
_Avoid_: 45-company gate, configurable pass total

**Internal Candidate Preview**:
A restricted preview of the currently verified subset while the First-launch Gate remains closed. It is not an external release and does not prove Phase 1 completion.
_Avoid_: Soft launch, partial release

**Routine Publication**:
Post-launch publication evaluated independently per company. A current failure affects that company and does not reapply a global minimum to otherwise eligible companies.
_Avoid_: Requalification launch

**Trusted Completeness Baseline**:
The latest atomically committed A-grade official-total or B-grade independent-traversal certificate for one source. Only a newly committed A/B certificate may advance its certified job count; an unverified anomaly preserves both this baseline and the last trusted public job projection.
_Avoid_: Repeated count, last attempted count, manually estimated count

**Production Security Receipt**:
The commit-run result that binds one production image, production lockfile, raw vulnerability reports and time-bounded reachability/exception policies. Unknown reachability and expired evidence fail closed.
_Avoid_: Repository-wide audit result, unbound scanner log, permanent vulnerability waiver
