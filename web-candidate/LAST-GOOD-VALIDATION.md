# Last-good publication after a failed attempt

Removed the B-grade-only rule that changed an otherwise accepted source to HOLD solely because a later attempt failed or remained running. Publication still requires the selected committed receipt, complete lifecycle membership and unchanged Job projection; degraded health and original observation times remain visible.

Read-only verification on the restored new PostgreSQL database recovered Pfizer 212 jobs and Sanofi 120 jobs after their latest failed captures; Merck remained 72. The public snapshot contained 5,164 jobs with lastUpdatedAt 2026-10-31T09:37:03.881Z. Original receipts and timestamps were unchanged. In a second read, changing the returned Pfizer rows to CLOSED only in memory caused PROJECTION_INTEGRITY_HOLD and no published jobs. No database records were modified.

Raw tool receipt: project-root diagnostics/last-good-verification.json. The 332-job disappearance was a reader gate, not deleted database data. Production remains on the old service.
