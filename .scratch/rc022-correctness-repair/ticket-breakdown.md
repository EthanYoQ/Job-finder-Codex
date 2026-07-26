# Ticket Breakdown Decision

The user instructed the workflow to take recommended decisions autonomously. The following breakdown is therefore approved without a human quiz:

1. **Enforce City-scoped Search end to end** — no blockers; a complete request-to-interface behavior slice.
2. **Require mainland evidence for Pfizer China jobs** — no blockers; a complete source-evidence-to-normalized-output slice.
3. **Align the 55-company gate and restore clean diff** — no blockers; a complete requirements-and-mechanical-gate slice.
4. **Add the private cloud build gate** — blocked by 01, 02, and 03 so the workflow is validated against the repaired candidate.

Tickets 01–03 touch independent behavior surfaces and may be implemented in parallel. Ticket 04 begins only after all three are green.
