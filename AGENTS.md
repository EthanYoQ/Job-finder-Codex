## Agent skills

### Issue tracker

Issues and specs are tracked as local Markdown under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the canonical five-role label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using a root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Implement-stage sub-agent policy

Only during the `/implement` stage, every spawned sub-agent and every descendant sub-agent must use model `gpt-5.6-terra` with reasoning effort `max`. The parent prompt must repeat this requirement whenever it delegates further work. This rule does not override model selection outside `/implement`.
