# Job Finder

Job Finder discovers and publishes auditable official pharmaceutical-company jobs for people searching within mainland China. Its domain separates roster coverage, source qualification, first-launch gating, and routine per-company publication.

## Language

**Roster Company**:
One of the 41 pharmaceutical companies retained by the September 1-2, 2026 human verification: 30 foreign and 11 domestic companies. Companies absent from that verification are outside the current product scope.
_Avoid_: Historical candidate, deleted company, optional company

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
The requirement that every company in the frozen 41-company Launch Cohort has current A- or B-grade completeness evidence in two qualified rounds, including all 30 foreign companies.
_Avoid_: 50-company gate, configurable pass total, partial launch

**Launch Cohort**:
The immutable first-launch selection of 41 Roster Companies: 30 foreign pharmaceutical companies and 11 domestic pharmaceutical companies. A failed company is never replaced by an out-of-scope historical candidate.
_Avoid_: Full roster, replaceable sample, successful subset

**Fixed Cohort Audit**:
A diagnostic account of completeness evidence and failure stage for every Launch Cohort company in one formal batch. It reports failures and bounded repair groups but is not itself proof that a company is launch-qualified.
_Avoid_: Passing count, repeated-count check, launch approval

**Authoritative Launch Receipt**:
The single content-bound decision that joins the exact source, image, Launch Cohort, database snapshot, security, restore, operations, and two-round A/B evidence for first launch.
_Avoid_: Readiness checklist, partial-ready report, operator approval

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

**Restore Receipt**:
A content-hashed record proving that one committed backup was restored into a newly created PostgreSQL 16 database and passed migration, formal-batch, certificate, trusted-job, and relationship checks before the temporary database was removed.
_Avoid_: Archive existence check, pg_restore exit code alone, operator-written recovery note
