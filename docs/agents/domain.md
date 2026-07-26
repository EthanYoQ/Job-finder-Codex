# Domain Docs

This repository uses a single project context.

## Before exploring

Read these when present:

- `CONTEXT.md` at the repository root
- Relevant ADRs under `docs/adr/`

If they do not exist, proceed silently. `grill-with-docs` and domain-modeling may create them lazily when terminology or architectural decisions are resolved.

## Layout

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
└── src/
```

## Vocabulary

Use domain terms exactly as defined in `CONTEXT.md`. Avoid introducing synonyms for established concepts.

If a required concept is absent, determine whether the proposed term is unnecessary or whether the glossary needs to be extended.

## ADR conflicts

If proposed work conflicts with an existing ADR, identify the ADR and surface the conflict explicitly instead of silently overriding it.
